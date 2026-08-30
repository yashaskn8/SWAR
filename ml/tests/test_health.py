import asyncio

from httpx import ASGITransport, AsyncClient

from app.main import app, create_app
from tests.conftest import TEST_ENVIRONMENT


async def get(path: str):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(path)


def test_liveness_returns_200() -> None:
    response = asyncio.run(get("/health"))

    assert response.status_code == 200
    assert response.json() == {"service": "swar-ml", "status": "ok"}


def test_production_readiness_remains_blocked_by_phase_o() -> None:
    response = asyncio.run(get("/health/ready"))

    assert response.status_code == 503
    assert response.json()["productionStatus"] == "BLOCKED"
    assert "CALIBRATION_BLOCKED" in response.json()["reasons"]
    assert "PROMOTION_APPROVAL_MISSING" in response.json()["reasons"]


def test_private_service_exposes_no_business_or_frontend_endpoint() -> None:
    assert asyncio.run(get("/docs")).status_code == 404
    assert asyncio.run(get("/api/v1")).status_code == 404


def test_calibrated_production_configuration_still_fails_readiness_without_phase_o() -> None:
    from app.inference.fast_path import SimulatedModelRuntime

    environment = {
        **TEST_ENVIRONMENT,
        "APP_ENV": "production",
        "ML_PROVIDER": "real",
        "ML_EVIDENCE_MODE": "CALIBRATED",
        "BACKEND_EVIDENCE_URL": "https://backend.test/api/v1/internal/ml/evidence",
        "LIVEKIT_URL": "wss://livekit.test",
        "ML_CHECKPOINT_ROOT": "missing-phase-p-checkpoints",
    }
    runtime = SimulatedModelRuntime()
    application = create_app(environment, inference_runtime=runtime)

    async def ready():
        transport = ASGITransport(app=application)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/health/ready")
        await application.state.session_manager.shutdown()
        return response

    response = asyncio.run(ready())
    assert response.status_code == 503
    assert response.json()["productionStatus"] == "BLOCKED"
    assert "CALIBRATION_BLOCKED" in response.json()["reasons"]
    assert "MODEL_ARTIFACT_CHECKSUM_INVALID" in response.json()["reasons"]
