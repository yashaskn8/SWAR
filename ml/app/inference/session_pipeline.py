"""Per-call bounded media, preprocessing, inference, and evidence lifecycle."""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from time import monotonic
from uuid import UUID, uuid5

import numpy as np

from app.api.health import ReadinessInspector
from app.audio.config import load_audio_config
from app.audio.pcm_normalizer import PcmEnvelope
from app.audio.pipeline import AudioPreprocessor, PreparedWindow
from app.audio.quality import EvidenceReadiness, QualityEvidence
from app.core.config import EvidenceMode, MlSettings
from app.core.telemetry import Telemetry
from app.inference.deep_path import run_deep
from app.inference.fast_path import InferenceRuntime, TechnicalResult
from app.media.audio_stream import BoundedLatestQueue, MediaFrame
from app.media.livekit_subscriber import (
    MediaSubscriberFactory,
    MediaSubscription,
    MediaSubscriptionError,
)
from app.models.interfaces import ModelInput
from app.schemas.analysis import (
    AnalysisSessionRequest,
    EventType,
    EvidenceEvent,
    EvidenceType,
    ScoreDirection,
)
from app.services.evidence_client import EvidenceClient, EvidenceDeliveryError

EVENT_NAMESPACE = UUID("018f0000-0000-7000-8000-0000000000f0")


class AnalysisSessionError(RuntimeError):
    def __init__(self, code: str, status_code: int = 409) -> None:
        self.code = code
        self.status_code = status_code
        super().__init__(code)


@dataclass
class SensitiveWindow:
    sequence: int
    start_ms: int
    end_ms: int
    samples: np.ndarray = field(repr=False)
    preprocessing_version: str
    quality: QualityEvidence
    captured_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    queued_at: float = field(default_factory=monotonic)

    def clear(self) -> None:
        if self.samples.size:
            self.samples.setflags(write=True)
            self.samples.fill(0.0)
        self.samples = np.empty(0, dtype=np.float32)


def _clear_prepared(prepared: PreparedWindow) -> None:
    samples = prepared.window.samples
    samples.setflags(write=True)
    samples.fill(0.0)
    samples.setflags(write=False)


