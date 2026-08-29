import asyncio

from httpx import ASGITransport, AsyncClient

from app.main import app


async def get(path: str):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(path)


def test_liveness_returns_200() -> None:
    response = asyncio.run(get("/health"))

    assert response.status_code == 200
    assert response.json() == {"service": "swar-ml", "status": "ok"}


def test_phase_c_app_exposes_no_model_or_business_endpoint() -> None:
    assert asyncio.run(get("/docs")).status_code == 404
    assert asyncio.run(get("/api/v1")).status_code == 404
