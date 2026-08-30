"""Reliability metrics for already calibrated probabilities."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from evaluation.metrics.common import MetricInputError


@dataclass(frozen=True)
class CalibrationMetrics:
    sample_count: int
    brier_score: float
    expected_calibration_error: float
    bin_count: int


def compute_calibration_metrics(
    labels: np.ndarray,
    probabilities: np.ndarray,
    *,
    bin_count: int = 10,
) -> CalibrationMetrics:
    target = np.asarray(labels, dtype=np.int64)
    values = np.asarray(probabilities, dtype=np.float64)
    if (
        target.ndim != 1
        or values.ndim != 1
        or target.size != values.size
        or target.size == 0
        or not set(np.unique(target).tolist()).issubset({0, 1})
        or not np.isfinite(values).all()
        or np.any((values < 0.0) | (values > 1.0))
        or bin_count < 2
        or bin_count > 1_000
    ):
        raise MetricInputError("CALIBRATION_METRIC_INPUT_INVALID")
    brier = float(np.mean(np.square(values - target)))
    expected_error = 0.0
    edges = np.linspace(0.0, 1.0, bin_count + 1)
    for index in range(bin_count):
        if index == bin_count - 1:
            selected = (values >= edges[index]) & (values <= edges[index + 1])
        else:
            selected = (values >= edges[index]) & (values < edges[index + 1])
        count = int(np.count_nonzero(selected))
        if count == 0:
            continue
        confidence = float(np.mean(values[selected]))
        observed = float(np.mean(target[selected]))
        expected_error += count / target.size * abs(confidence - observed)
    return CalibrationMetrics(
        sample_count=int(target.size),
        brier_score=brier,
        expected_calibration_error=float(expected_error),
        bin_count=bin_count,
    )
