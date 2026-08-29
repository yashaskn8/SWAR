from __future__ import annotations

import numpy as np
import pytest

from app.audio.config import AudioConfig, load_audio_config
from app.audio.pcm_normalizer import CanonicalAudio
from app.audio.rolling_window import AudioWindow


@pytest.fixture(scope="session")
def audio_config() -> AudioConfig:
    return load_audio_config()


def tone(*, seconds: float, amplitude: float = 0.2, frequency_hz: float = 220.0) -> np.ndarray:
    sample_count = round(16000 * seconds)
    times = np.arange(sample_count, dtype=np.float64) / 16000.0
    return np.asarray(amplitude * np.sin(2.0 * np.pi * frequency_hz * times), dtype=np.float32)


def canonical(samples: np.ndarray, *, sequence: int | None = None) -> CanonicalAudio:
    values = np.ascontiguousarray(samples, dtype=np.float32)
    values.setflags(write=False)
    return CanonicalAudio(
        samples=values,
        sample_rate_hz=16000,
        source_sample_rate_hz=16000,
        source_channels=1,
        source_sequence=sequence,
    )


def window(
    samples: np.ndarray,
    *,
    partial: bool = False,
    discontinuity: bool = False,
    packet_gap: bool = False,
) -> AudioWindow:
    values = np.ascontiguousarray(samples, dtype=np.float32)
    values.setflags(write=False)
    duration_ms = round(values.size * 1000 / 16000)
    return AudioWindow(
        sequence=1,
        samples=values,
        sample_rate_hz=16000,
        start_sample=0,
        end_sample=values.size,
        start_ms=0,
        end_ms=duration_ms,
        is_partial=partial,
        discontinuity_before=discontinuity,
        packet_gap_before=packet_gap,
        gap_samples=160 if packet_gap else 0,
    )
