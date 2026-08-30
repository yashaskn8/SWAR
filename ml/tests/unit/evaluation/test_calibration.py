from __future__ import annotations

import numpy as np
import pytest

from calibration.score_calibrator import CalibrationError, PlattCalibrator
from calibration.spoof_evidence_fusion import SpoofFusionCalibrator

HASH_A = "a" * 64
HASH_B = "b" * 64
HASH_C = "c" * 64


def test_platt_calibration_round_trip_preserves_direction_and_version() -> None:
    calibrator = PlattCalibrator.fit(
        np.array([0, 0, 1, 1]),
        np.array([2.0, 1.0, -1.0, -2.0]),
        positive_class="SPOOF",
        score_direction="HIGHER_IS_MORE_BONAFIDE",
        higher_is_positive=False,
        split_name="VALIDATION",
        manifest_sha256=HASH_A,
        registry_sha256=HASH_B,
        preprocessing_version="phase-l-test",
        model_id="rawnet2",
        model_version="test-only",
        checkpoint_sha256=HASH_C,
        score_name="bonafide_logit",
    )

    restored = PlattCalibrator.from_record(calibrator.to_record())
    probabilities = restored.predict_probability(np.array([2.0, -2.0]))

    assert restored.calibration_version == calibrator.calibration_version
    assert probabilities[0] < probabilities[1]
    assert 0.0 <= probabilities[0] <= 1.0
    assert 0.0 <= probabilities[1] <= 1.0


def test_calibration_rejects_test_and_final_ood_fitting() -> None:
    for split in ("TEST", "FINAL_OOD"):
        with pytest.raises(CalibrationError, match="CALIBRATION_REQUIRES_VALIDATION_SPLIT"):
            PlattCalibrator.fit(
                np.array([0, 1]),
                np.array([1.0, -1.0]),
                positive_class="SPOOF",
                score_direction="HIGHER_IS_MORE_BONAFIDE",
                higher_is_positive=False,
                split_name=split,
                manifest_sha256=HASH_A,
                registry_sha256=HASH_B,
                preprocessing_version="phase-l-test",
                model_id="rawnet2",
                model_version="test-only",
                checkpoint_sha256=HASH_C,
                score_name="bonafide_logit",
            )


def test_calibration_rejects_declared_direction_mismatch() -> None:
    with pytest.raises(CalibrationError, match="CALIBRATION_SCORE_DIRECTION_CONTRADICTED"):
        PlattCalibrator.fit(
            np.array([0, 1]),
            np.array([1.0, -1.0]),
            positive_class="SPOOF",
            score_direction="HIGHER_IS_MORE_BONAFIDE",
            higher_is_positive=True,
            split_name="VALIDATION",
            manifest_sha256=HASH_A,
            registry_sha256=HASH_B,
            preprocessing_version="phase-l-test",
            model_id="rawnet2",
            model_version="test-only",
            checkpoint_sha256=HASH_C,
            score_name="bonafide_logit",
        )


def test_spoof_fusion_uses_both_validation_scores() -> None:
    fusion = SpoofFusionCalibrator.fit(
        np.array([0, 0, 1, 1]),
        np.array([2.0, 1.0, -1.0, -2.0]),
        np.array([1.5, 0.5, -0.5, -1.5]),
        split_name="VALIDATION",
        manifest_sha256=HASH_A,
        registry_sha256=HASH_B,
        preprocessing_version="phase-l-test",
        rawnet2_checkpoint_sha256=HASH_B,
        aasist_checkpoint_sha256=HASH_C,
    )
    probabilities = fusion.predict_spoof_probability(
        np.array([2.0, -2.0]),
        np.array([1.5, -1.5]),
    )

    assert fusion.rawnet2_weight != 0.0
    assert fusion.aasist_weight != 0.0
    assert probabilities[0] < probabilities[1]
    assert fusion.to_record()["input_score_directions"] == {
        "rawnet2": "HIGHER_IS_MORE_BONAFIDE",
        "aasist": "HIGHER_IS_MORE_BONAFIDE",
    }
