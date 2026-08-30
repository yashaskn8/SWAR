from __future__ import annotations

import numpy as np
import pytest

from evaluation.metrics.calibration import compute_calibration_metrics
from evaluation.metrics.common import MetricInputError
from evaluation.metrics.speaker_verification import compute_speaker_metrics
from evaluation.metrics.spoof_detection import compute_spoof_metrics


def test_speaker_metrics_have_analytically_known_rates() -> None:
    result = compute_speaker_metrics(
        np.array([1, 1, 0, 0]),
        np.array([0.9, 0.4, 0.6, 0.1]),
        decision_threshold=0.5,
    )

    assert result.false_acceptance_rate.value == 0.5
    assert result.false_rejection_rate.value == 0.5
    assert result.equal_error_rate == 0.5


def test_spoof_metrics_orient_bonafide_logits() -> None:
    result = compute_spoof_metrics(
        np.array([1, 1, 0, 0]),
        np.array([-2.0, -1.0, 2.0, 1.0]),
        decision_threshold=0.0,
        higher_is_more_spoof=False,
    )

    assert result.precision.value == 1.0
    assert result.recall.value == 1.0
    assert result.f1 == 1.0
    assert result.equal_error_rate == 0.0


def test_zero_predicted_positive_has_explicit_undefined_precision() -> None:
    result = compute_spoof_metrics(
        np.array([1, 0]),
        np.array([0.0, 0.0]),
        decision_threshold=1.0,
        higher_is_more_spoof=True,
    )

    assert result.precision.is_defined is False
    assert result.precision.denominator == 0
    assert result.precision.wilson_95_lower is None
    assert result.f1 == 0.0


def test_calibration_metrics_known_perfect_probabilities() -> None:
    result = compute_calibration_metrics(
        np.array([0, 1]),
        np.array([0.0, 1.0]),
        bin_count=2,
    )

    assert result.brier_score == 0.0
    assert result.expected_calibration_error == 0.0


def test_metric_inputs_reject_nonfinite_threshold() -> None:
    with pytest.raises(MetricInputError, match="DECISION_THRESHOLD_INVALID"):
        compute_speaker_metrics(
            np.array([1, 0]),
            np.array([1.0, 0.0]),
            decision_threshold=float("nan"),
        )
