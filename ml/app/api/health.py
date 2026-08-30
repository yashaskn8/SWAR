"""Liveness, fail-closed production readiness, and non-sensitive metrics."""

from __future__ import annotations

import json
from typing import Literal, Protocol

from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel, ConfigDict

from app.audio.config import load_audio_config
from app.core.config import EvidenceMode, MlSettings
from app.core.telemetry import Telemetry
from app.models.registry import ModelRegistry


class RuntimeReadiness(Protocol):
    @property
    def ready(self) -> bool: ...


class HealthResponse(BaseModel):
    model_config = ConfigDict(frozen=True)
    service: Literal["swar-ml"] = "swar-ml"
    status: Literal["ok"] = "ok"


class ReadinessResponse(BaseModel):
    model_config = ConfigDict(frozen=True)
    service: Literal["swar-ml"] = "swar-ml"
    engineeringStatus: Literal["READY", "NOT_READY"]
    productionStatus: Literal["READY", "BLOCKED"]
    evidenceMode: EvidenceMode
    reasons: tuple[str, ...]


class ReadinessInspector:
    def __init__(
        self,
        settings: MlSettings,
        runtime: RuntimeReadiness,
        telemetry: Telemetry,
    ) -> None:
        self.settings = settings
        self.runtime = runtime
        self.telemetry = telemetry

    def inspect(self) -> ReadinessResponse:
        reasons: list[str] = []
        calibration: dict[str, object] = {}
        try:
            calibration = json.loads(self.settings.calibration_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            reasons.append("CALIBRATION_ARTIFACT_INVALID")
        try:
            registry = ModelRegistry.load(self.settings.model_registry_path)
            if calibration.get("registry_sha256") != registry.registry_sha256:
                reasons.append("MODEL_REGISTRY_CHECKSUM_MISMATCH")
            if self.settings.provider == "real":
                for model in registry.document.models:
                    registry.verify(model.model_id, self.settings.checkpoint_root)
        except Exception:
            reasons.append("MODEL_ARTIFACT_CHECKSUM_INVALID")
        try:
            audio = load_audio_config(self.settings.audio_config_path)
            if calibration.get("preprocessing_version") != audio.preprocessing_version:
                reasons.append("PREPROCESSING_CHECKSUM_MISMATCH")
        except Exception:
            reasons.append("PREPROCESSING_ARTIFACT_INVALID")
        if calibration.get("status") != "PROMOTED":
            reasons.append("CALIBRATION_BLOCKED")
        if not calibration.get("calibration_package_version"):
            reasons.append("CALIBRATION_PACKAGE_MISSING")
        if calibration.get("promotion_decision") != "PROMOTED":
            reasons.append("PROMOTION_APPROVAL_MISSING")
        if self.settings.evidence_mode is not EvidenceMode.CALIBRATED:
            reasons.append("CALIBRATED_MODE_NOT_SELECTED")
        if self.settings.provider != "real":
            reasons.append("NON_PRODUCTION_PROVIDER_SELECTED")
        if not self.runtime.ready:
            reasons.append("MODEL_RUNTIME_NOT_READY")
        unique = tuple(sorted(set(reasons)))
        for reason in unique:
            self.telemetry.increment("swar_ml_readiness_failures_total", reason)
        engineering_ready = self.runtime.ready and (
            self.settings.app_env != "production"
            or (self.settings.evidence_mode is EvidenceMode.CALIBRATED and not unique)
        )
        return ReadinessResponse(
            engineeringStatus="READY" if engineering_ready else "NOT_READY",
            productionStatus="READY" if not unique else "BLOCKED",
            evidenceMode=self.settings.evidence_mode,
            reasons=unique,
        )


def create_health_router() -> APIRouter:
    router = APIRouter()

    @router.get("/health", response_model=HealthResponse)
    @router.get("/health/live", response_model=HealthResponse)
    async def liveness() -> HealthResponse:
        return HealthResponse()

    @router.get("/health/ready", response_model=ReadinessResponse)
    async def readiness(request: Request, response: Response) -> ReadinessResponse:
        report: ReadinessResponse = request.app.state.readiness.inspect()
        if report.productionStatus != "READY":
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return report

    @router.get("/metrics", response_class=Response)
    async def metrics(request: Request) -> Response:
        telemetry: Telemetry = request.app.state.telemetry
        return Response(content=telemetry.render_prometheus(), media_type="text/plain")

    return router
