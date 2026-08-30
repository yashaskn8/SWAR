"""Speaker-verification FAR, FRR, and EER with explicit uncertainty."""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

from evaluation.metrics.common import (
    MetricInputError,
    RateEstimate,
    equal_error_rate,
    orient_scores,
    validate_binary_inputs,
    wilson_rate,
)


@dataclass(frozen=True)
class SpeakerVerificationMetrics:
    positive_class: str
    score_direction: str
    decision_threshold: float
    sample_count: int
    genuine_count: int
    impostor_count: int
    false_acceptance_rate: RateEstimate
    false_rejection_rate: RateEstimate
    equal_error_rate: float
    equal_error_threshold: float

    def as_record(self) -> dict[str, object]:
        return asdict(self)


def compute_speaker_metrics(
    labels: np.ndarray,
    raw_scores: np.ndarray,
    *,
    decision_threshold: float,
    higher_is_more_similar: bool = True,
) -> SpeakerVerificationMetrics:
    """Treat label 1 as a genuine trial and label 0 as an impostor trial."""

    if not np.isfinite(decision_threshold):
        raise MetricInputError("DECISION_THRESHOLD_INVALID")
    target, values = validate_binary_inputs(labels, raw_scores)
    scores = orient_scores(values, higher_is_positive=higher_is_more_similar)
    threshold = decision_threshold if higher_is_more_similar else -decision_threshold
    accepted = scores >= threshold
    genuine = target == 1
    impostor = ~genuine
    false_accepts = int(np.count_nonzero(accepted & impostor))
    false_rejects = int(np.count_nonzero(~accepted & genuine))
    eer, eer_threshold = equal_error_rate(target, scores)
    if not higher_is_more_similar:
        eer_threshold = -eer_threshold
    return SpeakerVerificationMetrics(
        positive_class="GENUINE",
        score_direction=(
            "HIGHER_IS_MORE_SIMILAR" if higher_is_more_similar else "LOWER_IS_MORE_SIMILAR"
        ),
        decision_threshold=float(decision_threshold),
        sample_count=int(target.size),
        genuine_count=int(np.count_nonzero(genuine)),
        impostor_count=int(np.count_nonzero(impostor)),
        false_acceptance_rate=wilson_rate(false_accepts, int(np.count_nonzero(impostor))),
        false_rejection_rate=wilson_rate(false_rejects, int(np.count_nonzero(genuine))),
        equal_error_rate=float(eer),
        equal_error_threshold=float(eer_threshold),
    )