class AnalysisSessionRuntime:
    def __init__(
        self,
        binding: AnalysisSessionRequest,
        settings: MlSettings,
        subscriber_factory: MediaSubscriberFactory,
        inference: InferenceRuntime,
        evidence_client: EvidenceClient,
        telemetry: Telemetry,
    ) -> None:
        self.binding = binding
        self.settings = settings
        self.subscriber_factory = subscriber_factory
        self.inference = inference
        self.evidence_client = evidence_client
        self.telemetry = telemetry
        self._windows = BoundedLatestQueue[SensitiveWindow](
            settings.window_queue_max,
            queue_name="windows",
            drop_reason="WINDOW_QUEUE_OVERLOAD_DROP_OLDEST",
            telemetry=telemetry,
        )
        self._evidence = BoundedLatestQueue[EvidenceEvent](
            settings.evidence_queue_max,
            queue_name="evidence",
            drop_reason="EVIDENCE_QUEUE_OVERLOAD_DROP_OLDEST",
            telemetry=telemetry,
        )
        self._tasks: set[asyncio.Task[None]] = set()
        self._subscription: MediaSubscription | None = None
        self._preprocessor: AudioPreprocessor | None = None
        self._event_sequence = 0
        self._event_ids: set[UUID] = set()
        self._closed = False
        self._stop_lock = asyncio.Lock()

    @property
    def closed(self) -> bool:
        return self._closed

    def start(self) -> None:
        if self._tasks:
            return
        for operation in (self._window_worker(), self._evidence_worker(), self._media_worker()):
            task = asyncio.create_task(operation)
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)

    async def _media_worker(self) -> None:
        for attempt in range(1, self.settings.reconnect_max_attempts + 1):
            if self._closed or datetime.now(UTC) >= self.binding.grant_expires_at:
                return
            self._preprocessor = AudioPreprocessor(
                load_audio_config(self.settings.audio_config_path)
            )
            self._subscription = self.subscriber_factory.create(self.binding)
            try:
                await self._subscription.connect()
                async for frame in self._subscription.frames():
                    if self._closed:
                        frame.clear()
                        return
                    self._accept_frame(frame)
            except asyncio.CancelledError:
                raise
            except MediaSubscriptionError as error:
                self.telemetry.increment("swar_ml_media_failures_total", error.code)
            except Exception as error:
                code = str(getattr(error, "code", "MEDIA_PIPELINE_FAILED"))
                self.telemetry.increment("swar_ml_media_failures_total", code)
            finally:
                self._preprocessor.clear()
                await self._subscription.close()
                self._preprocessor = None
                self._subscription = None
            if attempt < self.settings.reconnect_max_attempts and not self._closed:
                self.telemetry.increment("swar_ml_livekit_retries_total")
                await asyncio.sleep(self.settings.reconnect_backoff_ms * attempt / 1000)
        if not self._closed:
            self._enqueue_evidence(
                self._pipeline_error(window_sequence=0, error_code="LIVEKIT_RECONNECT_EXHAUSTED")
            )

    def _accept_frame(self, frame: MediaFrame) -> None:
        assert self._preprocessor is not None
        try:
            prepared = self._preprocessor.push_pcm(
                PcmEnvelope(
                    payload=frame.payload,
                    sample_rate_hz=frame.sample_rate_hz,
                    channels=frame.channels,
                    sample_format="PCM_S16LE",
                    samples_per_channel=frame.samples_per_channel,
                    source_sequence=frame.sequence,
                )
            )
            for item in prepared:
                samples = np.array(item.window.samples, dtype=np.float32, copy=True)
                _clear_prepared(item)
                self._windows.put_latest(
                    SensitiveWindow(
                        sequence=item.window.sequence,
                        start_ms=item.window.start_ms,
                        end_ms=item.window.end_ms,
                        samples=samples,
                        preprocessing_version=item.preprocessing_version,
                        quality=item.quality,
                    )
                )
        finally:
            frame.clear()

    async def _window_worker(self) -> None:
        while not self._closed:
            window = await self._windows.get()
            try:
                if (monotonic() - window.queued_at) * 1000 > self.settings.stale_window_after_ms:
                    self.telemetry.increment(
                        "swar_ml_dropped_windows_total", "STALE_BEFORE_INFERENCE"
                    )
                    continue
                await self._process_window(window)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                code = getattr(error, "code", "MODEL_PIPELINE_FAILED")
                self._enqueue_evidence(
                    self._pipeline_error(window_sequence=window.sequence, error_code=str(code))
                )
            finally:
                window.clear()

    async def _process_window(self, window: SensitiveWindow) -> None:
        quality = window.quality
        if quality.readiness is EvidenceReadiness.INSUFFICIENT_EVIDENCE:
            self._enqueue_evidence(self._insufficient_event(window))
            return
        fast_samples = np.array(window.samples, dtype=np.float32, copy=True)
        deep_samples = np.array(window.samples, dtype=np.float32, copy=True)
        window.clear()
        fast_input = self._model_input(window, fast_samples)
        try:
            results = await self.inference.fast(fast_input, self.binding.voiceprint_reference)
            for result in results:
                self.telemetry.observe_latency("FAST", result.processing_latency_ms)
                self._enqueue_evidence(self._technical_event(window, result, deep=False))
        finally:
            fast_samples.fill(0.0)
        deep_task = asyncio.create_task(self._run_deep(window, deep_samples))
        self._tasks.add(deep_task)
        deep_task.add_done_callback(self._tasks.discard)

    async def _run_deep(self, window: SensitiveWindow, samples: np.ndarray) -> None:
        try:
            result = await run_deep(self.inference, self._model_input(window, samples))
            if self._closed:
                self.telemetry.increment(
                    "swar_ml_dropped_windows_total", "DEEP_AFTER_SESSION_CLOSE"
                )
                return
            self.telemetry.observe_latency("DEEP", result.processing_latency_ms)
            self._enqueue_evidence(self._technical_event(window, result, deep=True))
        except asyncio.CancelledError:
            raise
        except Exception as error:
            if not self._closed:
                code = getattr(error, "code", "DEEP_MODEL_FAILED")
                self._enqueue_evidence(
                    self._pipeline_error(window_sequence=window.sequence, error_code=str(code))
                )
        finally:
            samples.fill(0.0)

    async def _evidence_worker(self) -> None:
        while not self._closed:
            event = await self._evidence.get()
            if event.event_id in self._event_ids:
                self.telemetry.increment("swar_ml_duplicate_delivery_total", "SESSION_DUPLICATE")
                continue
            self._event_ids.add(event.event_id)
            try:
                await self.evidence_client.send(event)
            except EvidenceDeliveryError:
                continue

    def _enqueue_evidence(self, event: EvidenceEvent) -> None:
        if self._closed:
            self.telemetry.increment(
                "swar_ml_dropped_windows_total", "EVIDENCE_AFTER_SESSION_CLOSE"
            )
            return
        self._evidence.put_latest(event)

    def _technical_event(
        self, window: SensitiveWindow, result: TechnicalResult, *, deep: bool
    ) -> EvidenceEvent:
        if result.capability == "IDENTITY":
            evidence_type = EvidenceType.IDENTITY
        elif deep:
            evidence_type = EvidenceType.SPOOF_DEEP
        else:
            evidence_type = EvidenceType.SPOOF_FAST
        event_type = EventType.DEEP if deep else EventType.FAST
        revision = 1 if deep else 0
        completed_at = datetime.now(UTC)
        event_id = self._event_id(window.sequence, evidence_type, revision)
        return EvidenceEvent(
            eventType=event_type,
            eventId=event_id,
            schemaVersion="2.0.0",
            evidenceMode=self.binding.evidence_mode,
            organizationId=self.binding.organization_id,
            callId=self.binding.call_id,
            analysisSessionId=self.binding.analysis_session_id,
            trackBindingId=self.binding.track_binding_id,
            participantIdentity=self.binding.participant_identity,
            trackSid=self.binding.track_sid,
            windowId=f"{self.binding.analysis_session_id}:{window.sequence}",
            correlationId=str(event_id),
            eventSequence=str(self._next_event_sequence()),
            windowSequence=str(window.sequence),
            revision=revision,
            evidenceType=evidence_type,
            windowStartMs=str(window.start_ms),
            windowEndMs=str(window.end_ms),
            observedAt=completed_at,
            capturedAt=window.captured_at,
            inferenceStartedAt=completed_at - timedelta(milliseconds=result.processing_latency_ms),
            inferenceCompletedAt=completed_at,
            processingLatencyMs=result.processing_latency_ms,
            speechDurationMs=window.quality.speech_duration_ms,
            qualityScore=window.quality.quality_score,
            reasonCodes=self._mode_labels(),
            modelName=result.model_name,
            modelVersion=result.model_version,
            checkpointHashSha256=result.checkpoint_sha256,
            scoreName=result.score_name,
            scoreDirection=self._score_direction(result.score_direction),
            rawScore=result.raw_score,
        )

    def _insufficient_event(self, window: SensitiveWindow) -> EvidenceEvent:
        event_id = self._event_id(window.sequence, EvidenceType.INSUFFICIENT_EVIDENCE, 0)
        return EvidenceEvent(
            eventType=EventType.INSUFFICIENT_EVIDENCE,
            eventId=event_id,
            schemaVersion="2.0.0",
            evidenceMode=self.binding.evidence_mode,
            organizationId=self.binding.organization_id,
            callId=self.binding.call_id,
            analysisSessionId=self.binding.analysis_session_id,
            trackBindingId=self.binding.track_binding_id,
            participantIdentity=self.binding.participant_identity,
            trackSid=self.binding.track_sid,
            windowId=f"{self.binding.analysis_session_id}:{window.sequence}",
            correlationId=str(event_id),
            eventSequence=str(self._next_event_sequence()),
            windowSequence=str(window.sequence),
            revision=0,
            evidenceType=EvidenceType.INSUFFICIENT_EVIDENCE,
            windowStartMs=str(window.start_ms),
            windowEndMs=str(window.end_ms),
            observedAt=datetime.now(UTC),
            capturedAt=window.captured_at,
            speechDurationMs=window.quality.speech_duration_ms,
            qualityScore=window.quality.quality_score,
            reasonCodes=window.quality.reason_codes + self._mode_labels(),
        )

    def _pipeline_error(self, *, window_sequence: int, error_code: str) -> EvidenceEvent:
        event_id = self._event_id(window_sequence, EvidenceType.PIPELINE_ERROR, 0)
        observed_at = datetime.now(UTC)
        return EvidenceEvent(
            eventType=EventType.PIPELINE_ERROR,
            eventId=event_id,
            schemaVersion="2.0.0",
            evidenceMode=self.binding.evidence_mode,
            organizationId=self.binding.organization_id,
            callId=self.binding.call_id,
            analysisSessionId=self.binding.analysis_session_id,
            trackBindingId=self.binding.track_binding_id,
            participantIdentity=self.binding.participant_identity,
            trackSid=self.binding.track_sid,
            windowId=f"{self.binding.analysis_session_id}:{window_sequence}",
            correlationId=str(event_id),
            eventSequence=str(self._next_event_sequence()),
            windowSequence=str(window_sequence),
            revision=0,
            evidenceType=EvidenceType.PIPELINE_ERROR,
            windowStartMs="0",
            windowEndMs="0",
            observedAt=observed_at,
            capturedAt=observed_at,
            reasonCodes=self._mode_labels(),
            errorCode=error_code[:80],
        )

    def _model_input(self, window: SensitiveWindow, samples: np.ndarray) -> ModelInput:
        return ModelInput(
            samples=samples,
            sample_rate_hz=16_000,
            window_id=f"{self.binding.analysis_session_id}:{window.sequence}",
            sequence=window.sequence,
            start_ms=window.start_ms,
            end_ms=window.end_ms,
            preprocessing_version=window.preprocessing_version,
        )

    def _event_id(self, sequence: int, evidence_type: EvidenceType, revision: int) -> UUID:
        identity = (
            f"{self.binding.analysis_session_id}|{sequence}|{evidence_type.value}|{revision}|"
            f"{self.binding.evidence_mode.value}"
        )
        return uuid5(EVENT_NAMESPACE, identity)

    def _next_event_sequence(self) -> int:
        self._event_sequence += 1
        return self._event_sequence

    @staticmethod
    def _score_direction(direction: str) -> ScoreDirection:
        if direction.startswith("HIGHER_IS_MORE_"):
            return ScoreDirection.HIGHER_MEANS_MORE
        if direction.startswith("LOWER_IS_MORE_"):
            return ScoreDirection.LOWER_MEANS_MORE
        raise AnalysisSessionError("MODEL_SCORE_DIRECTION_INVALID", 503)

    def _mode_labels(self) -> tuple[str, ...]:
        if self.binding.evidence_mode is EvidenceMode.SIMULATED:
            return ("SIMULATED_NON_SCIENTIFIC_EVIDENCE", "DEMO_ONLY_NO_PRODUCTION_ACTION")
        if self.binding.evidence_mode is EvidenceMode.SHADOW:
            return ("SHADOW_NO_ACTION",)
        return ()

    async def stop(self) -> None:
        async with self._stop_lock:
            if self._closed:
                return
            self._closed = True
            current = asyncio.current_task()
            tasks = [task for task in self._tasks if task is not current]
            for task in tasks:
                task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            if self._subscription is not None:
                await self._subscription.close()
            if self._preprocessor is not None:
                self._preprocessor.clear()
            self._windows.clear()
            self._evidence.clear()
            self._event_ids.clear()


