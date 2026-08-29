from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID, uuid5

import httpx
import pytest

from app.inference.development_stub import (
    BackendEvidenceCallbackClient,
    CallbackDeliveryError,
    DeepDeliveryOrder,
    DevelopmentStub,
    StubEventContext,
    StubScenario,
    StubScenarioConfig,
)

BACKEND_EVENT_NAMESPACE = UUID("018f0000-0000-7000-8000-0000000000aa")


def stub_context() -> StubEventContext:
    return StubEventContext(
        organization_id="018f0000-0000-7000-8000-000000000002",
        call_id="018f0000-0000-7000-8000-000000000003",
        analysis_session_id="018f0000-0000-7000-8000-000000000004",
        track_binding_id="018f0000-0000-7000-8000-000000000005",
        window_sequence=1,
        window_start_ms=0,
        window_end_ms=4000,
        observed_at=datetime(2030, 1, 1, 0, 0, 4, tzinfo=UTC),
    )


async def deliver_all() -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    schema_path = (
        Path(__file__).parents[3] / "docs" / "contracts" / "schemas" / "ml-evidence.v1.json"
    )
    contract = json.loads(schema_path.read_text(encoding="utf-8"))
    required = set(contract["required"])
    properties = set(contract["properties"])
    received: list[dict[str, Any]] = []
    persisted: dict[str, dict[str, Any]] = {}

    def backend(request: httpx.Request) -> httpx.Response:
        if request.headers.get("authorization") != "Bearer phase-m-test-secret":
            return httpx.Response(401, json={"code": "AUTHENTICATION_FAILED"})
        if request.headers.get("x-swar-service") != "swar-ml":
            return httpx.Response(401, json={"code": "AUTHENTICATION_FAILED"})
        body = json.loads(request.content)
        assert required.issubset(body)
        assert set(body).issubset(properties)
        event_id = str(body["eventId"])
        assert request.headers.get("idempotency-key") == event_id
        if event_id in persisted and persisted[event_id] != body:
            return httpx.Response(409, json={"code": "IDEMPOTENCY_KEY_CONFLICT"})
        persisted[event_id] = body
        received.append(body)
        evidence_id = uuid5(BACKEND_EVENT_NAMESPACE, event_id)
        return httpx.Response(
            202,
            json={
                "evidenceEventId": str(evidence_id),
                "eventId": event_id,
                "acceptanceStatus": "ACCEPTED",
            },
        )

    transport = httpx.MockTransport(backend)
    async with httpx.AsyncClient(transport=transport) as http_client:
        callback = BackendEvidenceCallbackClient(
            endpoint="http://backend.invalid/api/v1/internal/ml/evidence",
            service_secret="phase-m-test-secret",
            client=http_client,
            maximum_attempts=2,
        )
        stub = DevelopmentStub.from_environment({"APP_ENV": "test", "ML_PROVIDER": "stub"})
        events = [
            *stub.events(
                StubScenarioConfig(
                    scenario=StubScenario.TRUSTED_CLONE,
                    deep_delivery_order=DeepDeliveryOrder.BEFORE_FAST,
                ),
                stub_context(),
            ),
            *stub.events(
                StubScenarioConfig(scenario=StubScenario.INSUFFICIENT_AUDIO),
                stub_context().model_copy(update={"window_sequence": 2}),
            ),
            *stub.events(
                StubScenarioConfig(scenario=StubScenario.PIPELINE_FAILURE),
                stub_context().model_copy(update={"window_sequence": 3}),
            ),
        ]
        for event in events:
            acceptance = await callback.send(event)
            assert acceptance.event_id == event.event_id
        replay = await callback.send(events[0])
        assert replay.event_id == events[0].event_id
    return received, persisted


def test_all_callback_types_cross_the_authenticated_idempotent_contract() -> None:
    received, persisted = asyncio.run(deliver_all())

    assert {body["eventType"] for body in received} == {
        "FAST",
        "DEEP",
        "INSUFFICIENT_EVIDENCE",
        "PIPELINE_ERROR",
    }
    assert len(received) == 6
    assert len(persisted) == 5
    assert all("PROVIDER_STUB" in body["reasonCodes"] for body in received)
    assert all("NON_SCIENTIFIC_TEST_EVIDENCE" in body["reasonCodes"] for body in received)


def test_callback_authentication_failure_is_explicit_and_not_retried() -> None:
    def reject(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"code": "AUTHENTICATION_FAILED"})

    async def run() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(reject)) as http_client:
            callback = BackendEvidenceCallbackClient(
                endpoint="http://backend.invalid/api/v1/internal/ml/evidence",
                service_secret="wrong-test-secret",
                client=http_client,
            )
            event = DevelopmentStub.from_environment(
                {"APP_ENV": "test", "ML_PROVIDER": "stub"}
            ).events(StubScenarioConfig(scenario=StubScenario.PIPELINE_FAILURE), stub_context())[0]
            with pytest.raises(CallbackDeliveryError) as captured:
                await callback.send(event)
            assert captured.value.code == "BACKEND_CALLBACK_REJECTED"
            assert captured.value.status_code == 401

    asyncio.run(run())
