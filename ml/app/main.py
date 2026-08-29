from typing import Literal

from fastapi import FastAPI, status
from pydantic import BaseModel, ConfigDict


class HealthResponse(BaseModel):
    """Typed liveness response with no model-readiness claim."""

    model_config = ConfigDict(frozen=True)

    service: Literal["swar-ml"]
    status: Literal["ok"]


app = FastAPI(
    title="SWAR ML service",
    docs_url=None,
    openapi_url=None,
    redoc_url=None,
)


@app.get("/health", response_model=HealthResponse, status_code=status.HTTP_200_OK)
async def get_liveness() -> HealthResponse:
    """Report process liveness without loading or claiming model readiness."""

    return HealthResponse(service="swar-ml", status="ok")