class AnalysisSessionManager:
    def __init__(
        self,
        settings: MlSettings,
        subscriber_factory: MediaSubscriberFactory,
        inference: InferenceRuntime,
        evidence_client: EvidenceClient,
        telemetry: Telemetry,
    ) -> None:
        self.settings = settings
        self.subscriber_factory = subscriber_factory
        self.inference = inference
        self.evidence_client = evidence_client
        self.telemetry = telemetry
        self._sessions: dict[UUID, AnalysisSessionRuntime] = {}
        self._idempotency: OrderedDict[str, tuple[tuple[str, ...], UUID]] = OrderedDict()
        self._stop_idempotency: OrderedDict[str, tuple[UUID, str]] = OrderedDict()
        self._stopped_sessions: OrderedDict[UUID, None] = OrderedDict()
        self._lock = asyncio.Lock()
        self.readiness: ReadinessInspector | None = None

    @property
    def active_sessions(self) -> int:
        return sum(not session.closed for session in self._sessions.values())

    async def create(self, binding: AnalysisSessionRequest, idempotency_key: str) -> None:
        async with self._lock:
            if binding.evidence_mode is not self.settings.evidence_mode:
                raise AnalysisSessionError("EVIDENCE_MODE_NOT_AUTHORIZED")
            if datetime.now(UTC) >= binding.grant_expires_at:
                raise AnalysisSessionError("ANALYSIS_GRANT_EXPIRED", 401)
            if not self.inference.ready:
                raise AnalysisSessionError("MODEL_RUNTIME_NOT_READY", 503)
            if self.settings.app_env == "production":
                report = self.readiness.inspect() if self.readiness is not None else None
                if report is None or report.productionStatus != "READY":
                    raise AnalysisSessionError("PRODUCTION_ACTIVATION_BLOCKED", 503)
            fingerprint = binding.binding_fingerprint()
            replay = self._idempotency.get(idempotency_key)
            if replay is not None:
                if replay != (fingerprint, binding.analysis_session_id):
                    raise AnalysisSessionError("IDEMPOTENCY_KEY_CONFLICT")
                self._idempotency.move_to_end(idempotency_key)
                return
            if binding.analysis_session_id in self._stopped_sessions:
                raise AnalysisSessionError("ANALYSIS_SESSION_ALREADY_STOPPED")
            existing = self._sessions.get(binding.analysis_session_id)
            if existing is not None:
                if existing.binding.binding_fingerprint() != fingerprint:
                    raise AnalysisSessionError("ANALYSIS_BINDING_CONFLICT")
                self._idempotency[idempotency_key] = (fingerprint, binding.analysis_session_id)
                self._trim(self._idempotency)
                return
            if self.active_sessions >= self.settings.max_concurrent_sessions:
                self.telemetry.increment("swar_ml_session_rejections_total", "OVERLOAD")
                raise AnalysisSessionError("ANALYSIS_CAPACITY_EXCEEDED", 429)
            runtime = AnalysisSessionRuntime(
                binding,
                self.settings,
                self.subscriber_factory,
                self.inference,
                self.evidence_client,
                self.telemetry,
            )
            self._sessions[binding.analysis_session_id] = runtime
            self._idempotency[idempotency_key] = (fingerprint, binding.analysis_session_id)
            self._trim(self._idempotency)
            runtime.start()
            self.telemetry.gauge("swar_ml_active_sessions", "sessions", self.active_sessions)

    async def stop(self, session_id: UUID, idempotency_key: str, reason_code: str) -> None:
        async with self._lock:
            replay = self._stop_idempotency.get(idempotency_key)
            if replay is not None:
                if replay != (session_id, reason_code):
                    raise AnalysisSessionError("IDEMPOTENCY_KEY_CONFLICT")
                self._stop_idempotency.move_to_end(idempotency_key)
                return
            session = self._sessions.get(session_id)
            if session is None and session_id not in self._stopped_sessions:
                raise AnalysisSessionError("ANALYSIS_SESSION_NOT_FOUND", 404)
            if session is not None:
                await session.stop()
                self._sessions.pop(session_id, None)
            self._stopped_sessions[session_id] = None
            self._stopped_sessions.move_to_end(session_id)
            self._stop_idempotency[idempotency_key] = (session_id, reason_code)
            self._trim(self._stopped_sessions)
            self._trim(self._stop_idempotency)
            self.telemetry.gauge("swar_ml_active_sessions", "sessions", self.active_sessions)

    async def shutdown(self) -> None:
        sessions = tuple(self._sessions.values())
        await asyncio.gather(*(session.stop() for session in sessions), return_exceptions=True)
        self._sessions.clear()
        self._idempotency.clear()
        self._stop_idempotency.clear()
        self._stopped_sessions.clear()
        await self.inference.close()
        await self.evidence_client.close()
        self.telemetry.gauge("swar_ml_active_sessions", "sessions", 0)

    def _trim(self, entries: OrderedDict) -> None:
        while len(entries) > self.settings.auth_nonce_cache_max:
            entries.popitem(last=False)
