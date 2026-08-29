"""Deterministic spectral-feature logistic baseline for governed spoof data.

The decision function is an uncalibrated raw score. This module intentionally exposes no
probability API and makes no production model-performance claim.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Self

import numpy as np


class BaselineDataError(ValueError):
    """Stable baseline input/training failure."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class SpectralFeatureConfig:
    version: str = "phase-m-spectral-v1"
    sample_rate_hz: int = 16_000
    frame_ms: int = 25
    hop_ms: int = 10
    fft_size: int = 512
    band_count: int = 20

    def as_record(self) -> dict[str, str | int]:
        return asdict(self)


@dataclass(frozen=True)
class LogisticRegressionConfig:
    version: str = "phase-m-logistic-v1"
    seed: int = 26_104
    epochs: int = 250
    learning_rate: float = 0.05
    l2_penalty: float = 0.0001
    decision_threshold: float = 0.0

    def as_record(self) -> dict[str, str | int | float]:
        return asdict(self)


@dataclass(frozen=True)
class BinaryMetricSummary:
    positive_class: str
    decision_threshold: float
    sample_count: int
    positive_count: int
    negative_count: int
    true_positive: int
    false_positive: int
    true_negative: int
    false_negative: int
    precision: float
    recall: float
    f1: float
    eer: float
    eer_threshold: float

    def as_record(self) -> dict[str, str | int | float]:
        return asdict(self)


def _validate_feature_config(config: SpectralFeatureConfig) -> tuple[int, int]:
    frame_samples = config.sample_rate_hz * config.frame_ms // 1000
    hop_samples = config.sample_rate_hz * config.hop_ms // 1000
    if (
        config.version != "phase-m-spectral-v1"
        or config.sample_rate_hz != 16_000
        or frame_samples <= 0
        or hop_samples <= 0
        or config.fft_size < frame_samples
        or config.band_count < 2
        or config.band_count > config.fft_size // 2
    ):
        raise BaselineDataError("BASELINE_FEATURE_CONFIG_INVALID")
    return frame_samples, hop_samples


def extract_spectral_features(
    samples: np.ndarray,
    config: SpectralFeatureConfig | None = None,
) -> np.ndarray:
    """Extract deterministic log-band moments and transparent spectral summaries."""

    selected = config or SpectralFeatureConfig()
    frame_samples, hop_samples = _validate_feature_config(selected)
    signal = np.asarray(samples, dtype=np.float32)
    if (
        signal.ndim != 1
        or signal.size < frame_samples
        or signal.size > selected.sample_rate_hz * 60
        or not np.isfinite(signal).all()
        or np.any(signal < -1.0)
        or np.any(signal > 1.0)
    ):
        raise BaselineDataError("BASELINE_AUDIO_INVALID")

    frame_count = 1 + (signal.size - frame_samples) // hop_samples
    offsets = np.arange(frame_count, dtype=np.int64)[:, None] * hop_samples
    indices = offsets + np.arange(frame_samples, dtype=np.int64)[None, :]
    frames = signal[indices].astype(np.float64, copy=False)
    windowed = frames * np.hanning(frame_samples)[None, :]
    spectrum = np.abs(np.fft.rfft(windowed, n=selected.fft_size, axis=1)) ** 2
    spectrum = spectrum[:, 1:] + 1e-12
    log_spectrum = np.log(spectrum)
    bands = np.array_split(np.arange(log_spectrum.shape[1]), selected.band_count)
    band_energy = np.stack([np.mean(log_spectrum[:, band], axis=1) for band in bands], axis=1)

    frequencies = np.fft.rfftfreq(selected.fft_size, d=1.0 / selected.sample_rate_hz)[1:]
    magnitude_sum = np.sum(spectrum, axis=1)
    centroid = np.sum(spectrum * frequencies[None, :], axis=1) / magnitude_sum
    frame_energy = np.log(np.mean(frames**2, axis=1) + 1e-12)
    zero_crossing = np.mean(np.abs(np.diff(np.signbit(frames), axis=1)), axis=1)
    features = np.concatenate(
        [
            np.mean(band_energy, axis=0),
            np.std(band_energy, axis=0),
            [np.mean(centroid), np.std(centroid)],
            [np.mean(frame_energy), np.std(frame_energy)],
            [np.mean(zero_crossing), np.std(zero_crossing)],
        ]
    ).astype(np.float64)
    if not np.isfinite(features).all():
        raise BaselineDataError("BASELINE_FEATURE_NON_FINITE")
    features.setflags(write=False)
    return features


