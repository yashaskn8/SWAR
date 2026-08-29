from __future__ import annotations

import numpy as np
import pytest
import soundfile as sf

from app.audio.errors import AudioErrorCode, AudioPipelineError
from app.audio.pcm_normalizer import PcmEnvelope, PcmNormalizer
from tests.unit.audio.conftest import tone


def test_pcm_s16le_golden_normalization(audio_config) -> None:
    source = np.array([-32768, -16384, 0, 16384, 32767], dtype="<i2")
    result = PcmNormalizer(audio_config).normalize(
        PcmEnvelope(
            payload=source.tobytes(),
            sample_rate_hz=16000,
            channels=1,
            sample_format="PCM_S16LE",
            samples_per_channel=5,
        )
    )

    np.testing.assert_array_equal(
        result.samples,
        source.astype(np.float32) / 32768.0,
    )
    assert result.samples.dtype == np.float32
    assert not result.samples.flags.writeable


def test_stereo_is_averaged_without_peak_normalization(audio_config) -> None:
    stereo = np.array([[16384, -16384], [32767, 0]], dtype="<i2")
    result = PcmNormalizer(audio_config).normalize(
        PcmEnvelope(
            payload=stereo.tobytes(),
            sample_rate_hz=16000,
            channels=2,
            sample_format="PCM_S16LE",
        )
    )

    np.testing.assert_allclose(result.samples, [0.0, 32767 / 65536], atol=1e-7)
    assert result.source_channels == 2


def test_resampling_is_deterministic_and_has_expected_duration(audio_config) -> None:
    times = np.arange(4800, dtype=np.float64) / 48000.0
    samples = (0.2 * np.sin(2 * np.pi * 400 * times)).astype("<f4")
    envelope = PcmEnvelope(
        payload=samples.tobytes(),
        sample_rate_hz=48000,
        channels=1,
        sample_format="PCM_F32LE",
    )
    normalizer = PcmNormalizer(audio_config)

    first = normalizer.normalize(envelope)
    second = normalizer.normalize(envelope)

    assert first.sample_count == 1600
    np.testing.assert_array_equal(first.samples, second.samples)


@pytest.mark.parametrize(
    ("envelope", "code"),
    [
        (PcmEnvelope(b"", 16000, 1, "PCM_S16LE"), AudioErrorCode.EMPTY_AUDIO),
        (
            PcmEnvelope(b"\x00", 16000, 1, "PCM_S16LE"),
            AudioErrorCode.INVALID_PCM_LENGTH,
        ),
        (
            PcmEnvelope(b"\x00\x00", 16000, 1, "PCM_S16BE"),
            AudioErrorCode.UNSUPPORTED_ENDIAN,
        ),
        (
            PcmEnvelope(b"\x00\x00", 16000, 1, "PCM_U8"),
            AudioErrorCode.UNSUPPORTED_FORMAT,
        ),
        (
            PcmEnvelope(b"\x00\x00", 12345, 1, "PCM_S16LE"),
            AudioErrorCode.UNSUPPORTED_SAMPLE_RATE,
        ),
        (
            PcmEnvelope(b"\x00\x00" * 3, 16000, 3, "PCM_S16LE"),
            AudioErrorCode.UNSUPPORTED_CHANNELS,
        ),
        (
            PcmEnvelope(b"\x00\x00", 16000, 1, "PCM_S16LE", 2),
            AudioErrorCode.DECLARED_LENGTH_MISMATCH,
        ),
    ],
)
def test_malformed_runtime_envelopes_have_stable_errors(audio_config, envelope, code) -> None:
    with pytest.raises(AudioPipelineError) as raised:
        PcmNormalizer(audio_config).normalize(envelope)
    assert raised.value.code is code
    assert "payload" not in str(raised.value).lower()


def test_float_non_finite_and_out_of_range_handling(audio_config) -> None:
    normalizer = PcmNormalizer(audio_config)
    with pytest.raises(AudioPipelineError) as raised:
        normalizer.normalize(
            PcmEnvelope(
                np.array([np.nan], dtype="<f4").tobytes(),
                16000,
                1,
                "PCM_F32LE",
            )
        )
    assert raised.value.code is AudioErrorCode.NON_FINITE_SAMPLE

    clipped = normalizer.normalize(
        PcmEnvelope(
            np.array([-1.5, 1.5], dtype="<f4").tobytes(),
            16000,
            1,
            "PCM_F32LE",
        )
    )
    np.testing.assert_array_equal(clipped.samples, [-1.0, 1.0])
    assert clipped.input_clipped_samples == 2


def test_payload_bounds_and_malformed_lengths_are_bounded(audio_config) -> None:
    normalizer = PcmNormalizer(audio_config)
    oversized = b"\x00" * (audio_config.input.max_input_bytes + 1)
    with pytest.raises(AudioPipelineError) as raised:
        normalizer.normalize(PcmEnvelope(oversized, 48000, 2, "PCM_F32LE"))
    assert raised.value.code is AudioErrorCode.PAYLOAD_TOO_LARGE

    for byte_count in range(1, 64, 2):
        with pytest.raises(AudioPipelineError) as malformed:
            normalizer.normalize(PcmEnvelope(b"\x00" * byte_count, 16000, 1, "PCM_S16LE"))
        assert malformed.value.code is AudioErrorCode.INVALID_PCM_LENGTH


@pytest.mark.parametrize(("extension", "format_name"), [("wav", "WAV"), ("flac", "FLAC")])
def test_governed_file_decode_uses_same_normalization_core(
    audio_config, tmp_path, extension, format_name
) -> None:
    path = tmp_path / f"fixture.{extension}"
    source = tone(seconds=0.1)
    sf.write(path, source, 16000, format=format_name, subtype="PCM_16")

    decoded = PcmNormalizer(audio_config).decode_file(path)

    assert decoded.sample_count == 1600
    assert decoded.sample_rate_hz == 16000
    assert decoded.source_channels == 1


def test_corrupt_file_error_does_not_expose_path(audio_config, tmp_path) -> None:
    path = tmp_path / "private-caller-name.wav"
    path.write_bytes(b"not-audio")

    with pytest.raises(AudioPipelineError) as raised:
        PcmNormalizer(audio_config).decode_file(path)

    assert raised.value.code is AudioErrorCode.AUDIO_DECODE_FAILED
    assert path.name not in str(raised.value)


def test_big_endian_file_is_rejected_explicitly(audio_config, tmp_path) -> None:
    path = tmp_path / "big-endian.wav"
    sf.write(
        path,
        tone(seconds=0.1),
        16000,
        format="WAV",
        subtype="PCM_16",
        endian="BIG",
    )

    with pytest.raises(AudioPipelineError) as raised:
        PcmNormalizer(audio_config).decode_file(path)

    assert raised.value.code is AudioErrorCode.UNSUPPORTED_ENDIAN
