"""Deterministic telephony-like evaluation recipes with explicit lineage."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import soxr

from app.audio.errors import AudioErrorCode, AudioPipelineError

RECIPE_VERSION = "phase-l-telephony-v1"
CANONICAL_RATE_HZ = 16000


@dataclass(frozen=True)
class DegradationStep:
    name: str
    version: str
    parameters: tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class DegradationResult:
    samples: np.ndarray
    sample_rate_hz: int
    recipe_name: str
    recipe_version: str
    seed: int
    lineage: tuple[DegradationStep, ...]


def apply_telephony_recipe(
    samples: np.ndarray,
    recipe_name: str,
    *,
    seed: int,
) -> DegradationResult:
    """Apply an evaluation-only recipe; no recipe represents every carrier."""

    source = _validate_samples(samples)
    if recipe_name == "narrowband_mulaw_proxy":
        narrow = _resample(source, CANONICAL_RATE_HZ, 8000)
        coded = _mulaw_roundtrip(narrow)
        result = _resample(coded, 8000, CANONICAL_RATE_HZ)
        lineage = (
            _step("resample", source_rate="16000", target_rate="8000", quality="HQ"),
            _step("mulaw_compand_quantize", levels="256", mu="255"),
            _step("resample", source_rate="8000", target_rate="16000", quality="HQ"),
        )
    elif recipe_name == "narrowband_noise_proxy":
        narrow = _resample(source, CANONICAL_RATE_HZ, 8000)
        noisy = _add_noise(narrow, snr_db=12.0, seed=seed)
        result = _resample(noisy, 8000, CANONICAL_RATE_HZ)
        lineage = (
            _step("resample", source_rate="16000", target_rate="8000", quality="HQ"),
            _step("additive_white_noise", requested_snr_db="12.0", seed=str(seed)),
            _step("resample", source_rate="8000", target_rate="16000", quality="HQ"),
        )
    elif recipe_name == "clipped_channel_proxy":
        result = np.clip(source * 2.0, -0.70, 0.70).astype(np.float32)
        lineage = (_step("gain_and_hard_clip", gain="2.0", limit="0.70"),)
    else:
        raise ValueError("Unknown telephony degradation recipe.")
    output = np.ascontiguousarray(result, dtype=np.float32)
    output.setflags(write=False)
    return DegradationResult(
        samples=output,
        sample_rate_hz=CANONICAL_RATE_HZ,
        recipe_name=recipe_name,
        recipe_version=RECIPE_VERSION,
        seed=seed,
        lineage=lineage,
    )


def _validate_samples(samples: np.ndarray) -> np.ndarray:
    source = np.asarray(samples, dtype=np.float32)
    if (
        source.ndim != 1
        or source.size == 0
        or not np.isfinite(source).all()
        or np.any(np.abs(source) > 1.0)
    ):
        raise AudioPipelineError(AudioErrorCode.INVALID_CANONICAL_AUDIO)
    return np.array(source, dtype=np.float32, copy=True)


def _resample(samples: np.ndarray, source_rate: int, target_rate: int) -> np.ndarray:
    return np.asarray(
        soxr.resample(samples, source_rate, target_rate, quality="HQ"),
        dtype=np.float32,
    )


def _mulaw_roundtrip(samples: np.ndarray) -> np.ndarray:
    mu = 255.0
    compressed = np.sign(samples) * np.log1p(mu * np.abs(samples)) / np.log1p(mu)
    quantized = np.rint((compressed + 1.0) * 127.5) / 127.5 - 1.0
    expanded = np.sign(quantized) * np.expm1(np.abs(quantized) * np.log1p(mu)) / mu
    return np.asarray(expanded, dtype=np.float32)


def _add_noise(samples: np.ndarray, *, snr_db: float, seed: int) -> np.ndarray:
    power = float(np.mean(np.square(samples, dtype=np.float64)))
    if power <= 1e-12:
        raise AudioPipelineError(AudioErrorCode.INVALID_CANONICAL_AUDIO)
    noise_power = power / (10.0 ** (snr_db / 10.0))
    generator = np.random.default_rng(seed)
    noise = generator.normal(0.0, np.sqrt(noise_power), samples.size).astype(np.float32)
    return np.clip(samples + noise, -1.0, 1.0).astype(np.float32)


def _step(name: str, **parameters: str) -> DegradationStep:
    return DegradationStep(
        name=name,
        version=RECIPE_VERSION,
        parameters=tuple(sorted(parameters.items())),
    )