class SpectralLogisticBaseline:
    """Small deterministic logistic learner exposing only uncalibrated decision scores."""

    def __init__(self, config: LogisticRegressionConfig | None = None) -> None:
        self.config = config or LogisticRegressionConfig()
        self._mean: np.ndarray | None = None
        self._scale: np.ndarray | None = None
        self._weights: np.ndarray | None = None
        self._bias: float | None = None

    def fit(self, features: np.ndarray, labels: np.ndarray) -> Self:
        matrix, target = _validate_matrix(features, labels)
        if set(np.unique(target).tolist()) != {0.0, 1.0}:
            raise BaselineDataError("BASELINE_TRAIN_SPLIT_SINGLE_CLASS")
        if (
            self.config.version != "phase-m-logistic-v1"
            or self.config.epochs <= 0
            or not 0.0 < self.config.learning_rate <= 1.0
            or self.config.l2_penalty < 0.0
        ):
            raise BaselineDataError("BASELINE_OPTIMIZER_CONFIG_INVALID")

        mean = np.mean(matrix, axis=0)
        scale = np.std(matrix, axis=0)
        scale = np.where(scale < 1e-12, 1.0, scale)
        normalized = (matrix - mean) / scale
        generator = np.random.default_rng(self.config.seed)
        weights = generator.normal(0.0, 0.001, size=matrix.shape[1])
        bias = 0.0
        for _ in range(self.config.epochs):
            logits = normalized @ weights + bias
            sigmoid = 1.0 / (1.0 + np.exp(-np.clip(logits, -40.0, 40.0)))
            residual = sigmoid - target
            gradient = normalized.T @ residual / target.size
            gradient += self.config.l2_penalty * weights
            weights -= self.config.learning_rate * gradient
            bias -= self.config.learning_rate * float(np.mean(residual))

        self._mean = mean
        self._scale = scale
        self._weights = weights
        self._bias = bias
        return self

    def decision_function(self, features: np.ndarray) -> np.ndarray:
        if any(value is None for value in (self._mean, self._scale, self._weights, self._bias)):
            raise BaselineDataError("BASELINE_NOT_FITTED")
        matrix = np.asarray(features, dtype=np.float64)
        if matrix.ndim == 1:
            matrix = matrix[None, :]
        if matrix.ndim != 2 or not np.isfinite(matrix).all():
            raise BaselineDataError("BASELINE_FEATURE_MATRIX_INVALID")
        assert self._mean is not None
        assert self._scale is not None
        assert self._weights is not None
        assert self._bias is not None
        if matrix.shape[1] != self._weights.size:
            raise BaselineDataError("BASELINE_FEATURE_DIMENSION_CONFLICT")
        scores = ((matrix - self._mean) / self._scale) @ self._weights + self._bias
        scores = np.asarray(scores, dtype=np.float64)
        scores.setflags(write=False)
        return scores


def _validate_matrix(features: np.ndarray, labels: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    matrix = np.asarray(features, dtype=np.float64)
    target = np.asarray(labels, dtype=np.float64)
    if (
        matrix.ndim != 2
        or target.ndim != 1
        or matrix.shape[0] != target.size
        or matrix.shape[0] < 2
        or matrix.shape[1] < 1
        or not np.isfinite(matrix).all()
        or not np.isfinite(target).all()
        or not set(np.unique(target).tolist()).issubset({0.0, 1.0})
    ):
        raise BaselineDataError("BASELINE_FEATURE_MATRIX_INVALID")
    return matrix, target


def compute_binary_metrics(
    labels: np.ndarray,
    scores: np.ndarray,
    *,
    decision_threshold: float = 0.0,
) -> BinaryMetricSummary:
    """Compute measured fixture/governed-run metrics without calibration claims."""

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
        raise BaselineDataError("BASELINE_EVALUATION_SPLIT_INVALID")
    predicted = values >= decision_threshold
    positive = target == 1
    negative = ~positive
    true_positive = int(np.count_nonzero(predicted & positive))
    false_positive = int(np.count_nonzero(predicted & negative))
    true_negative = int(np.count_nonzero(~predicted & negative))
    false_negative = int(np.count_nonzero(~predicted & positive))
    precision = true_positive / max(1, true_positive + false_positive)
    recall = true_positive / max(1, true_positive + false_negative)
    f1 = 2.0 * precision * recall / max(1e-12, precision + recall)
    eer, eer_threshold = _equal_error_rate(target, values)
    return BinaryMetricSummary(
        positive_class="SPOOF",
        decision_threshold=float(decision_threshold),
        sample_count=int(target.size),
        positive_count=int(np.count_nonzero(positive)),
        negative_count=int(np.count_nonzero(negative)),
        true_positive=true_positive,
        false_positive=false_positive,
        true_negative=true_negative,
        false_negative=false_negative,
        precision=round(float(precision), 12),
        recall=round(float(recall), 12),
        f1=round(float(f1), 12),
        eer=round(eer, 12),
        eer_threshold=round(eer_threshold, 12),
    )


def _equal_error_rate(labels: np.ndarray, scores: np.ndarray) -> tuple[float, float]:
    unique = np.unique(scores)
    if unique.size == 1:
        return 0.5, float(unique[0])
    midpoints = (unique[:-1] + unique[1:]) / 2.0
    margin = max(1.0, float(unique[-1] - unique[0]))
    thresholds = np.concatenate(([unique[0] - margin], midpoints, [unique[-1] + margin]))
    positives = labels == 1
    negatives = ~positives
    candidates: list[tuple[float, float, float]] = []
    for threshold in thresholds:
        predicted = scores >= threshold
        false_positive_rate = np.count_nonzero(predicted & negatives) / np.count_nonzero(negatives)
        false_negative_rate = np.count_nonzero(~predicted & positives) / np.count_nonzero(positives)
        candidates.append(
            (
                abs(float(false_positive_rate - false_negative_rate)),
                float((false_positive_rate + false_negative_rate) / 2.0),
                float(threshold),
            )
        )
    _, eer, threshold = min(candidates, key=lambda item: (item[0], item[2]))
    return eer, threshold
