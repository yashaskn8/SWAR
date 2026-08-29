"""Versioned audio configuration loader with deterministic content hashing."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.audio.errors import AudioErrorCode, AudioPipelineError


@dataclass(frozen=True)
class InputConfig:
    allowed_sample_rates_hz: tuple[int, ...]
    max_channels: int
    max_frame_duration_ms: int
    max_input_bytes: int
    max_file_bytes: int
    allowed_file_containers: tuple[str, ...]
    allowed_file_subtypes: tuple[str, ...]


@dataclass(frozen=True)
class WindowConfig:
    duration_ms: int
    stride_ms: int
    max_buffer_ms: int
    final_partial_policy: str


@dataclass(frozen=True)
class VadConfig:
    frame_ms: int
    speech_rms_dbfs_threshold: float
    minimum_speech_ms: int


@dataclass(frozen=True)
class QualityConfig:
    clipping_amplitude_threshold: float
    clipped_sample_ratio_threshold: float
    low_level_rms_dbfs_threshold: float
    excess_silence_ratio_threshold: float
    spectral_frame_ms: int
    noise_spectral_flatness_threshold: float


@dataclass(frozen=True)
class AudioConfig:
    schema_version: str
    config_version: str
    content_sha256: str
    sample_rate_hz: int
    channels: int
    dtype: str
    pcm_scale: float
    input: InputConfig
    resampling_library: str
    resampling_quality: str
    window: WindowConfig
    vad: VadConfig
    quality: QualityConfig

    @property
    def preprocessing_version(self) -> str:
        return f"{self.config_version}+sha256:{self.content_sha256}"

    @property
    def window_samples(self) -> int:
        return self.sample_rate_hz * self.window.duration_ms // 1000

    @property
    def stride_samples(self) -> int:
        return self.sample_rate_hz * self.window.stride_ms // 1000

    @property
    def max_buffer_samples(self) -> int:
        return self.sample_rate_hz * self.window.max_buffer_ms // 1000


def _expect_mapping(value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise AudioPipelineError(AudioErrorCode.INVALID_AUDIO_CONFIG)
    return value


def _load_config_bytes(path: Path) -> tuple[bytes, dict[str, Any]]:
    try:
        raw = path.read_bytes()
        parsed = json.loads(raw)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise AudioPipelineError(AudioErrorCode.INVALID_AUDIO_CONFIG) from error
    return raw, _expect_mapping(parsed)


def load_audio_config(path: Path | None = None) -> AudioConfig:
    """Load the JSON-compatible YAML contract and fail closed on invalid bounds."""

    config_path = path or Path(__file__).parents[2] / "config" / "audio.yaml"
    raw, document = _load_config_bytes(config_path)
    try:
        canonical = _expect_mapping(document["canonical"])
        input_doc = _expect_mapping(document["input"])
        resampling = _expect_mapping(document["resampling"])
        window_doc = _expect_mapping(document["window"])
        vad_doc = _expect_mapping(document["vad"])
        quality_doc = _expect_mapping(document["quality"])
        config = AudioConfig(
            schema_version=str(document["schema_version"]),
            config_version=str(document["config_version"]),
            content_sha256=hashlib.sha256(raw).hexdigest(),
            sample_rate_hz=int(canonical["sample_rate_hz"]),
            channels=int(canonical["channels"]),
            dtype=str(canonical["dtype"]),
            pcm_scale=float(canonical["pcm_scale"]),
            input=InputConfig(
                allowed_sample_rates_hz=tuple(
                    int(value) for value in input_doc["allowed_sample_rates_hz"]
                ),
                max_channels=int(input_doc["max_channels"]),
                max_frame_duration_ms=int(input_doc["max_frame_duration_ms"]),
                max_input_bytes=int(input_doc["max_input_bytes"]),
                max_file_bytes=int(input_doc["max_file_bytes"]),
                allowed_file_containers=tuple(input_doc["allowed_file_containers"]),
                allowed_file_subtypes=tuple(input_doc["allowed_file_subtypes"]),
            ),
            resampling_library=str(resampling["library"]),
            resampling_quality=str(resampling["quality"]),
            window=WindowConfig(
                duration_ms=int(window_doc["duration_ms"]),
                stride_ms=int(window_doc["stride_ms"]),
                max_buffer_ms=int(window_doc["max_buffer_ms"]),
                final_partial_policy=str(window_doc["final_partial_policy"]),
            ),
            vad=VadConfig(
                frame_ms=int(vad_doc["frame_ms"]),
                speech_rms_dbfs_threshold=float(vad_doc["speech_rms_dbfs_threshold"]),
                minimum_speech_ms=int(vad_doc["minimum_speech_ms"]),
            ),
            quality=QualityConfig(
                clipping_amplitude_threshold=float(quality_doc["clipping_amplitude_threshold"]),
                clipped_sample_ratio_threshold=float(quality_doc["clipped_sample_ratio_threshold"]),
                low_level_rms_dbfs_threshold=float(quality_doc["low_level_rms_dbfs_threshold"]),
                excess_silence_ratio_threshold=float(quality_doc["excess_silence_ratio_threshold"]),
                spectral_frame_ms=int(quality_doc["spectral_frame_ms"]),
                noise_spectral_flatness_threshold=float(
                    quality_doc["noise_spectral_flatness_threshold"]
                ),
            ),
        )
    except (KeyError, TypeError, ValueError) as error:
        raise AudioPipelineError(AudioErrorCode.INVALID_AUDIO_CONFIG) from error
    _validate_config(config)
    return config


def _validate_config(config: AudioConfig) -> None:
    if (
        config.schema_version != "1.0.0"
        or config.sample_rate_hz != 16000
        or config.channels != 1
        or config.dtype != "float32"
        or config.pcm_scale != 32768.0
        or not config.input.allowed_sample_rates_hz
        or any(rate <= 0 for rate in config.input.allowed_sample_rates_hz)
        or config.input.max_channels not in {1, 2}
        or config.input.max_frame_duration_ms <= 0
        or config.input.max_input_bytes <= 0
        or config.input.max_file_bytes <= 0
        or config.resampling_library != "python-soxr"
        or config.window.duration_ms <= 0
        or config.window.stride_ms <= 0
        or config.window.stride_ms > config.window.duration_ms
        or config.window.max_buffer_ms < config.window.duration_ms
        or config.window.final_partial_policy != "emit_insufficient"
        or config.window_samples <= 0
        or config.stride_samples <= 0
        or config.vad.frame_ms <= 0
        or config.vad.minimum_speech_ms <= 0
        or config.vad.minimum_speech_ms > config.window.duration_ms
        or not 0.0 < config.quality.clipping_amplitude_threshold <= 1.0
        or not 0.0 < config.quality.clipped_sample_ratio_threshold <= 1.0
        or not 0.0 <= config.quality.excess_silence_ratio_threshold <= 1.0
        or config.quality.spectral_frame_ms <= 0
        or not 0.0 <= config.quality.noise_spectral_flatness_threshold <= 1.0
    ):
        raise AudioPipelineError(AudioErrorCode.INVALID_AUDIO_CONFIG)
