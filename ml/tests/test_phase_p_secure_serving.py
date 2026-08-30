from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import time
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import httpx
from httpx import ASGITransport, AsyncClient
from livekit import rtc

from app.core.config import EvidenceMode, MlSettings
from app.core.telemetry import Telemetry
from app.inference.session_pipeline import AnalysisSessionError, AnalysisSessionManager
from app.main import create_app
from app.media.audio_stream import BoundedLatestQueue, MediaFrame
from app.media.livekit_subscriber import LiveKitMediaSubscription, MediaSubscriptionError
from app.schemas.analysis import AnalysisSessionRequest, EventType, EvidenceEvent, EvidenceType
from app.services.evidence_client import EvidenceClient, EvidenceDeliveryError
from tests.conftest import TEST_ENVIRONMENT


class IdleSubscription:
    def __init__(self) -> None:
        self.closed = False

    async def connect(self) -> None:
        return None

    async def frames(self):
        await asyncio.Event().wait()
        if False:
            yield MediaFrame(bytearray(), 16_000, 1, 0, 0)

    async def close(self) -> None:
        self.closed = True


class IdleSubscriberFactory:
    def __init__(self) -> None:
        self.bindings: list[AnalysisSessionRequest] = []
        self.subscriptions: list[IdleSubscription] = []

    def create(self, binding: AnalysisSessionRequest) -> IdleSubscription:
        self.bindings.append(binding)
        subscription = IdleSubscription()
        self.subscriptions.append(subscription)
        return subscription


class FixtureRuntime:
    def __init__(self, *, ready: bool = True) -> None:
        self._ready = ready
        self.closed = False

    @property
    def ready(self) -> bool:
        return self._ready

    async def fast(self, *_args):
        return ()

    async def deep(self, *_args):
        raise AssertionError("deep inference was not expected")

    async def close(self) -> None:
        self.closed = True


class FixtureEvidenceClient:
    def __init__(self) -> None:
        self.closed = False

    async def send(self, _event):
        raise AssertionError("evidence delivery was not expected")

    async def close(self) -> None:
        self.closed = True


def settings(**overrides: str) -> MlSettings:
    environment = deepcopy(TEST_ENVIRONMENT)
    environment.update(overrides)
    return MlSettings.from_environment(environment)


def analysis_body(**overrides: object) -> dict[str, object]:
    now = datetime.now(UTC)
    body: dict[str, object] = {
        "schemaVersion": "2.0.0",
        "organizationId": str(uuid4()),
        "analysisSessionId": str(uuid4()),
        "callId": str(uuid4()),
        "trackBindingId": str(uuid4()),
        "bindingRevision": 1,
        "evidenceMode": "SIMULATED",
        "roomName": "swar-test-room",
        "participantIdentity": "caller:test-authorized",
        "trackSid": "TR_authorized",
        "grantToken": "ephemeral-livekit-grant",
        "grantExpiresAt": (now + timedelta(minutes=2)).isoformat(),
    }
    body.update(overrides)
    return body


def signed_headers(
    body: bytes,
    *,
    path: str = "/internal/v1/analysis-sessions",
    timestamp: int | None = None,
    nonce: str = "phase-p-nonce-0001",
    idempotency_key: str = "phase-p-idempotency-0001",
    secret: str = TEST_ENVIRONMENT["ML_INTERNAL_SECRET"],
) -> dict[str, str]:
    timestamp_text = str(timestamp if timestamp is not None else int(time.time()))
    canonical = "\n".join(
        [
            "POST",
            path,
            timestamp_text,
            nonce,
            idempotency_key,
            hashlib.sha256(body).hexdigest(),
        ]
    )
    signature = hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()
    return {
        "Authorization": f"Bearer {secret}",
        "Content-Type": "application/json",
        "X-SWAR-Service": "swar-backend",
        "X-SWAR-Timestamp": timestamp_text,
        "X-SWAR-Nonce": nonce,
        "X-SWAR-Signature": signature,
        "Idempotency-Key": idempotency_key,
    }


