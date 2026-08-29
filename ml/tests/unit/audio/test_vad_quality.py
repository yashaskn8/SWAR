from __future__ import annotations

import numpy as np

from app.audio.errors import InsufficientReasonCode
from app.audio.quality import EvidenceReadiness, QualityEvaluator
from app.audio.vad import EnergyVad
from tests.unit.audio.conftest import tone, window


def test_insufficient_reason_code_vocabulary_is_stable_and_contract_safe() -> None:
    expected = (
        "PARTIAL_WINDOW",
        "INSUFFICIENT_SPEECH",
        "EXCESSIVE_SILENCE",
        "CLIPPING",
        "LOW_LEVEL",
        "NOISE_PROXY_HIGH",
        "DISCONTINUITY",
        "PACKET_GAP",
    )

    assert tuple(reason.value for reason in InsufficientReasonCode) == expected
    assert all(len(reason) <= 80 for reason in expected)


def test_clean_tone_has_sufficient_measured_speech(audio_config) -> None:
    samples = tone(seconds=4.0)
    vad = EnergyVad(audio_config).analyze(samples, 16000)
    evidence = QualityEvaluator(audio_config).evaluate(window(samples))

    assert vad.speech_duration_ms == 4000
    assert vad.total_duration_ms == 4000
    assert evidence.readiness is EvidenceReadiness.SUFFICIENT
    assert evidence.reason_codes == ()
    assert evidence.speech_duration_ms == 4000


def test_silence_is_insufficient_without_authenticity_claim(audio_config) -> None:
    evidence = QualityEvaluator(audio_config).evaluate(window(np.zeros(64000, dtype=np.float32)))

    assert evidence.readiness is EvidenceReadiness.INSUFFICIENT_EVIDENCE
    assert InsufficientReasonCode.INSUFFICIENT_SPEECH in evidence.reason_codes
    assert InsufficientReasonCode.EXCESSIVE_SILENCE in evidence.reason_codes
    assert InsufficientReasonCode.LOW_LEVEL in evidence.reason_codes
    assert evidence.speech_duration_ms == 0


def test_short_speech_in_full_window_reports_actual_duration(audio_config) -> None:
    samples = np.concatenate((tone(seconds=0.5), np.zeros(56000, dtype=np.float32)))
    evidence = QualityEvaluator(audio_config).evaluate(window(samples))

    assert evidence.speech_duration_ms == 500
    assert InsufficientReasonCode.INSUFFICIENT_SPEECH in evidence.reason_codes
    assert InsufficientReasonCode.EXCESSIVE_SILENCE in evidence.reason_codes


def test_clipping_low_level_noise_and_discontinuity_reasons(audio_config) -> None:
    evaluator = QualityEvaluator(audio_config)
    clipped = evaluator.evaluate(window(np.ones(64000, dtype=np.float32)))
    assert InsufficientReasonCode.CLIPPING in clipped.reason_codes

    generator = np.random.default_rng(42)
    noise = generator.normal(0.0, 0.1, 64000).astype(np.float32)
    noisy = evaluator.evaluate(window(noise))
    assert InsufficientReasonCode.NOISE_PROXY_HIGH in noisy.reason_codes

    interrupted = evaluator.evaluate(window(tone(seconds=4.0), discontinuity=True, packet_gap=True))
    assert InsufficientReasonCode.DISCONTINUITY in interrupted.reason_codes
    assert InsufficientReasonCode.PACKET_GAP in interrupted.reason_codes


def test_partial_window_is_never_promoted_to_sufficient(audio_config) -> None:
    evidence = QualityEvaluator(audio_config).evaluate(window(tone(seconds=2.0), partial=True))

    assert evidence.readiness is EvidenceReadiness.INSUFFICIENT_EVIDENCE
    assert evidence.reason_codes[0] == InsufficientReasonCode.PARTIAL_WINDOW
    assert evidence.total_duration_ms == 2000
    assert 0.0 <= evidence.quality_score <= 1.0
