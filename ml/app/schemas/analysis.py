"""Exact-binding analysis and technical evidence schemas."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator

from app.core.config import EvidenceMode


class EventType(StrEnum):
    FAST = "FAST"
    DEEP = "DEEP"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
    PIPELINE_ERROR = "PIPELINE_ERROR"


class EvidenceType(StrEnum):
    IDENTITY = "IDENTITY"
    SPOOF_FAST = "SPOOF_FAST"
    SPOOF_DEEP = "SPOOF_DEEP"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
    PIPELINE_ERROR = "PIPELINE_ERROR"


class ScoreDirection(StrEnum):
    HIGHER_MEANS_MORE = "HIGHER_MEANS_MORE"
    LOWER_MEANS_MORE = "LOWER_MEANS_MORE"


class AnalysisSessionRequest(BaseModel):
    model_config = ConfigDict(
        frozen=True, extra="forbid", populate_by_name=True, allow_inf_nan=False
    )

    schema_version: str = Field(alias="schemaVersion", pattern=r"^2\.0\.0$")
    organization_id: UUID = Field(alias="organizationId")
    analysis_session_id: UUID = Field(alias="analysisSessionId")
    call_id: UUID = Field(alias="callId")
    track_binding_id: UUID = Field(alias="trackBindingId")
    binding_revision: int = Field(alias="bindingRevision", ge=1)
    evidence_mode: EvidenceMode = Field(alias="evidenceMode")
    room_name: str = Field(alias="roomName", min_length=1, max_length=160)
    participant_identity: str = Field(alias="participantIdentity", min_length=1, max_length=160)
    track_sid: str = Field(alias="trackSid", min_length=1, max_length=128)
    grant_token: SecretStr = Field(alias="grantToken", min_length=1, repr=False)
    grant_expires_at: datetime = Field(alias="grantExpiresAt")
    voiceprint_reference: UUID | None = Field(default=None, alias="voiceprintReference")

    @field_validator("grant_expires_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("grant expiry must include timezone")
        return value

    def binding_fingerprint(self) -> tuple[str, ...]:
        return (
            str(self.organization_id),
            str(self.call_id),
            str(self.analysis_session_id),
            str(self.track_binding_id),
            str(self.binding_revision),
            self.evidence_mode.value,
            self.room_name,
            self.participant_identity,
            self.track_sid,
            self.grant_expires_at.isoformat(),
            str(self.voiceprint_reference or ""),
        )


class StopAnalysisRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", populate_by_name=True)
    reason_code: str = Field(alias="reasonCode", min_length=1, max_length=80)


class AnalysisAccepted(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    accepted: bool = True


class EvidenceEvent(BaseModel):
    model_config = ConfigDict(
        frozen=True, extra="forbid", populate_by_name=True, allow_inf_nan=False
    )

    event_type: EventType = Field(alias="eventType")
    event_id: UUID = Field(alias="eventId")
    schema_version: str = Field(default="2.0.0", alias="schemaVersion")
    evidence_mode: EvidenceMode = Field(alias="evidenceMode")
    organization_id: UUID = Field(alias="organizationId")
    call_id: UUID = Field(alias="callId")
    analysis_session_id: UUID = Field(alias="analysisSessionId")
    track_binding_id: UUID = Field(alias="trackBindingId")
    participant_identity: str = Field(alias="participantIdentity", min_length=1, max_length=160)
    track_sid: str = Field(alias="trackSid", min_length=1, max_length=128)
    window_id: str = Field(alias="windowId", min_length=1, max_length=200)
    correlation_id: str = Field(alias="correlationId", min_length=1, max_length=128)
    event_sequence: str = Field(alias="eventSequence", pattern=r"^\d+$")
    window_sequence: str = Field(alias="windowSequence", pattern=r"^\d+$")
    revision: int = Field(ge=0)
    evidence_type: EvidenceType = Field(alias="evidenceType")
    window_start_ms: str = Field(alias="windowStartMs", pattern=r"^\d+$")
    window_end_ms: str = Field(alias="windowEndMs", pattern=r"^\d+$")
    observed_at: datetime = Field(alias="observedAt")
    captured_at: datetime = Field(alias="capturedAt")
    inference_started_at: datetime | None = Field(default=None, alias="inferenceStartedAt")
    inference_completed_at: datetime | None = Field(default=None, alias="inferenceCompletedAt")
    processing_latency_ms: int | None = Field(default=None, alias="processingLatencyMs", ge=0)
    speech_duration_ms: int | None = Field(default=None, alias="speechDurationMs", ge=0)
    quality_score: float | None = Field(default=None, alias="qualityScore")
    reason_codes: tuple[str, ...] = Field(default=(), alias="reasonCodes")
    model_name: str | None = Field(default=None, alias="modelName", max_length=120)
    model_version: str | None = Field(default=None, alias="modelVersion", max_length=80)
    checkpoint_hash_sha256: str | None = Field(
        default=None, alias="checkpointHashSha256", pattern=r"^[0-9a-f]{64}$"
    )
    score_name: str | None = Field(default=None, alias="scoreName", max_length=120)
    score_direction: ScoreDirection | None = Field(default=None, alias="scoreDirection")
    raw_score: float | None = Field(default=None, alias="rawScore")
    calibrated_score: float | None = Field(default=None, alias="calibratedScore")
    calibration_version: str | None = Field(default=None, alias="calibrationVersion")
    error_code: str | None = Field(default=None, alias="errorCode", max_length=80)

    @field_validator("observed_at", "captured_at", "inference_started_at", "inference_completed_at")
    @classmethod
    def require_evidence_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("evidence timestamps must include timezone")
        return value

    @model_validator(mode="after")
    def validate_semantics(self) -> Self:
        if self.schema_version != "2.0.0":
            raise ValueError("unsupported evidence schema")
        if int(self.window_end_ms) < int(self.window_start_ms):
            raise ValueError("invalid evidence window")
        ready = self.event_type in {EventType.FAST, EventType.DEEP}
        model_values = (
            self.model_name,
            self.model_version,
            self.checkpoint_hash_sha256,
            self.score_name,
            self.score_direction,
            self.raw_score,
            self.processing_latency_ms,
        )
        if ready and any(value is None for value in model_values):
            raise ValueError("ready evidence requires complete model metadata")
        if ready and (self.inference_started_at is None or self.inference_completed_at is None):
            raise ValueError("ready evidence requires inference timestamps")
        if not ready and any(value is not None for value in model_values[:-1]):
            raise ValueError("non-ready evidence contains model metadata")
        if self.calibrated_score is not None and self.calibration_version is None:
            raise ValueError("calibrated evidence requires calibration version")
        if self.evidence_mode is not EvidenceMode.CALIBRATED and (
            self.calibrated_score is not None or self.calibration_version is not None
        ):
            raise ValueError("non-calibrated modes cannot emit calibrated scores")
        if self.inference_started_at is not None and self.captured_at > self.inference_started_at:
            raise ValueError("inference precedes capture")
        if (
            self.inference_started_at is not None
            and self.inference_completed_at is not None
            and self.inference_started_at > self.inference_completed_at
        ):
            raise ValueError("inference timestamps are out of order")
        if (
            self.inference_completed_at is not None
            and self.inference_completed_at > self.observed_at
        ):
            raise ValueError("observation precedes inference completion")
        return self

    def callback_body(self) -> dict[str, Any]:
        return self.model_dump(mode="json", by_alias=True, exclude_none=True)