async def post_signed(application, body: dict[str, object], **header_overrides):
    raw = json.dumps(body, separators=(",", ":")).encode()
    headers = signed_headers(raw, **header_overrides)
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.post("/internal/v1/analysis-sessions", content=raw, headers=headers)


def test_control_api_rejects_missing_invalid_expired_and_replayed_authentication() -> None:
    async def scenario() -> None:
        factory = IdleSubscriberFactory()
        application = create_app(
            TEST_ENVIRONMENT,
            subscriber_factory=factory,
            inference_runtime=FixtureRuntime(),
            evidence_client=FixtureEvidenceClient(),
        )
        body = analysis_body()
        raw = json.dumps(body, separators=(",", ":")).encode()
        transport = ASGITransport(app=application)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            missing = await client.post("/internal/v1/analysis-sessions", content=raw)
            assert missing.status_code == 401
            invalid = await client.post(
                "/internal/v1/analysis-sessions",
                content=raw,
                headers=signed_headers(raw, secret="wrong-secret-that-is-at-least-32-bytes"),
            )
            assert invalid.status_code == 401
            expired = await client.post(
                "/internal/v1/analysis-sessions",
                content=raw,
                headers=signed_headers(raw, timestamp=int(time.time()) - 90, nonce="expired-nonce"),
            )
            assert expired.status_code == 401
            headers = signed_headers(raw, nonce="single-use-nonce")
            assert (
                await client.post("/internal/v1/analysis-sessions", content=raw, headers=headers)
            ).status_code == 202
            replay = await client.post(
                "/internal/v1/analysis-sessions", content=raw, headers=headers
            )
            assert replay.status_code == 409
            assert replay.json()["code"] == "INTERNAL_AUTH_REPLAY_DETECTED"
        await application.state.session_manager.shutdown()

    asyncio.run(scenario())


def test_exact_binding_rejects_cross_tenant_track_substitution_and_overload() -> None:
    async def scenario() -> None:
        application = create_app(
            {**TEST_ENVIRONMENT, "ML_MAX_CONCURRENT_SESSIONS": "1"},
            subscriber_factory=IdleSubscriberFactory(),
            inference_runtime=FixtureRuntime(),
            evidence_client=FixtureEvidenceClient(),
        )
        first = analysis_body()
        assert (
            await post_signed(application, first, nonce="binding-first-nonce")
        ).status_code == 202

        substituted = dict(first)
        substituted["organizationId"] = str(uuid4())
        substituted["trackSid"] = "TR_substituted"
        conflict = await post_signed(
            application,
            substituted,
            nonce="binding-conflict-nonce",
            idempotency_key="binding-conflict-key",
        )
        assert conflict.status_code == 409
        assert conflict.json()["code"] == "ANALYSIS_BINDING_CONFLICT"

        overloaded = await post_signed(
            application,
            analysis_body(),
            nonce="overload-second-nonce",
            idempotency_key="overload-second-key",
        )
        assert overloaded.status_code == 429
        assert overloaded.json()["code"] == "ANALYSIS_CAPACITY_EXCEEDED"
        await application.state.session_manager.shutdown()

    asyncio.run(scenario())


def test_expired_grant_and_model_outage_fail_closed() -> None:
    async def scenario() -> None:
        application = create_app(
            TEST_ENVIRONMENT,
            subscriber_factory=IdleSubscriberFactory(),
            inference_runtime=FixtureRuntime(ready=False),
            evidence_client=FixtureEvidenceClient(),
        )
        outage = await post_signed(application, analysis_body(), nonce="model-outage-nonce")
        assert outage.status_code == 503
        assert outage.json()["code"] == "MODEL_RUNTIME_NOT_READY"
        await application.state.session_manager.shutdown()

        application = create_app(
            TEST_ENVIRONMENT,
            subscriber_factory=IdleSubscriberFactory(),
            inference_runtime=FixtureRuntime(),
            evidence_client=FixtureEvidenceClient(),
        )
        expired = await post_signed(
            application,
            analysis_body(grantExpiresAt=(datetime.now(UTC) - timedelta(seconds=1)).isoformat()),
            nonce="grant-expired-nonce",
        )
        assert expired.status_code == 401
        assert expired.json()["code"] == "ANALYSIS_GRANT_EXPIRED"
        await application.state.session_manager.shutdown()

    asyncio.run(scenario())


