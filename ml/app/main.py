"""SWAR Phase P private secure ML/media service."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api.analysis_sessions import create_analysis_router
from app.api.health import ReadinessInspector, create_health_router
from app.core.config import ConfigurationError, MlSettings
from app.core.security import BackendRequestAuthenticator, ServiceAuthenticationError
from app.core.telemetry import Telemetry
from app.inference.development_stub import assert_stub_not_selected_in_production
from app.inference.fast_path import (
    InferenceRuntime,
    RealModelRuntime,
    SimulatedModelRuntime,
)
from app.inference.session_pipeline import AnalysisSessionError, AnalysisSessionManager
from app.media.livekit_subscriber import LiveKitSubscriberFactory, MediaSubscriberFactory
from app.models.registry import ModelRegistry
from app.services.evidence_client import EvidenceClient


def create_app(
    environment: Mapping[str, str] | None = None,
    *,
    subscriber_factory: MediaSubscriberFactory | None = None,
    inference_runtime: InferenceRuntime | None = None,
    evidence_client: EvidenceClient | None = None,
) -> FastAPI:
    source = environment or os.environ
    assert_stub_not_selected_in_production(source)
    settings = MlSettings.from_environment(source)
    telemetry = Telemetry()
    runtime = inference_runtime or _create_runtime(settings)
    callback = evidence_client or EvidenceClient(settings, telemetry)
    media = subscriber_factory or LiveKitSubscriberFactory(settings, telemetry)
    manager = AnalysisSessionManager(settings, media, runtime, callback, telemetry)
    readiness = ReadinessInspector(settings, runtime, telemetry)
    manager.readiness = readiness

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        load = getattr(runtime, "load", None)
        if callable(load) and not runtime.ready:
            try:
                await load()
            except Exception:
                telemetry.increment("swar_ml_readiness_failures_total", "MODEL_LOAD_FAILED")
        try:
            yield
        finally:
            await manager.shutdown()

    application = FastAPI(
        title="SWAR ML service",
        docs_url=None,
        openapi_url=None,
        redoc_url=None,
        lifespan=lifespan,
    )
    application.state.settings = settings
    application.state.telemetry = telemetry
    application.state.backend_authenticator = BackendRequestAuthenticator(settings)
    application.state.session_manager = manager
    application.state.readiness = readiness
    application.include_router(create_health_router())
    application.include_router(create_analysis_router())

    @application.exception_handler(ServiceAuthenticationError)
    async def authentication_error(
        _request: Request, error: ServiceAuthenticationError
    ) -> JSONResponse:
        telemetry.increment("swar_ml_authentication_failures_total", error.code)
        return _error(error.code, error.status_code)

    @application.exception_handler(AnalysisSessionError)
    async def session_error(_request: Request, error: AnalysisSessionError) -> JSONResponse:
        return _error(error.code, error.status_code)

    @application.exception_handler(RequestValidationError)
    async def validation_error(
        _request: Request, _error_value: RequestValidationError
    ) -> JSONResponse:
        return _error("REQUEST_CONTRACT_INVALID", 400)

    return application


def _create_runtime(settings: MlSettings) -> InferenceRuntime:
    if settings.provider == "stub":
        return SimulatedModelRuntime()
    if settings.provider == "fixture":
        raise ConfigurationError("FIXTURE_RUNTIME_MUST_BE_INJECTED")
    registry = ModelRegistry.load(settings.model_registry_path)
    return RealModelRuntime(
        registry,
        checkpoint_root=settings.checkpoint_root,
        device=settings.model_device,
        timeout_seconds=settings.model_timeout_seconds,
    )


def _error(code: str, status_code: int) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": "The internal request could not be completed."},
    )


app = create_app()
