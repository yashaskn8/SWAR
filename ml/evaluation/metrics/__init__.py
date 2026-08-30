"""Phase O metric definitions with explicit positive-class semantics."""

from evaluation.metrics.speaker_verification import compute_speaker_metrics
from evaluation.metrics.spoof_detection import compute_spoof_metrics

__all__ = ["compute_speaker_metrics", "compute_spoof_metrics"]
