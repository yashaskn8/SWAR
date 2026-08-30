"""Sensitive frame wrappers and bounded newest-data queue policy."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Generic, Protocol, TypeVar

from app.core.telemetry import Telemetry


class Clearable(Protocol):
    def clear(self) -> None: ...


@dataclass
class MediaFrame:
    payload: bytearray = field(repr=False)
    sample_rate_hz: int
    channels: int
    samples_per_channel: int
    sequence: int

    def clear(self) -> None:
        self.payload[:] = b"\x00" * len(self.payload)
        self.payload.clear()


T = TypeVar("T")


class BoundedLatestQueue(Generic[T]):
    """Drop and clear the oldest item so stale live data never grows unbounded."""

    def __init__(
        self,
        maximum: int,
        *,
        queue_name: str,
        drop_reason: str,
        telemetry: Telemetry,
    ) -> None:
        self._queue: asyncio.Queue[T] = asyncio.Queue(maxsize=maximum)
        self.queue_name = queue_name
        self.drop_reason = drop_reason
        self.telemetry = telemetry

    @property
    def depth(self) -> int:
        return self._queue.qsize()

    async def get(self) -> T:
        item = await self._queue.get()
        self._record_depth()
        return item

    def put_latest(self, item: T) -> None:
        if self._queue.full():
            dropped = self._queue.get_nowait()
            clear = getattr(dropped, "clear", None)
            if callable(clear):
                clear()
            self.telemetry.increment("swar_ml_dropped_windows_total", self.drop_reason)
        self._queue.put_nowait(item)
        self._record_depth()

    def clear(self) -> None:
        while not self._queue.empty():
            item = self._queue.get_nowait()
            clear = getattr(item, "clear", None)
            if callable(clear):
                clear()
        self._record_depth()

    def _record_depth(self) -> None:
        self.telemetry.gauge("swar_ml_queue_depth", self.queue_name, self.depth)
