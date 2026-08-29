from __future__ import annotations

import numpy as np
import pytest

from app.audio.errors import AudioErrorCode, AudioPipelineError
from app.audio.rolling_window import RollingWindowBuffer
from tests.unit.audio.conftest import canonical, tone


def test_exact_four_second_windows_one_second_stride_and_order(audio_config) -> None:
    source = tone(seconds=5.0)
    buffer = RollingWindowBuffer(audio_config)

    windows = buffer.append(canonical(source, sequence=1))

    assert [window.sequence for window in windows] == [1, 2]
    assert [(window.start_ms, window.end_ms) for window in windows] == [
        (0, 4000),
        (1000, 5000),
    ]
    assert all(window.samples.size == 64000 for window in windows)
    np.testing.assert_array_equal(windows[0].samples, source[:64000])
    np.testing.assert_array_equal(windows[1].samples, source[16000:80000])
    assert buffer.buffered_samples == 48000
    assert buffer.finish() == ()
    assert buffer.buffered_samples == 0


def test_chunked_input_has_identical_window_timing(audio_config) -> None:
    source = tone(seconds=5.0)
    buffer = RollingWindowBuffer(audio_config)
    windows = []
    for index in range(5):
        chunk = source[index * 16000 : (index + 1) * 16000]
        windows.extend(buffer.append(canonical(chunk, sequence=index + 1)))

    assert [(item.sequence, item.start_ms, item.end_ms) for item in windows] == [
        (1, 0, 4000),
        (2, 1000, 5000),
    ]
    assert buffer.finish() == ()


def test_source_sequence_gap_resets_segment_and_marks_first_new_window(audio_config) -> None:
    buffer = RollingWindowBuffer(audio_config)
    one_second = tone(seconds=1.0)

    assert buffer.append(canonical(one_second, sequence=1)) == ()
    assert buffer.append(canonical(one_second, sequence=2)) == ()
    assert buffer.append(canonical(one_second, sequence=4)) == ()
    assert buffer.append(canonical(one_second, sequence=5)) == ()
    assert buffer.append(canonical(one_second, sequence=6)) == ()
    windows = buffer.append(canonical(one_second, sequence=7))

    assert len(windows) == 1
    assert windows[0].start_ms == 2000
    assert windows[0].end_ms == 6000
    assert windows[0].discontinuity_before is True
    assert windows[0].packet_gap_before is True


def test_timeline_gap_never_creates_cross_gap_window(audio_config) -> None:
    buffer = RollingWindowBuffer(audio_config)
    two_seconds = tone(seconds=2.0)
    buffer.append(canonical(two_seconds, sequence=1), start_sample=0)
    windows = buffer.append(canonical(tone(seconds=4.0), sequence=2), start_sample=48000)

    assert len(windows) == 1
    assert windows[0].start_ms == 3000
    assert windows[0].end_ms == 7000
    assert windows[0].gap_samples == 16000
    assert windows[0].discontinuity_before
    assert windows[0].packet_gap_before


def test_final_partial_window_is_unpadded_and_cleanup_is_terminal(audio_config) -> None:
    buffer = RollingWindowBuffer(audio_config)
    source = tone(seconds=2.25)
    assert buffer.append(canonical(source)) == ()

    partial = buffer.finish()

    assert len(partial) == 1
    assert partial[0].is_partial
    assert partial[0].samples.size == source.size
    assert partial[0].end_ms == 2250
    assert buffer.buffered_samples == 0
    assert buffer.closed
    with pytest.raises(AudioPipelineError) as raised:
        buffer.append(canonical(tone(seconds=1.0)))
    assert raised.value.code is AudioErrorCode.PIPELINE_CLOSED


def test_exact_final_full_window_does_not_emit_redundant_partial(audio_config) -> None:
    buffer = RollingWindowBuffer(audio_config)
    full = buffer.append(canonical(tone(seconds=4.0)))
    assert len(full) == 1
    assert buffer.finish() == ()


def test_buffer_rejects_single_input_larger_than_configured_bound(audio_config) -> None:
    too_large = np.zeros(audio_config.max_buffer_samples + 1, dtype=np.float32)
    with pytest.raises(AudioPipelineError) as raised:
        RollingWindowBuffer(audio_config).append(canonical(too_large))
    assert raised.value.code is AudioErrorCode.BUFFER_LIMIT_EXCEEDED


def test_clear_releases_buffer_and_rejects_reuse(audio_config) -> None:
    buffer = RollingWindowBuffer(audio_config)
    buffer.append(canonical(tone(seconds=1.0)))
    assert buffer.buffered_samples == 16000
    buffer.clear()
    assert buffer.buffered_samples == 0
    assert buffer.closed
