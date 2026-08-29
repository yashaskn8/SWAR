from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app.audio.errors import AudioErrorCode, AudioPipelineError, InsufficientReasonCode
from app.audio.pcm_normalizer import PcmEnvelope, PcmNormalizer
from app.audio.pipeline import AudioPreprocessor
from tests.unit.audio.conftest import canonical, tone
from training.preprocessing import TrainingPreprocessor


def test_runtime_and_training_use_identical_window_transform(audio_config) -> None:
    times = np.arange(48000 * 5, dtype=np.float64) / 48000.0
    source = np.asarray(0.2 * np.sin(2 * np.pi * 220 * times), dtype=np.float32)
    quantized = np.rint(source * 32768.0).astype("<i2")
    runtime = AudioPreprocessor(audio_config)
    runtime_windows = []
    for sequence in range(1, 6):
        pcm = quantized[(sequence - 1) * 48000 : sequence * 48000]
        runtime_windows.extend(
            runtime.push_pcm(
                PcmEnvelope(
                    pcm.tobytes(),
                    48000,
                    1,
                    "PCM_S16LE",
                    samples_per_channel=48000,
                    source_sequence=sequence,
                )
            )
        )
    runtime_windows.extend(runtime.finish())

    quantized_source = quantized.astype(np.float32) / 32768.0
    training_audio = PcmNormalizer(audio_config).normalize_array(
        quantized_source,
        sample_rate_hz=48000,
    )
    training = TrainingPreprocessor(audio_config).preprocess_canonical(training_audio)

    assert len(runtime_windows) == len(training.windows) == 2
    assert training.preprocessing_version == audio_config.preprocessing_version
    for runtime_window, training_window in zip(runtime_windows, training.windows, strict=True):
        assert runtime_window.preprocessing_version == training_window.preprocessing_version
        assert runtime_window.window.start_ms == training_window.window.start_ms
        assert runtime_window.window.end_ms == training_window.window.end_ms
        np.testing.assert_array_equal(
            runtime_window.window.samples,
            training_window.window.samples,
        )
        assert runtime_window.quality == training_window.quality


def test_runtime_media_format_change_fails_and_closes_session(audio_config) -> None:
    pipeline = AudioPreprocessor(audio_config)
    first = np.zeros(16000, dtype="<i2")
    pipeline.push_pcm(PcmEnvelope(first.tobytes(), 16000, 1, "PCM_S16LE"))

    changed = np.zeros(48000, dtype="<i2")
    with pytest.raises(AudioPipelineError) as raised:
        pipeline.push_pcm(PcmEnvelope(changed.tobytes(), 48000, 1, "PCM_S16LE"))

    assert raised.value.code is AudioErrorCode.MEDIA_FORMAT_CHANGED


def test_resampled_sequence_gap_preserves_timeline_and_never_crosses_gap(audio_config) -> None:
    pipeline = AudioPreprocessor(audio_config)
    times = np.arange(48000, dtype=np.float64) / 48000.0
    pcm = np.rint(0.2 * np.sin(2 * np.pi * 220 * times) * 32768.0).astype("<i2")
    prepared = []

    for sequence in (1, 2, 4, 5, 6, 7):
        prepared.extend(
            pipeline.push_pcm(
                PcmEnvelope(
                    pcm.tobytes(),
                    48000,
                    1,
                    "PCM_S16LE",
                    samples_per_channel=48000,
                    source_sequence=sequence,
                )
            )
        )
    prepared.extend(pipeline.finish())

    assert len(prepared) == 1
    assert prepared[0].window.start_ms == 3000
    assert prepared[0].window.end_ms == 7000
    assert prepared[0].window.discontinuity_before
    assert prepared[0].window.packet_gap_before
    assert prepared[0].window.gap_samples == 16000


def test_training_file_adapter_uses_runtime_core(audio_config, tmp_path) -> None:
    path = tmp_path / "governed.wav"
    sf.write(path, tone(seconds=4.0), 16000, subtype="PCM_16")

    batch = TrainingPreprocessor(audio_config).preprocess_file(path)

    assert len(batch.windows) == 1
    assert batch.windows[0].window.start_ms == 0
    assert batch.windows[0].window.end_ms == 4000


def test_runtime_processing_does_not_write_audio_to_disk(audio_config, monkeypatch) -> None:
    pipeline = AudioPreprocessor(audio_config)

    def reject_write(*_args, **_kwargs):
        raise AssertionError("runtime audio attempted a disk write")

    monkeypatch.setattr(Path, "write_bytes", reject_write)
    monkeypatch.setattr(Path, "write_text", reject_write)
    samples = np.rint(tone(seconds=1.0) * 32768.0).astype("<i2")
    result = pipeline.push_pcm(
        PcmEnvelope(samples.tobytes(), 16000, 1, "PCM_S16LE", source_sequence=1)
    )

    assert result == ()
    partial = pipeline.finish()
    assert len(partial) == 1
    assert InsufficientReasonCode.PARTIAL_WINDOW in partial[0].quality.reason_codes


def test_pipeline_clear_is_idempotent_cleanup(audio_config) -> None:
    pipeline = AudioPreprocessor(audio_config)
    pipeline.push_canonical(canonical(tone(seconds=1.0)))
    pipeline.clear()
    pipeline.clear()
    assert pipeline.windows.buffered_samples == 0


def test_runtime_error_releases_existing_transient_audio(audio_config) -> None:
    pipeline = AudioPreprocessor(audio_config)
    valid = np.zeros(16000, dtype="<i2")
    pipeline.push_pcm(PcmEnvelope(valid.tobytes(), 16000, 1, "PCM_S16LE"))
    assert pipeline.windows.buffered_samples == 16000

    with pytest.raises(AudioPipelineError) as raised:
        pipeline.push_pcm(PcmEnvelope(b"", 16000, 1, "PCM_S16LE"))

    assert raised.value.code is AudioErrorCode.EMPTY_AUDIO
    assert pipeline.windows.buffered_samples == 0
    assert pipeline.windows.closed
