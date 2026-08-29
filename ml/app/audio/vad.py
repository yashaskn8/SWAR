"""Deterministic energy-based speech sufficiency evidence."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.audio.config import AudioConfig, load_audio_config
from app.audio.errors import AudioErrorCode, AudioPipelineError

DBFS_FLOOR = -120.0


@dataclass(frozen=True)
class VadResult:
    speech_duration_ms: int
    total_duration_ms: int
    speech_frame_count: int
    frame_count: int
    silence_ratio: float


def rms_dbfs(samples: np.ndarray) -> float:
    if samples.size == 0:
        return DBFS_FLOOR
    rms = float(np.sqrt(np.mean(np.square(samples, dtype=np.float64))))
    if rms <= 1e-12:
        return DBFS_FLOOR
    return max(DBFS_FLOOR, float(20.0 * np.log10(rms)))


class EnergyVad:
    """A versioned signal-sufficiency heuristic, not a speaker or spoof model."""

    def __init__(self, config: AudioConfig | None = None) -> None:
        self.config = config or load_audio_config()

    def analyze(self, samples: np.ndarray, sample_rate_hz: int) -> VadResult:
        if (
            sample_rate_hz != self.config.sample_rate_hz
            or samples.ndim != 1
            or samples.dtype != np.float32
            or samples.size == 0
            or not np.isfinite(samples).all()
        ):
            raise AudioPipelineError(AudioErrorCode.INVALID_CANONICAL_AUDIO)
        frame_samples = sample_rate_hz * self.config.vad.frame_ms // 1000
        speech_samples = 0
        speech_frames = 0
        frame_count = 0
        for offset in range(0, samples.size, frame_samples):
            frame = samples[offset : offset + frame_samples]
            frame_count += 1
            if rms_dbfs(frame) >= self.config.vad.speech_rms_dbfs_threshold:
                speech_frames += 1
                speech_samples += int(frame.size)
        total_duration_ms = round(samples.size * 1000 / sample_rate_hz)
        speech_duration_ms = round(speech_samples * 1000 / sample_rate_hz)
        silence_ratio = 1.0 - (speech_samples / samples.size)
        return VadResult(
            speech_duration_ms=speech_duration_ms,
            total_duration_ms=total_duration_ms,
            speech_frame_count=speech_frames,
            frame_count=frame_count,
            silence_ratio=round(silence_ratio, 6),
        )
