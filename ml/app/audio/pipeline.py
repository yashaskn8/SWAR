"""Shared preprocessing orchestration for runtime and offline adapters."""

from __future__ import annotations

from dataclasses import dataclass

from app.audio.config import AudioConfig, load_audio_config
from app.audio.pcm_normalizer import CanonicalAudio, PcmEnvelope, StreamingPcmNormalizer
from app.audio.quality import QualityEvaluator, QualityEvidence
from app.audio.rolling_window import AudioWindow, RollingWindowBuffer


@dataclass(frozen=True)
class PreparedWindow:
    preprocessing_version: str
    window: AudioWindow
    quality: QualityEvidence


class AudioPreprocessor:
    """Normalize, window, and assess audio without performing model inference."""

    def __init__(self, config: AudioConfig | None = None) -> None:
        self.config = config or load_audio_config()
        self.normalizer = StreamingPcmNormalizer(self.config)
        self.windows = RollingWindowBuffer(self.config)
        self.quality = QualityEvaluator(self.config)

    def push_pcm(
        self,
        envelope: PcmEnvelope,
        *,
        start_sample: int | None = None,
    ) -> tuple[PreparedWindow, ...]:
        try:
            audio = self.normalizer.push(envelope)
            if audio is None:
                return ()
            return self.push_canonical(audio, start_sample=start_sample)
        except Exception:
            self.clear()
            raise

    def push_canonical(
        self,
        audio: CanonicalAudio,
        *,
        start_sample: int | None = None,
    ) -> tuple[PreparedWindow, ...]:
        try:
            windows = self.windows.append(audio, start_sample=start_sample)
            return tuple(self._prepare(window) for window in windows)
        except Exception:
            self.clear()
            raise

    def finish(self) -> tuple[PreparedWindow, ...]:
        try:
            prepared: list[PreparedWindow] = []
            tail = self.normalizer.finish()
            if tail is not None:
                prepared.extend(self.push_canonical(tail))
            prepared.extend(self._prepare(window) for window in self.windows.finish())
            return tuple(prepared)
        except Exception:
            self.clear()
            raise

    def clear(self) -> None:
        self.normalizer.clear()
        self.windows.clear()

    def _prepare(
        self,
        window: AudioWindow,
    ) -> PreparedWindow:
        return PreparedWindow(
            preprocessing_version=self.config.preprocessing_version,
            window=window,
            quality=self.quality.evaluate(window),
        )
