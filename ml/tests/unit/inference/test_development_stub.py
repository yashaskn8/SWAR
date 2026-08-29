from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

import pytest

from app.inference.development_stub import (
    BackendEvidenceCallbackClient,
    CallbackDeliveryError,
    DeepDeliveryOrder,
    DevelopmentStub,
    DevelopmentStubConfigurationError,
    EventType,
    StubEventContext,
    StubScenario,
    StubScenarioConfig,
)
from app.main import create_app


def context() -> StubEventContext:
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


def test_stub_requires_both_environment_gates_and_production_startup_rejects_it() -> None:
    with pytest.raises(DevelopmentStubConfigurationError, match="STUB_PROVIDER_NOT_SELECTED"):
        DevelopmentStub.from_environment({"APP_ENV": "test", "ML_PROVIDER": "real"})
    with pytest.raises(DevelopmentStubConfigurationError, match="STUB_ENVIRONMENT_NOT_ALLOWED"):
        DevelopmentStub.from_environment({"APP_ENV": "", "ML_PROVIDER": "stub"})
    with pytest.raises(DevelopmentStubConfigurationError, match="STUB_FORBIDDEN_IN_PRODUCTION"):
        DevelopmentStub.from_environment({"APP_ENV": "production", "ML_PROVIDER": "stub"})
    with pytest.raises(DevelopmentStubConfigurationError, match="STUB_FORBIDDEN_IN_PRODUCTION"):
        create_app({"APP_ENV": "production", "ML_PROVIDER": "stub"})


def test_stub_outputs_are_deterministic_and_every_event_is_explicitly_labelled() -> None:
    stub = DevelopmentStub.from_environment({"APP_ENV": "test", "ML_PROVIDER": "stub"})
    config = StubScenarioConfig(scenario=StubScenario.TRUSTED_CLONE)

    first = stub.events(config, context())
    second = stub.events(config, context())

    assert [event.callback_body() for event in first] == [event.callback_body() for event in second]
    assert [event.event_type for event in first] == [EventType.FAST, EventType.FAST, EventType.DEEP]
    for event in first:
        assert "PROVIDER_STUB" in event.reason_codes
        assert "SCENARIO_TRUSTED_CLONE" in event.reason_codes
        assert "NON_SCIENTIFIC_TEST_EVIDENCE" in event.reason_codes
        assert event.callback_body()["scoreName"] == "stub_non_scientific_raw_score"


def test_deep_delivery_can_be_configured_before_fast_without_reusing_sequence_numbers() -> None:
    stub = DevelopmentStub.from_environment({"APP_ENV": "development", "ML_PROVIDER": "stub"})
    events = stub.events(
        StubScenarioConfig(
            scenario=StubScenario.TRUSTED_GENUINE,
            deep_delivery_order=DeepDeliveryOrder.BEFORE_FAST,
        ),
        context(),
    )

    assert events[0].event_type is EventType.DEEP
    assert [event.event_sequence for event in events] == ["1", "2", "3"]
    assert len({event.event_id for event in events}) == len(events)


class FakeResponse:
    def __init__(self, status_code: int, body: dict[str, Any]) -> None:
        self.status_code = status_code
        self._body = body

    def json(self) -> dict[str, Any]:
        return self._body


class FakeClient:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self.responses = responses
        self.requests: list[dict[str, Any]] = []

    async def post(self, url: str, **kwargs: Any) -> FakeResponse:
        self.requests.append({"url": url, **kwargs})
        return self.responses.pop(0)


def test_authenticated_callback_retries_only_with_the_same_idempotency_identity() -> None:
    event = DevelopmentStub.from_environment({"APP_ENV": "test", "ML_PROVIDER": "stub"}).events(
        StubScenarioConfig(scenario=StubScenario.INSUFFICIENT_AUDIO), context()
    )[0]
    accepted = {
        "evidenceEventId": "018f0000-0000-7000-8000-000000000099",
        "eventId": str(event.event_id),
        "acceptanceStatus": "ACCEPTED",
    }
    transport = FakeClient([FakeResponse(503, {}), FakeResponse(202, accepted)])
    client = BackendEvidenceCallbackClient(
        endpoint="http://127.0.0.1:3000/api/v1/internal/ml/evidence",
        service_secret="test-only-internal-secret",
        client=transport,
    )

    result = asyncio.run(client.send(event))

    assert result.acceptance_status == "ACCEPTED"
    assert len(transport.requests) == 2
    assert {request["headers"]["Idempotency-Key"] for request in transport.requests} == {
        str(event.event_id)
    }
    assert transport.requests[0]["headers"]["X-SWAR-Service"] == "swar-ml"
    assert transport.requests[0]["headers"]["Authorization"] == ("Bearer test-only-internal-secret")


def test_callback_does_not_retry_a_backend_contract_rejection() -> None:
    event = DevelopmentStub.from_environment({"APP_ENV": "test", "ML_PROVIDER": "stub"}).events(
        StubScenarioConfig(scenario=StubScenario.PIPELINE_FAILURE), context()
    )[0]
    transport = FakeClient([FakeResponse(409, {"code": "CONFLICT"})])
    client = BackendEvidenceCallbackClient(
        endpoint="http://127.0.0.1:3000/api/v1/internal/ml/evidence",
        service_secret="test-only-internal-secret",
        client=transport,
    )

    with pytest.raises(CallbackDeliveryError) as captured:
        asyncio.run(client.send(event))

    assert captured.value.code == "BACKEND_CALLBACK_REJECTED"
    assert captured.value.status_code == 409
    assert len(transport.requests) == 1
