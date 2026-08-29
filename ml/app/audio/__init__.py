"""Deterministic, quality-aware audio preprocessing for SWAR."""

from app.audio.config import AudioConfig, load_audio_config
from app.audio.errors import AudioErrorCode, AudioPipelineError
from app.audio.pcm_normalizer import (
    CanonicalAudio,
    PcmEnvelope,
    PcmNormalizer,
    StreamingPcmNormalizer,
)
from app.audio.pipeline import AudioPreprocessor, PreparedWindow
from app.audio.quality import EvidenceReadiness, QualityEvaluator, QualityEvidence
from app.audio.rolling_window import AudioWindow, RollingWindowBuffer

__all__ = [
    "AudioConfig",
    "AudioErrorCode",
    "AudioPipelineError",
    "AudioPreprocessor",
    "AudioWindow",
    "CanonicalAudio",
    "EvidenceReadiness",
    "PcmEnvelope",
    "PcmNormalizer",
    "PreparedWindow",
    "QualityEvidence",
    "QualityEvaluator",
    "RollingWindowBuffer",
    "StreamingPcmNormalizer",
    "load_audio_config",
]
