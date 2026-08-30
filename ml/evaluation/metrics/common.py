"""Shared deterministic binary-metric primitives."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


class MetricInputError(ValueError):
    pass


@dataclass(frozen=True)
class RateEstimate:
    value: float
    numerator: int
    denominator: int
    wilson_95_lower: float | None
    wilson_95_upper: float | None
    is_defined: bool = True


def validate_binary_inputs(labels: np.ndarray, scores: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    target = np.asarray(labels, dtype=np.int64)
    values = np.asarray(scores, dtype=np.float64)
    if (
        target.ndim != 1
        or values.ndim != 1
        or target.size != values.size
        or target.size < 2
        or not np.isfinite(values).all()
        or set(np.unique(target).tolist()) != {0, 1}
    ):
        raise MetricInputError("BINARY_METRIC_INPUT_INVALID")
    return target, values


def wilson_rate(numerator: int, denominator: int) -> RateEstimate:
    if denominator <= 0 or numerator < 0 or numerator > denominator:
        raise MetricInputError("RATE_DENOMINATOR_INVALID")
    value = numerator / denominator
    z = 1.959963984540054
    z_squared = z * z
    adjusted = 1.0 + z_squared / denominator
    center = (value + z_squared / (2.0 * denominator)) / adjusted
    radius = (
        z
        * math.sqrt((value * (1.0 - value) + z_squared / (4.0 * denominator)) / denominator)
        / adjusted
    )
    return RateEstimate(
        value=float(value),
        numerator=numerator,
        denominator=denominator,
        wilson_95_lower=max(0.0, float(center - radius)),
        wilson_95_upper=min(1.0, float(center + radius)),
    )


def undefined_rate() -> RateEstimate:
    """Represent a zero-denominator rate without NaN or a fabricated interval."""

    return RateEstimate(
        value=0.0,
        numerator=0,
        denominator=0,
        wilson_95_lower=None,
        wilson_95_upper=None,
        is_defined=False,
    )


def equal_error_rate(labels: np.ndarray, higher_positive_scores: np.ndarray) -> tuple[float, float]:
    target, scores = validate_binary_inputs(labels, higher_positive_scores)
    unique = np.unique(scores)
    if unique.size == 1:
        return 0.5, float(unique[0])
    midpoints = (unique[:-1] + unique[1:]) / 2.0
    margin = max(1.0, float(unique[-1] - unique[0]))
    thresholds = np.concatenate(([unique[0] - margin], midpoints, [unique[-1] + margin]))
    positive = target == 1
    negative = ~positive
    candidates: list[tuple[float, float, float, float]] = []
    for threshold in thresholds:
        predicted = scores >= threshold
        false_accept = np.count_nonzero(predicted & negative) / np.count_nonzero(negative)
        false_reject = np.count_nonzero(~predicted & positive) / np.count_nonzero(positive)
        candidates.append(
            (
                abs(float(false_accept - false_reject)),
                float((false_accept + false_reject) / 2.0),
                float(threshold),
                float(false_accept - false_reject),
            )
        )
    for left, right in zip(candidates, candidates[1:], strict=True):
        if left[3] == 0.0:
            return left[1], left[2]
        if left[3] > 0.0 > right[3]:
            weight = left[3] / (left[3] - right[3])
            return (
                float(left[1] + weight * (right[1] - left[1])),
                float(left[2] + weight * (right[2] - left[2])),
            )
    _, eer, threshold, _ = min(candidates, key=lambda item: (item[0], item[2]))
    return eer, threshold


def orient_scores(scores: np.ndarray, *, higher_is_positive: bool) -> np.ndarray:
    values = np.asarray(scores, dtype=np.float64)
    if values.ndim != 1 or not np.isfinite(values).all():
        raise MetricInputError("SCORE_ARRAY_INVALID")
    oriented = values if higher_is_positive else -values
    oriented = np.asarray(oriented, dtype=np.float64)
    oriented.setflags(write=False)
    return oriented
