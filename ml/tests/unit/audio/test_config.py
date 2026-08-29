from __future__ import annotations

import json

import pytest

from app.audio.config import load_audio_config
from app.audio.errors import AudioErrorCode, AudioPipelineError


def test_config_is_versioned_hashed_and_has_exact_timing() -> None:
    first = load_audio_config()
    second = load_audio_config()

    assert first.preprocessing_version == second.preprocessing_version
    assert len(first.content_sha256) == 64
    assert first.sample_rate_hz == 16000
    assert first.window_samples == 64000
    assert first.stride_samples == 16000
    assert first.max_buffer_samples == 128000


def test_invalid_config_fails_closed(tmp_path) -> None:
    invalid = tmp_path / "audio.yaml"
    invalid.write_text(json.dumps({"schema_version": "1.0.0"}), encoding="utf-8")

    with pytest.raises(AudioPipelineError) as raised:
        load_audio_config(invalid)

    assert raised.value.code is AudioErrorCode.INVALID_AUDIO_CONFIG
    assert str(tmp_path) not in str(raised.value)
