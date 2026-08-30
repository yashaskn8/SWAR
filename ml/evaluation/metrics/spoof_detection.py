"""Spoof precision/recall/F1/EER with explicit score direction."""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

from evaluation.metrics.common import (
    MetricInputError,
    RateEstimate,
    equal_error_rate,
    orient_scores,
    undefined_rate,
    validate_binary_inputs,
    wilson_rate,
)


@dataclass(frozen=True)
class SpoofDetectionMetrics:
    positive_class: str
    score_direction: str
    decision_threshold: float
    sample_count: int
    spoof_count: int
    bonafide_count: int
    true_positive: int
    false_positive: int
    true_negative: int
    false_negative: int
    precision: RateEstimate
    recall: RateEstimate
    f1: float
    equal_error_rate: float
    equal_error_threshold: float

    def as_record(self) -> dict[str, object]:
        return asdict(self)


def compute_spoof_metrics(
    labels: np.ndarray,
    raw_scores: np.ndarray,
    *,
    decision_threshold: float,
    higher_is_more_spoof: bool,
) -> SpoofDetectionMetrics:
    """Treat label 1 as spoof; RawNet2/AASIST raw bona-fide logits set direction false."""

    if not np.isfinite(decision_threshold):
        raise MetricInputError("DECISION_THRESHOLD_INVALID")
    target, values = validate_binary_inputs(labels, raw_scores)
    scores = orient_scores(values, higher_is_positive=higher_is_more_spoof)
    threshold = decision_threshold if higher_is_more_spoof else -decision_threshold
    predicted = scores >= threshold
    positive = target == 1
    negative = ~positive
    true_positive = int(np.count_nonzero(predicted & positive))
    false_positive = int(np.count_nonzero(predicted & negative))
    true_negative = int(np.count_nonzero(~predicted & negative))
    false_negative = int(np.count_nonzero(~predicted & positive))
    precision_denominator = true_positive + false_positive
    precision = (
        wilson_rate(true_positive, precision_denominator)
        if precision_denominator > 0
        else undefined_rate()
    )
    recall = wilson_rate(true_positive, true_positive + false_negative)
    f1 = 2.0 * precision.value * recall.value / max(1e-12, precision.value + recall.value)
    eer, eer_threshold = equal_error_rate(target, scores)
    if not higher_is_more_spoof:
        eer_threshold = -eer_threshold
    return SpoofDetectionMetrics(
        positive_class="SPOOF",
        score_direction=(
            "HIGHER_IS_MORE_SPOOF" if higher_is_more_spoof else "HIGHER_IS_MORE_BONAFIDE"
        ),
        decision_threshold=float(decision_threshold),
        sample_count=int(target.size),
        spoof_count=int(np.count_nonzero(positive)),
        bonafide_count=int(np.count_nonzero(negative)),
        true_positive=true_positive,
        false_positive=false_positive,
        true_negative=true_negative,
        false_negative=false_negative,
        precision=precision,
        recall=recall,
        f1=float(f1),
        equal_error_rate=float(eer),
        equal_error_threshold=float(eer_threshold),
    )
