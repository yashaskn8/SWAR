import os
from collections.abc import Mapping
from typing import Literal

from fastapi import FastAPI, status
from pydantic import BaseModel, ConfigDict

from app.inference.development_stub import assert_stub_not_selected_in_production


class HealthResponse(BaseModel):
    """Typed liveness response with no model-readiness claim."""

    model_config = ConfigDict(frozen=True)

    service: Literal["swar-ml"]
    status: Literal["ok"]


def create_app(environment: Mapping[str, str] | None = None) -> FastAPI:
    """Create the service only after applying production provider safety gates."""

    assert_stub_not_selected_in_production(environment or os.environ)
    application = FastAPI(
        title="SWAR ML service",
        docs_url=None,
        openapi_url=None,
        redoc_url=None,
    )

    @application.get("/health", response_model=HealthResponse, status_code=status.HTTP_200_OK)
    async def get_liveness() -> HealthResponse:
        """Report process liveness without loading or claiming model readiness."""

        return HealthResponse(service="swar-ml", status="ok")

    return application


app = create_app()
