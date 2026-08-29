from __future__ import annotations

import numpy as np
import pytest

from baselines.spectral_baseline import (
    BaselineDataError,
    LogisticRegressionConfig,
    SpectralLogisticBaseline,
    compute_binary_metrics,
    extract_spectral_features,
)


def generated_signal(frequency_hz: float, seed: int) -> np.ndarray:
    generator = np.random.default_rng(seed)
    time = np.arange(64_000, dtype=np.float64) / 16_000
    samples = 0.25 * np.sin(2.0 * np.pi * frequency_hz * time)
    samples += generator.normal(0.0, 0.002, size=time.size)
    return np.asarray(samples, dtype=np.float32)


def fixture_matrix() -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    train_specs = [(180.0, 1, 0), (220.0, 2, 0), (260.0, 3, 0), (300.0, 4, 0)]
    train_specs += [(900.0, 5, 1), (1100.0, 6, 1), (1300.0, 7, 1), (1500.0, 8, 1)]
    eval_specs = [(200.0, 9, 0), (280.0, 10, 0), (1000.0, 11, 1), (1400.0, 12, 1)]
    train = np.stack(
        [
            extract_spectral_features(generated_signal(frequency, seed))
            for frequency, seed, _ in train_specs
        ]
    )
    evaluation = np.stack(
        [
            extract_spectral_features(generated_signal(frequency, seed))
            for frequency, seed, _ in eval_specs
        ]
    )
    return (
        train,
        np.asarray([label for _, _, label in train_specs]),
        evaluation,
        np.asarray([label for _, _, label in eval_specs]),
    )


def test_spectral_logistic_baseline_is_reproducible_and_exposes_raw_scores_only() -> None:
    train, train_labels, evaluation, evaluation_labels = fixture_matrix()
    config = LogisticRegressionConfig(seed=26_104)
    first = SpectralLogisticBaseline(config).fit(train, train_labels)
    second = SpectralLogisticBaseline(config).fit(train, train_labels)

    first_scores = first.decision_function(evaluation)
    second_scores = second.decision_function(evaluation)
    first_metrics = compute_binary_metrics(evaluation_labels, first_scores)
    second_metrics = compute_binary_metrics(evaluation_labels, second_scores)

    np.testing.assert_array_equal(first_scores, second_scores)
    assert first_metrics == second_metrics
    assert first_metrics.positive_class == "SPOOF"
    assert 0.0 <= first_metrics.f1 <= 1.0
    assert 0.0 <= first_metrics.eer <= 1.0
    assert not hasattr(first, "predict_proba")


def test_baseline_rejects_single_class_and_malformed_inputs() -> None:
    train, _, _, _ = fixture_matrix()
    with pytest.raises(BaselineDataError, match="BASELINE_TRAIN_SPLIT_SINGLE_CLASS"):
        SpectralLogisticBaseline().fit(train, np.zeros(train.shape[0]))
    with pytest.raises(BaselineDataError, match="BASELINE_AUDIO_INVALID"):
        extract_spectral_features(np.asarray([np.nan], dtype=np.float32))
