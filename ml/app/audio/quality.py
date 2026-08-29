"""Quality evidence and stable insufficient-evidence reason generation."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

import numpy as np

from app.audio.config import AudioConfig, load_audio_config
from app.audio.errors import InsufficientReasonCode
from app.audio.rolling_window import AudioWindow
from app.audio.vad import EnergyVad, VadResult, rms_dbfs


class EvidenceReadiness(StrEnum):
    SUFFICIENT = "SUFFICIENT"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"


@dataclass(frozen=True)
class QualityEvidence:
    readiness: EvidenceReadiness
    reason_codes: tuple[str, ...]
    speech_duration_ms: int
    total_duration_ms: int
    rms_dbfs: float
    clipping_ratio: float
    silence_ratio: float
    noise_spectral_flatness: float
    quality_score: float


class QualityEvaluator:
    """Compute interpretable signal evidence without authenticity inference."""

    def __init__(self, config: AudioConfig | None = None) -> None:
        self.config = config or load_audio_config()
        self.vad = EnergyVad(self.config)

    def evaluate(
        self,
        window: AudioWindow,
        *,
        input_clipped_samples: int = 0,
    ) -> QualityEvidence:
        vad = self.vad.analyze(window.samples, window.sample_rate_hz)
        level = rms_dbfs(window.samples)
        clipped = int(
            np.count_nonzero(
                np.abs(window.samples) >= self.config.quality.clipping_amplitude_threshold
            )
        ) + max(0, input_clipped_samples)
        clipping_ratio = min(1.0, clipped / window.samples.size)
        noise_flatness = self._noise_spectral_flatness(window.samples)

        reasons: list[str] = []
        if window.is_partial:
            reasons.append(InsufficientReasonCode.PARTIAL_WINDOW)
        if window.discontinuity_before:
            reasons.append(InsufficientReasonCode.DISCONTINUITY)
        if window.packet_gap_before:
            reasons.append(InsufficientReasonCode.PACKET_GAP)
        if vad.speech_duration_ms < self.config.vad.minimum_speech_ms:
            reasons.append(InsufficientReasonCode.INSUFFICIENT_SPEECH)
        if vad.silence_ratio >= self.config.quality.excess_silence_ratio_threshold:
            reasons.append(InsufficientReasonCode.EXCESSIVE_SILENCE)
        if clipping_ratio >= self.config.quality.clipped_sample_ratio_threshold:
            reasons.append(InsufficientReasonCode.CLIPPING)
        if level <= self.config.quality.low_level_rms_dbfs_threshold:
            reasons.append(InsufficientReasonCode.LOW_LEVEL)
        if noise_flatness >= self.config.quality.noise_spectral_flatness_threshold:
            reasons.append(InsufficientReasonCode.NOISE_PROXY_HIGH)

        quality_score = self._quality_score(
            window=window,
            vad=vad,
            level=level,
            clipping_ratio=clipping_ratio,
            noise_flatness=noise_flatness,
        )
        return QualityEvidence(
            readiness=(
                EvidenceReadiness.INSUFFICIENT_EVIDENCE if reasons else EvidenceReadiness.SUFFICIENT
            ),
            reason_codes=tuple(str(reason) for reason in reasons),
            speech_duration_ms=vad.speech_duration_ms,
            total_duration_ms=vad.total_duration_ms,
            rms_dbfs=round(level, 6),
            clipping_ratio=round(clipping_ratio, 6),
            silence_ratio=vad.silence_ratio,
            noise_spectral_flatness=round(noise_flatness, 6),
            quality_score=quality_score,
        )

    def _noise_spectral_flatness(self, samples: np.ndarray) -> float:
        frame_samples = self.config.sample_rate_hz * self.config.quality.spectral_frame_ms // 1000
        window_function = np.hanning(frame_samples).astype(np.float32)
        values: list[float] = []
        for offset in range(0, samples.size - frame_samples + 1, frame_samples):
            frame = samples[offset : offset + frame_samples]
            if rms_dbfs(frame) < self.config.vad.speech_rms_dbfs_threshold:
                continue
            magnitude = np.abs(np.fft.rfft(frame * window_function)).astype(np.float64)
            magnitude = magnitude[1:] + 1e-12
            flatness = float(np.exp(np.mean(np.log(magnitude))) / np.mean(magnitude))
            values.append(flatness)
        return float(np.mean(values)) if values else 0.0

    def _quality_score(
        self,
        *,
        window: AudioWindow,
        vad: VadResult,
        level: float,
        clipping_ratio: float,
        noise_flatness: float,
    ) -> float:
        coverage = min(1.0, window.duration_ms / self.config.window.duration_ms)
        speech = 1.0 - vad.silence_ratio
        level_score = float(np.clip((level + 80.0) / 60.0, 0.0, 1.0))
        clipping_score = 1.0 - min(
            1.0,
            clipping_ratio / self.config.quality.clipped_sample_ratio_threshold,
        )
        noise_score = 1.0 - min(1.0, noise_flatness)
        continuity = 0.0 if window.discontinuity_before or window.packet_gap_before else 1.0
        score = np.mean([coverage, speech, level_score, clipping_score, noise_score, continuity])
        return round(float(np.clip(score, 0.0, 1.0)), 6)
