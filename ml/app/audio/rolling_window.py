"""Bounded, sequence-numbered rolling windows over canonical audio."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.audio.config import AudioConfig, load_audio_config
from app.audio.errors import AudioErrorCode, AudioPipelineError
from app.audio.pcm_normalizer import CanonicalAudio


@dataclass(frozen=True)
class AudioWindow:
    sequence: int
    samples: np.ndarray
    sample_rate_hz: int
    start_sample: int
    end_sample: int
    start_ms: int
    end_ms: int
    is_partial: bool
    discontinuity_before: bool
    packet_gap_before: bool
    gap_samples: int

    @property
    def duration_ms(self) -> int:
        return self.end_ms - self.start_ms


class RollingWindowBuffer:
    """Keep only the samples required for the next bounded overlapping window."""

    def __init__(self, config: AudioConfig | None = None) -> None:
        self.config = config or load_audio_config()
        self._buffer = np.empty(0, dtype=np.float32)
        self._buffer_start_sample: int | None = None
        self._next_window_start: int | None = None
        self._timeline_end: int | None = None
        self._last_emitted_end: int | None = None
        self._last_source_sequence: int | None = None
        self._next_sequence = 1
        self._discontinuity_pending = False
        self._packet_gap_pending = False
        self._gap_samples_pending = 0
        self._closed = False

    @property
    def buffered_samples(self) -> int:
        return int(self._buffer.size)

    @property
    def closed(self) -> bool:
        return self._closed

    def append(
        self,
        audio: CanonicalAudio,
        *,
        start_sample: int | None = None,
    ) -> tuple[AudioWindow, ...]:
        if self._closed:
            raise AudioPipelineError(AudioErrorCode.PIPELINE_CLOSED)
        try:
            self._validate_audio(audio)
        except AudioPipelineError:
            self.clear()
            raise
        if audio.sample_count > self.config.max_buffer_samples:
            self.clear()
            raise AudioPipelineError(AudioErrorCode.BUFFER_LIMIT_EXCEEDED)

        frame_start = start_sample
        if frame_start is None:
            frame_start = audio.timeline_start_sample
        if frame_start is None:
            frame_start = self._timeline_end if self._timeline_end is not None else 0
        if frame_start < 0:
            self.clear()
            raise AudioPipelineError(AudioErrorCode.INVALID_CANONICAL_AUDIO)

        expected_start = self._timeline_end
        position_discontinuity = expected_start is not None and frame_start != expected_start
        sequence_discontinuity = (
            self._last_source_sequence is not None
            and audio.source_sequence is not None
            and audio.source_sequence != self._last_source_sequence + 1
        )
        explicit_discontinuity = audio.discontinuity_before or audio.packet_gap_before
        if position_discontinuity or sequence_discontinuity or explicit_discontinuity:
            position_gap = max(0, frame_start - expected_start) if expected_start is not None else 0
            gap_samples = audio.gap_samples if audio.gap_samples > 0 else position_gap
            self._begin_segment(
                frame_start,
                discontinuity=True,
                packet_gap=(sequence_discontinuity or audio.packet_gap_before or gap_samples > 0),
                gap_samples=gap_samples,
            )
        elif self._buffer_start_sample is None:
            self._begin_segment(frame_start, discontinuity=False, packet_gap=False, gap_samples=0)

        writable = np.array(audio.samples, dtype=np.float32, copy=True)
        self._buffer = np.concatenate((self._buffer, writable))
        self._timeline_end = frame_start + audio.sample_count
        self._last_source_sequence = audio.source_sequence

        windows: list[AudioWindow] = []
        assert self._next_window_start is not None
        while self._next_window_start + self.config.window_samples <= self._timeline_end:
            windows.append(
                self._make_window(
                    self._next_window_start,
                    self._next_window_start + self.config.window_samples,
                    is_partial=False,
                )
            )
            self._last_emitted_end = windows[-1].end_sample
            self._next_window_start += self.config.stride_samples
        self._discard_consumed_prefix()
        if self._buffer.size > self.config.max_buffer_samples:
            self._zero_buffer()
            self._closed = True
            raise AudioPipelineError(AudioErrorCode.BUFFER_LIMIT_EXCEEDED)
        return tuple(windows)

    def finish(self) -> tuple[AudioWindow, ...]:
        """Emit at most one unpadded final window, then zero and close the buffer."""

        if self._closed:
            return ()
        windows: tuple[AudioWindow, ...] = ()
        if (
            self._next_window_start is not None
            and self._timeline_end is not None
            and self._timeline_end > self._next_window_start
            and (self._last_emitted_end is None or self._timeline_end > self._last_emitted_end)
        ):
            windows = (
                self._make_window(
                    self._next_window_start,
                    self._timeline_end,
                    is_partial=True,
                ),
            )
        self._zero_buffer()
        self._closed = True
        return windows

    def clear(self) -> None:
        """Zero transient samples and permanently close this session buffer."""

        self._zero_buffer()
        self._closed = True

    def _begin_segment(
        self,
        start_sample: int,
        *,
        discontinuity: bool,
        packet_gap: bool,
        gap_samples: int,
    ) -> None:
        self._zero_buffer()
        self._buffer_start_sample = start_sample
        self._next_window_start = start_sample
        self._timeline_end = start_sample
        self._last_emitted_end = None
        self._discontinuity_pending = discontinuity
        self._packet_gap_pending = packet_gap
        self._gap_samples_pending = gap_samples

    def _make_window(self, start_sample: int, end_sample: int, *, is_partial: bool) -> AudioWindow:
        assert self._buffer_start_sample is not None
        offset_start = start_sample - self._buffer_start_sample
        offset_end = end_sample - self._buffer_start_sample
        if offset_start < 0 or offset_end > self._buffer.size or offset_start >= offset_end:
            raise AudioPipelineError(AudioErrorCode.INVALID_CANONICAL_AUDIO)
        samples = np.array(self._buffer[offset_start:offset_end], dtype=np.float32, copy=True)
        samples.setflags(write=False)
        window = AudioWindow(
            sequence=self._next_sequence,
            samples=samples,
            sample_rate_hz=self.config.sample_rate_hz,
            start_sample=start_sample,
            end_sample=end_sample,
            start_ms=start_sample * 1000 // self.config.sample_rate_hz,
            end_ms=end_sample * 1000 // self.config.sample_rate_hz,
            is_partial=is_partial,
            discontinuity_before=self._discontinuity_pending,
            packet_gap_before=self._packet_gap_pending,
            gap_samples=self._gap_samples_pending,
        )
        self._next_sequence += 1
        self._discontinuity_pending = False
        self._packet_gap_pending = False
        self._gap_samples_pending = 0
        return window

    def _discard_consumed_prefix(self) -> None:
        if self._buffer_start_sample is None or self._next_window_start is None:
            return
        discard = self._next_window_start - self._buffer_start_sample
        if discard <= 0:
            return
        old_buffer = self._buffer
        self._buffer = np.array(old_buffer[discard:], dtype=np.float32, copy=True)
        old_buffer.fill(0.0)
        self._buffer_start_sample = self._next_window_start

    def _zero_buffer(self) -> None:
        if self._buffer.size:
            self._buffer.fill(0.0)
        self._buffer = np.empty(0, dtype=np.float32)
        self._buffer_start_sample = None
        self._next_window_start = None
        self._timeline_end = None
        self._last_emitted_end = None

    def _validate_audio(self, audio: CanonicalAudio) -> None:
        if (
            audio.sample_rate_hz != self.config.sample_rate_hz
            or audio.samples.ndim != 1
            or audio.samples.dtype != np.float32
            or audio.samples.size == 0
            or not np.isfinite(audio.samples).all()
            or np.any(np.abs(audio.samples) > 1.0)
        ):
            raise AudioPipelineError(AudioErrorCode.INVALID_CANONICAL_AUDIO)