def pipeline_error_event() -> EvidenceEvent:
    return EvidenceEvent(
        eventType=EventType.PIPELINE_ERROR,
        eventId=uuid4(),
        schemaVersion="1.0.0",
        evidenceMode="SIMULATED",
        organizationId=uuid4(),
        callId=uuid4(),
        analysisSessionId=uuid4(),
        trackBindingId=uuid4(),
        eventSequence="1",
        windowSequence="1",
        revision=0,
        evidenceType=EvidenceType.PIPELINE_ERROR,
        windowStartMs="0",
        windowEndMs="0",
        observedAt=datetime.now(UTC),
        reasonCodes=["SIMULATED_NON_SCIENTIFIC_EVIDENCE"],
        errorCode="FIXTURE_PIPELINE_ERROR",
    )


def test_callback_retry_is_bounded_idempotent_and_privacy_safe() -> None:
    async def scenario() -> None:
        attempts = 0
        event = pipeline_error_event()

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal attempts
            attempts += 1
            assert request.headers["Idempotency-Key"] == str(event.event_id)
            assert request.headers["X-SWAR-Service"] == "swar-ml"
            if attempts == 1:
                return httpx.Response(503)
            return httpx.Response(
                202,
                json={
                    "evidenceEventId": str(uuid4()),
                    "eventId": str(event.event_id),
                    "acceptanceStatus": "ACCEPTED",
                },
            )

        telemetry = Telemetry()
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = EvidenceClient(settings(), telemetry, client=http_client)
            first = await client.send(event)
            second = await client.send(event)
            assert first == second
            assert attempts == 2
            rendered = telemetry.render_prometheus()
            assert "swar_ml_evidence_retries_total" in rendered
            assert TEST_ENVIRONMENT["ML_INTERNAL_SECRET"] not in rendered

        failing_transport = httpx.MockTransport(lambda _request: httpx.Response(503))
        async with httpx.AsyncClient(transport=failing_transport) as http_client:
            client = EvidenceClient(settings(), Telemetry(), client=http_client)
            try:
                await client.send(event.model_copy(update={"event_id": uuid4()}))
            except EvidenceDeliveryError as error:
                assert error.code == "BACKEND_CALLBACK_UNAVAILABLE"
            else:
                raise AssertionError("callback outage must fail after bounded retries")
            assert len(client.dead_letters) == 1
            assert client.dead_letters[0].error_code == "BACKEND_CALLBACK_UNAVAILABLE"

    asyncio.run(scenario())


def test_queue_overload_and_shutdown_zero_sensitive_buffers() -> None:
    telemetry = Telemetry()
    queue = BoundedLatestQueue[MediaFrame](
        1,
        queue_name="frames",
        drop_reason="FRAME_QUEUE_OVERLOAD_DROP_OLDEST",
        telemetry=telemetry,
    )
    dropped = MediaFrame(bytearray(b"private audio"), 16_000, 1, 13, 1)
    retained = MediaFrame(bytearray(b"new private audio"), 16_000, 1, 17, 2)
    queue.put_latest(dropped)
    queue.put_latest(retained)
    assert dropped.payload == bytearray()
    queue.clear()
    assert retained.payload == bytearray()
    assert "FRAME_QUEUE_OVERLOAD_DROP_OLDEST" in telemetry.render_prometheus()


