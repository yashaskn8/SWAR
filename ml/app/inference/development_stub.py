"""Deterministic Phase M evidence stub with fail-closed environment gating.

This module is not a model adapter. Its values are explicitly labelled test/development
fixtures and must never be interpreted as accuracy, probabilities, or production evidence.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from datetime import datetime
from enum import StrEnum
from typing import Any, Protocol, Self
from uuid import UUID, uuid5

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

STUB_SCHEMA_VERSION = "1.0.0"
STUB_MODEL_VERSION = "phase-m-development-stub-v1"
STUB_DESCRIPTOR_SHA256 = hashlib.sha256(
    b"SWAR Phase M development stub descriptor; no model checkpoint"
).hexdigest()
STUB_EVENT_NAMESPACE = UUID("018f0000-0000-7000-8000-00000000000d")
STUB_LABELS = ("PROVIDER_STUB", "NON_SCIENTIFIC_TEST_EVIDENCE")


class DevelopmentStubConfigurationError(RuntimeError):
    """Stable fail-closed configuration error with no secret material."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class CallbackDeliveryError(RuntimeError):
    """Stable backend callback failure that never includes payloads or credentials."""

    def __init__(self, code: str, *, status_code: int | None = None) -> None:
        self.code = code
        self.status_code = status_code
        super().__init__(code)


class StubScenario(StrEnum):
    TRUSTED_GENUINE = "TRUSTED_GENUINE"
    UNKNOWN_GENUINE = "UNKNOWN_GENUINE"
    TRUSTED_CLONE = "TRUSTED_CLONE"
    INSUFFICIENT_AUDIO = "INSUFFICIENT_AUDIO"
    PIPELINE_FAILURE = "PIPELINE_FAILURE"


class DeepDeliveryOrder(StrEnum):
    AFTER_FAST = "AFTER_FAST"
    BEFORE_FAST = "BEFORE_FAST"


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


