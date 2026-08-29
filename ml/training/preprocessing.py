"""Governed-file adapter over the same preprocessing core used at runtime."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.audio.config import AudioConfig, load_audio_config
from app.audio.pcm_normalizer import CanonicalAudio, PcmNormalizer
from app.audio.pipeline import AudioPreprocessor, PreparedWindow


@dataclass(frozen=True)
class PreprocessingBatch:
    preprocessing_version: str
    windows: tuple[PreparedWindow, ...]


class TrainingPreprocessor:
    """Decode governed files, then delegate every transform to the runtime core."""

    def __init__(self, config: AudioConfig | None = None) -> None:
        self.config = config or load_audio_config()
        self.normalizer = PcmNormalizer(self.config)

    def preprocess_file(self, path: Path) -> PreprocessingBatch:
        return self.preprocess_canonical(self.normalizer.decode_file(path))

    def preprocess_canonical(self, audio: CanonicalAudio) -> PreprocessingBatch:
        pipeline = AudioPreprocessor(self.config)
        windows = pipeline.push_canonical(audio) + pipeline.finish()
        return PreprocessingBatch(
            preprocessing_version=self.config.preprocessing_version,
            windows=windows,
        )
