"""Authenticated idempotent analysis-session control endpoints."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response, status

from app.core.security import VerifiedServiceRequest, authenticate_backend_request
from app.inference.session_pipeline import AnalysisSessionManager
from app.schemas.analysis import AnalysisAccepted, AnalysisSessionRequest, StopAnalysisRequest


def create_analysis_router() -> APIRouter:
    router = APIRouter(prefix="/internal/v1")

    @router.post(
        "/analysis-sessions",
        response_model=AnalysisAccepted,
        status_code=status.HTTP_202_ACCEPTED,
    )
    async def create_session(
        body: AnalysisSessionRequest,
        request: Request,
        verified: Annotated[VerifiedServiceRequest, Depends(authenticate_backend_request)],
    ) -> AnalysisAccepted:
        manager: AnalysisSessionManager = request.app.state.session_manager
        await manager.create(body, verified.idempotency_key)
        return AnalysisAccepted()

    @router.post(
        "/analysis-sessions/{analysis_session_id}/stop",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    async def stop_session(
        analysis_session_id: UUID,
        body: StopAnalysisRequest,
        request: Request,
        verified: Annotated[VerifiedServiceRequest, Depends(authenticate_backend_request)],
    ) -> Response:
        manager: AnalysisSessionManager = request.app.state.session_manager
        await manager.stop(
            analysis_session_id,
            verified.idempotency_key,
            body.reason_code,
        )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return router