class StubSettings(BaseModel):
    """The stub is enabled only when both independent gates opt in."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    app_env: str
    ml_provider: str

    @classmethod
    def from_environment(cls, source: Mapping[str, str]) -> Self:
        app_env = source.get("APP_ENV", "").strip().lower()
        provider = source.get("ML_PROVIDER", "").strip().lower()
        if provider != "stub":
            raise DevelopmentStubConfigurationError("STUB_PROVIDER_NOT_SELECTED")
        if app_env == "production":
            raise DevelopmentStubConfigurationError("STUB_FORBIDDEN_IN_PRODUCTION")
        if app_env not in {"development", "test"}:
            raise DevelopmentStubConfigurationError("STUB_ENVIRONMENT_NOT_ALLOWED")
        return cls(app_env=app_env, ml_provider=provider)


def assert_stub_not_selected_in_production(source: Mapping[str, str]) -> None:
    """Reject a production startup that selects the development stub provider."""

    if (
        source.get("APP_ENV", "").strip().lower() == "production"
        and source.get("ML_PROVIDER", "").strip().lower() == "stub"
    ):
        raise DevelopmentStubConfigurationError("STUB_FORBIDDEN_IN_PRODUCTION")


class StubScenarioConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    scenario: StubScenario
    deep_delivery_order: DeepDeliveryOrder = DeepDeliveryOrder.AFTER_FAST


class StubEventContext(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    organization_id: UUID
    call_id: UUID
    analysis_session_id: UUID
    track_binding_id: UUID
    window_sequence: int = Field(ge=0)
    window_start_ms: int = Field(ge=0)
    window_end_ms: int = Field(ge=0)
    observed_at: datetime

    @field_validator("observed_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("observed_at must include a timezone")
        return value

    @model_validator(mode="after")
    def validate_window(self) -> Self:
        if self.window_end_ms < self.window_start_ms:
            raise ValueError("window_end_ms must not precede window_start_ms")
        return self


class DevelopmentEvidenceEvent(BaseModel):
    """Exact Phase J callback shape; aliases prevent a second field vocabulary."""

    model_config = ConfigDict(frozen=True, extra="forbid", populate_by_name=True)

    event_type: EventType = Field(alias="eventType")
    event_id: UUID = Field(alias="eventId")
    schema_version: str = Field(alias="schemaVersion")
    organization_id: UUID = Field(alias="organizationId")
    call_id: UUID = Field(alias="callId")
    analysis_session_id: UUID = Field(alias="analysisSessionId")
    track_binding_id: UUID = Field(alias="trackBindingId")
    event_sequence: str = Field(alias="eventSequence", pattern=r"^\d+$")
    window_sequence: str = Field(alias="windowSequence", pattern=r"^\d+$")
    revision: int = Field(ge=0)
    evidence_type: EvidenceType = Field(alias="evidenceType")
    window_start_ms: str = Field(alias="windowStartMs", pattern=r"^\d+$")
    window_end_ms: str = Field(alias="windowEndMs", pattern=r"^\d+$")
    observed_at: datetime = Field(alias="observedAt")
    processing_latency_ms: int | None = Field(default=None, alias="processingLatencyMs", ge=0)
    speech_duration_ms: int | None = Field(default=None, alias="speechDurationMs", ge=0)
    quality_score: float | None = Field(default=None, alias="qualityScore")
    reason_codes: tuple[str, ...] = Field(default=(), alias="reasonCodes")
    model_name: str | None = Field(default=None, alias="modelName", max_length=120)
    model_version: str | None = Field(default=None, alias="modelVersion", max_length=80)
    checkpoint_hash_sha256: str | None = Field(
        default=None,
        alias="checkpointHashSha256",
        pattern=r"^[0-9a-f]{64}$",
    )
    score_name: str | None = Field(default=None, alias="scoreName", max_length=120)
    score_direction: ScoreDirection | None = Field(default=None, alias="scoreDirection")
    raw_score: float | None = Field(default=None, alias="rawScore")
    error_code: str | None = Field(default=None, alias="errorCode", max_length=80)

    @model_validator(mode="after")
    def validate_semantics(self) -> Self:
        if self.schema_version != STUB_SCHEMA_VERSION:
            raise ValueError("unsupported evidence schema")
        if int(self.window_end_ms) < int(self.window_start_ms):
            raise ValueError("invalid evidence window")
        ready = self.event_type in {EventType.FAST, EventType.DEEP}
        model_fields = (
            self.model_name,
            self.model_version,
            self.checkpoint_hash_sha256,
            self.score_name,
            self.score_direction,
            self.raw_score,
            self.processing_latency_ms,
        )
        if ready and any(value is None for value in model_fields):
            raise ValueError("ready stub evidence requires complete technical score metadata")
        if not ready and any(value is not None for value in model_fields[:-1]):
            raise ValueError("non-ready evidence cannot contain model score metadata")
        if self.event_type is EventType.FAST and self.evidence_type not in {
            EvidenceType.IDENTITY,
            EvidenceType.SPOOF_FAST,
        }:
            raise ValueError("FAST evidence type mismatch")
        if self.event_type is EventType.DEEP and self.evidence_type is not EvidenceType.SPOOF_DEEP:
            raise ValueError("DEEP evidence type mismatch")
        if self.event_type is EventType.INSUFFICIENT_EVIDENCE and (
            self.evidence_type is not EvidenceType.INSUFFICIENT_EVIDENCE or not self.reason_codes
        ):
            raise ValueError("insufficient evidence requires reason codes")
        if self.event_type is EventType.PIPELINE_ERROR and (
            self.evidence_type is not EvidenceType.PIPELINE_ERROR or self.error_code is None
        ):
            raise ValueError("pipeline error requires a stable error code")
        required_labels = {*STUB_LABELS, f"SCENARIO_{self.stub_scenario}"}
        if not required_labels.issubset(self.reason_codes):
            raise ValueError("stub evidence labels are incomplete")
        return self

    @property
    def stub_scenario(self) -> str:
        prefix = "SCENARIO_"
        matches = [
            code.removeprefix(prefix) for code in self.reason_codes if code.startswith(prefix)
        ]
        if len(matches) != 1:
            raise ValueError("stub evidence must carry exactly one scenario label")
        return matches[0]

    def callback_body(self) -> dict[str, Any]:
        return self.model_dump(mode="json", by_alias=True, exclude_none=True)


class DevelopmentStub:
    """Create deterministic, scenario-labelled callback events for a headless dev loop."""

    def __init__(self, settings: StubSettings) -> None:
        if settings.ml_provider != "stub" or settings.app_env not in {"development", "test"}:
            raise DevelopmentStubConfigurationError("STUB_ENVIRONMENT_NOT_ALLOWED")
        self.settings = settings

    @classmethod
    def from_environment(cls, source: Mapping[str, str]) -> Self:
        return cls(StubSettings.from_environment(source))

    def events(
        self,
        config: StubScenarioConfig,
        context: StubEventContext,
    ) -> tuple[DevelopmentEvidenceEvent, ...]:
        templates = self._templates(config.scenario)
        if config.deep_delivery_order is DeepDeliveryOrder.BEFORE_FAST:
            deep = [item for item in templates if item[0] is EventType.DEEP]
            fast_or_terminal = [item for item in templates if item[0] is not EventType.DEEP]
            templates = deep + fast_or_terminal
        labels = (*STUB_LABELS, f"SCENARIO_{config.scenario.value}")
        events: list[DevelopmentEvidenceEvent] = []
        for sequence, template in enumerate(templates, start=1):
            event_type, evidence_type, raw_score, extra = template
            identity = "|".join(
                [
                    str(context.analysis_session_id),
                    str(context.window_sequence),
                    config.scenario.value,
                    str(sequence),
                    event_type.value,
                    evidence_type.value,
                ]
            )
            ready = event_type in {EventType.FAST, EventType.DEEP}
            model_slug = evidence_type.value.lower()
            events.append(
                DevelopmentEvidenceEvent(
                    eventType=event_type,
                    eventId=uuid5(STUB_EVENT_NAMESPACE, identity),
                    schemaVersion=STUB_SCHEMA_VERSION,
                    organizationId=context.organization_id,
                    callId=context.call_id,
                    analysisSessionId=context.analysis_session_id,
                    trackBindingId=context.track_binding_id,
                    eventSequence=str(sequence),
                    windowSequence=str(context.window_sequence),
                    revision=1 if event_type is EventType.DEEP else 0,
                    evidenceType=evidence_type,
                    windowStartMs=str(context.window_start_ms),
                    windowEndMs=str(context.window_end_ms),
                    observedAt=context.observed_at,
                    processingLatencyMs=0 if ready else None,
                    reasonCodes=labels + tuple(extra.get("reason_codes", ())),
                    speechDurationMs=extra.get("speech_duration_ms"),
                    qualityScore=extra.get("quality_score"),
                    modelName=f"SWAR_DEVELOPMENT_STUB_{model_slug.upper()}" if ready else None,
                    modelVersion=STUB_MODEL_VERSION if ready else None,
                    checkpointHashSha256=STUB_DESCRIPTOR_SHA256 if ready else None,
                    scoreName="stub_non_scientific_raw_score" if ready else None,
                    scoreDirection=ScoreDirection.HIGHER_MEANS_MORE if ready else None,
                    rawScore=raw_score,
                    errorCode=extra.get("error_code"),
                )
            )
        return tuple(events)

    @staticmethod
    def _templates(
        scenario: StubScenario,
    ) -> list[tuple[EventType, EvidenceType, float | None, dict[str, Any]]]:
        if scenario is StubScenario.INSUFFICIENT_AUDIO:
            return [
                (
                    EventType.INSUFFICIENT_EVIDENCE,
                    EvidenceType.INSUFFICIENT_EVIDENCE,
                    None,
                    {
                        "reason_codes": ("INSUFFICIENT_SPEECH",),
                        "speech_duration_ms": 0,
                        "quality_score": 0.0,
                    },
                )
            ]
        if scenario is StubScenario.PIPELINE_FAILURE:
            return [
                (
                    EventType.PIPELINE_ERROR,
                    EvidenceType.PIPELINE_ERROR,
                    None,
                    {"error_code": "STUB_CONFIGURED_PIPELINE_ERROR"},
                )
            ]
        scores = {
            StubScenario.TRUSTED_GENUINE: (0.75, -0.75, -0.8),
            StubScenario.UNKNOWN_GENUINE: (-0.75, -0.75, -0.8),
            StubScenario.TRUSTED_CLONE: (0.75, 0.75, 0.8),
        }[scenario]
        return [
            (EventType.FAST, EvidenceType.IDENTITY, scores[0], {}),
            (EventType.FAST, EvidenceType.SPOOF_FAST, scores[1], {}),
            (EventType.DEEP, EvidenceType.SPOOF_DEEP, scores[2], {}),
        ]


class _CallbackResponse(Protocol):
    status_code: int

    def json(self) -> Any: ...


class _AsyncCallbackClient(Protocol):
    async def post(
        self,
        url: str,
        *,
        json: Mapping[str, Any],
        headers: Mapping[str, str],
        timeout: float,
    ) -> _CallbackResponse: ...


class BackendEvidenceAcceptance(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", populate_by_name=True)

    evidence_event_id: UUID = Field(alias="evidenceEventId")
    event_id: UUID = Field(alias="eventId")
    acceptance_status: str = Field(alias="acceptanceStatus", pattern=r"^(ACCEPTED|STALE)$")


class BackendEvidenceCallbackClient:
    """Authenticated, idempotent, bounded delivery to the Phase J backend callback."""

    def __init__(
        self,
        *,
        endpoint: str,
        service_secret: str,
        client: _AsyncCallbackClient,
        timeout_seconds: float = 5.0,
        maximum_attempts: int = 2,
    ) -> None:
        if not endpoint.startswith(("http://", "https://")):
            raise CallbackDeliveryError("BACKEND_CALLBACK_URL_INVALID")
        if not service_secret or not 0.1 <= timeout_seconds <= 30.0:
            raise CallbackDeliveryError("BACKEND_CALLBACK_CONFIG_INVALID")
        if maximum_attempts not in {1, 2, 3}:
            raise CallbackDeliveryError("BACKEND_CALLBACK_CONFIG_INVALID")
        self.endpoint = endpoint
        self._service_secret = service_secret
        self._client = client
        self._timeout_seconds = timeout_seconds
        self._maximum_attempts = maximum_attempts

    async def send(self, event: DevelopmentEvidenceEvent) -> BackendEvidenceAcceptance:
        body = event.callback_body()
        headers = {
            "Authorization": f"Bearer {self._service_secret}",
            "X-SWAR-Service": "swar-ml",
            "Idempotency-Key": str(event.event_id),
        }
        response: _CallbackResponse | None = None
        for attempt in range(1, self._maximum_attempts + 1):
            try:
                response = await self._client.post(
                    self.endpoint,
                    json=body,
                    headers=headers,
                    timeout=self._timeout_seconds,
                )
            except Exception as error:
                if attempt == self._maximum_attempts:
                    raise CallbackDeliveryError("BACKEND_CALLBACK_UNAVAILABLE") from error
                continue
            if response.status_code >= 500 and attempt < self._maximum_attempts:
                continue
            break
        if response is None:
            raise CallbackDeliveryError("BACKEND_CALLBACK_UNAVAILABLE")
        if response.status_code != 202:
            raise CallbackDeliveryError(
                "BACKEND_CALLBACK_REJECTED",
                status_code=response.status_code,
            )
        try:
            acceptance = BackendEvidenceAcceptance.model_validate(response.json())
        except Exception as error:
            raise CallbackDeliveryError("BACKEND_CALLBACK_RESPONSE_INVALID") from error
        if acceptance.event_id != event.event_id:
            raise CallbackDeliveryError("BACKEND_CALLBACK_RESPONSE_MISMATCH")
        return acceptance
