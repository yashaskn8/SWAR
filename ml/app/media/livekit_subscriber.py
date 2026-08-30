"""LiveKit subscriber that accepts only one backend-authorized participant/track tuple."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any, Protocol

from livekit import rtc

from app.core.config import MlSettings
from app.core.telemetry import Telemetry
from app.media.audio_stream import BoundedLatestQueue, MediaFrame
from app.schemas.analysis import AnalysisSessionRequest


class MediaSubscriptionError(RuntimeError):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class MediaSubscription(Protocol):
    async def connect(self) -> None: ...

    def frames(self) -> AsyncIterator[MediaFrame]: ...

    async def close(self) -> None: ...


class MediaSubscriberFactory(Protocol):
    def create(self, binding: AnalysisSessionRequest) -> MediaSubscription: ...


class LiveKitSubscriberFactory:
    def __init__(self, settings: MlSettings, telemetry: Telemetry) -> None:
        self.settings = settings
        self.telemetry = telemetry

    def create(self, binding: AnalysisSessionRequest) -> MediaSubscription:
        return LiveKitMediaSubscription(binding, self.settings, self.telemetry)


class LiveKitMediaSubscription:
    def __init__(
        self,
        binding: AnalysisSessionRequest,
        settings: MlSettings,
        telemetry: Telemetry,
    ) -> None:
        self.binding = binding
        self.settings = settings
        self.telemetry = telemetry
        self._room = rtc.Room()
        self._frames = BoundedLatestQueue[MediaFrame](
            settings.frame_queue_max,
            queue_name="frames",
            drop_reason="FRAME_QUEUE_OVERLOAD_DROP_OLDEST",
            telemetry=telemetry,
        )
        self._consume_tasks: set[asyncio.Task[None]] = set()
        self._disconnected = asyncio.Event()
        self._authorized_track = asyncio.Event()
        self._closed = False
        self._sequence = 0
        self._configure_events()

    def _configure_events(self) -> None:
        @self._room.on("track_published")
        def on_track_published(publication: Any, participant: Any) -> None:
            if self._matches(publication, participant):
                publication.set_subscribed(True)
            elif self._is_audio_publication(publication):
                publication.set_subscribed(False)
                self.telemetry.increment(
                    "swar_ml_binding_rejections_total", "UNAUTHORIZED_PUBLICATION"
                )

        @self._room.on("track_subscribed")
        def on_track_subscribed(track: Any, publication: Any, participant: Any) -> None:
            if (
                not self._matches(publication, participant)
                or track.kind != rtc.TrackKind.KIND_AUDIO
            ):
                publication.set_subscribed(False)
                self.telemetry.increment("swar_ml_binding_rejections_total", "SUBSTITUTED_MEDIA")
                return
            task = asyncio.create_task(self._consume_audio(track))
            self._authorized_track.set()
            self._consume_tasks.add(task)
            task.add_done_callback(self._consume_tasks.discard)

        @self._room.on("disconnected")
        def on_disconnected(*_: Any) -> None:
            self._disconnected.set()

    async def connect(self) -> None:
        if self._closed:
            raise MediaSubscriptionError("MEDIA_SESSION_CLOSED")
        try:
            await self._room.connect(
                self.settings.livekit_url,
                self.binding.grant_token.get_secret_value(),
                options=rtc.RoomOptions(auto_subscribe=False),
            )
        except Exception as error:
            raise MediaSubscriptionError("LIVEKIT_CONNECT_FAILED") from error
        if self._room.name != self.binding.room_name:
            await self.close()
            raise MediaSubscriptionError("LIVEKIT_ROOM_BINDING_MISMATCH")
        participant = self._room.remote_participants.get(self.binding.participant_identity)
        if participant is None:
            return
        for publication in participant.track_publications.values():
            if self._matches(publication, participant):
                publication.set_subscribed(True)
            elif self._is_audio_publication(publication):
                publication.set_subscribed(False)
        try:
            await asyncio.wait_for(
                self._authorized_track.wait(),
                timeout=self.settings.track_binding_timeout_seconds,
            )
        except TimeoutError as error:
            await self.close()
            raise MediaSubscriptionError("AUTHORIZED_TRACK_NOT_FOUND") from error

    async def frames(self) -> AsyncIterator[MediaFrame]:
        while not self._closed:
            get_frame = asyncio.create_task(self._frames.get())
            disconnected = asyncio.create_task(self._disconnected.wait())
            done, pending = await asyncio.wait(
                {get_frame, disconnected}, return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()
            if disconnected in done and disconnected.result():
                if not get_frame.done():
                    get_frame.cancel()
                raise MediaSubscriptionError("LIVEKIT_DISCONNECTED")
            yield get_frame.result()

    async def _consume_audio(self, track: Any) -> None:
        stream = rtc.AudioStream(track)
        try:
            async for event in stream:
                if self._closed:
                    break
                frame = event.frame
                self._sequence += 1
                sensitive = MediaFrame(
                    payload=bytearray(frame.data),
                    sample_rate_hz=int(frame.sample_rate),
                    channels=int(frame.num_channels),
                    samples_per_channel=int(frame.samples_per_channel),
                    sequence=self._sequence,
                )
                self._frames.put_latest(sensitive)
        finally:
            await stream.aclose()

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        for task in self._consume_tasks:
            task.cancel()
        if self._consume_tasks:
            await asyncio.gather(*self._consume_tasks, return_exceptions=True)
        self._frames.clear()
        try:
            await self._room.disconnect()
        except Exception:
            pass

    def _matches(self, publication: Any, participant: Any) -> bool:
        return (
            participant.identity == self.binding.participant_identity
            and publication.sid == self.binding.track_sid
            and self._is_audio_publication(publication)
        )

    @staticmethod
    def _is_audio_publication(publication: Any) -> bool:
        return publication.kind == rtc.TrackKind.KIND_AUDIO