def test_livekit_room_participant_and_exact_audio_track_binding() -> None:
    async def rejects_room() -> None:
        binding = AnalysisSessionRequest.model_validate(analysis_body())
        subscription = LiveKitMediaSubscription(binding, settings(), Telemetry())
        authorized_participant = SimpleNamespace(identity=binding.participant_identity)
        wrong_participant = SimpleNamespace(identity="caller:substituted")
        authorized_track = SimpleNamespace(sid=binding.track_sid, kind=rtc.TrackKind.KIND_AUDIO)
        wrong_track = SimpleNamespace(sid="TR_wrong", kind=rtc.TrackKind.KIND_AUDIO)
        non_audio = SimpleNamespace(sid=binding.track_sid, kind=rtc.TrackKind.KIND_VIDEO)
        assert subscription._matches(authorized_track, authorized_participant)
        assert not subscription._matches(wrong_track, authorized_participant)
        assert not subscription._matches(authorized_track, wrong_participant)
        assert not subscription._matches(non_audio, authorized_participant)

        class WrongRoom:
            name = "substituted-room"
            remote_participants: dict[str, object] = {}

            async def connect(self, *_args, **_kwargs) -> None:
                return None

            async def disconnect(self) -> None:
                return None

        subscription._room = WrongRoom()
        try:
            await subscription.connect()
        except MediaSubscriptionError as error:
            assert error.code == "LIVEKIT_ROOM_BINDING_MISMATCH"
        else:
            raise AssertionError("substituted room must be rejected")

    asyncio.run(rejects_room())


def test_manager_shutdown_cancels_sessions_and_closes_dependencies() -> None:
    async def scenario() -> None:
        factory = IdleSubscriberFactory()
        runtime = FixtureRuntime()
        evidence = FixtureEvidenceClient()
        manager = AnalysisSessionManager(settings(), factory, runtime, evidence, Telemetry())
        binding = AnalysisSessionRequest.model_validate(analysis_body())
        await manager.create(binding, "shutdown-idempotency-key")
        await asyncio.sleep(0)
        await manager.stop(binding.analysis_session_id, "stop-idempotency-key", "CALL_ENDED")
        await manager.stop(binding.analysis_session_id, "stop-idempotency-key", "CALL_ENDED")
        try:
            await manager.stop(
                binding.analysis_session_id,
                "stop-idempotency-key",
                "SUBSTITUTED_REASON",
            )
        except AnalysisSessionError as error:
            assert error.code == "IDEMPOTENCY_KEY_CONFLICT"
        else:
            raise AssertionError("conflicting stop replay must be rejected")
        try:
            await manager.create(binding, "late-restart-key")
        except AnalysisSessionError as error:
            assert error.code == "ANALYSIS_SESSION_ALREADY_STOPPED"
        else:
            raise AssertionError("a stopped analysis session must not be restarted")
        await manager.shutdown()
        assert manager.active_sessions == 0
        assert runtime.closed
        assert evidence.closed
        assert factory.subscriptions and factory.subscriptions[0].closed

    asyncio.run(scenario())


def test_livekit_reconnect_is_bounded_and_mode_substitution_is_rejected() -> None:
    class FailingSubscription(IdleSubscription):
        async def connect(self) -> None:
            raise MediaSubscriptionError("LIVEKIT_DISCONNECTED")

    class ReconnectingFactory(IdleSubscriberFactory):
        def create(self, binding: AnalysisSessionRequest) -> IdleSubscription:
            self.bindings.append(binding)
            subscription = FailingSubscription() if not self.subscriptions else IdleSubscription()
            self.subscriptions.append(subscription)
            return subscription

    async def scenario() -> None:
        telemetry = Telemetry()
        factory = ReconnectingFactory()
        manager = AnalysisSessionManager(
            settings(), factory, FixtureRuntime(), FixtureEvidenceClient(), telemetry
        )
        binding = AnalysisSessionRequest.model_validate(analysis_body())
        await manager.create(binding, "reconnect-idempotency-key")
        await asyncio.sleep(0.05)
        assert len(factory.subscriptions) == 2
        assert "swar_ml_livekit_retries_total" in telemetry.render_prometheus()

        shadow_binding = binding.model_copy(
            update={"analysis_session_id": uuid4(), "evidence_mode": EvidenceMode.SHADOW}
        )
        try:
            await manager.create(shadow_binding, "mode-substitution-key")
        except AnalysisSessionError as error:
            assert error.code == "EVIDENCE_MODE_NOT_AUTHORIZED"
        else:
            raise AssertionError("session evidence-mode substitution must be rejected")
        await manager.shutdown()

    asyncio.run(scenario())
