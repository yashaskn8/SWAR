"""Validation-only RawNet2/AASIST fusion; neither model overrides the other."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import numpy as np

from calibration.score_calibrator import CalibrationError, _sigmoid, fit_logistic_parameters
from evaluation.metrics.common import MetricInputError, validate_binary_inputs

FUSION_METHOD = "swar-rawnet2-aasist-logistic-fusion-v1"


def _fusion_version(record: Mapping[str, Any]) -> str:
    material = json.dumps(record, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "swar-fusion-" + hashlib.sha256(material).hexdigest()[:24]


@dataclass(frozen=True)
class SpoofFusionCalibrator:
    bias: float
    rawnet2_weight: float
    aasist_weight: float
    calibration_version: str
    provenance: Mapping[str, str | int | float]

    @classmethod
    def fit(
        cls,
        labels: np.ndarray,
        rawnet2_bonafide_logits: np.ndarray,
        aasist_bonafide_logits: np.ndarray,
        *,
        split_name: str,
        manifest_sha256: str,
        registry_sha256: str,
        preprocessing_version: str,
        rawnet2_checkpoint_sha256: str,
        aasist_checkpoint_sha256: str,
        regularization: float = 1e-6,
    ) -> SpoofFusionCalibrator:
        if split_name != "VALIDATION":
            raise CalibrationError("FUSION_REQUIRES_VALIDATION_SPLIT")
        try:
            target, rawnet = validate_binary_inputs(labels, rawnet2_bonafide_logits)
            second_target, aasist = validate_binary_inputs(labels, aasist_bonafide_logits)
        except MetricInputError as error:
            raise CalibrationError("FUSION_FIT_INPUT_INVALID") from error
        if not np.array_equal(target, second_target):
            raise CalibrationError("FUSION_LABEL_ALIGNMENT_INVALID")
        # Both Phase N adapters expose higher-is-more-bona-fide logits. Negate
        # them so the fitted positive class remains SPOOF.
        features = np.column_stack((-rawnet, -aasist))
        bias, coefficients, iterations = fit_logistic_parameters(
            target,
            features,
            regularization=regularization,
        )
        provenance: dict[str, str | int | float] = {
            "method": FUSION_METHOD,
            "fit_split": split_name,
            "manifest_sha256": manifest_sha256,
            "registry_sha256": registry_sha256,
            "preprocessing_version": preprocessing_version,
            "rawnet2_checkpoint_sha256": rawnet2_checkpoint_sha256,
            "aasist_checkpoint_sha256": aasist_checkpoint_sha256,
            "sample_count": int(target.size),
            "positive_count": int(np.count_nonzero(target == 1)),
            "negative_count": int(np.count_nonzero(target == 0)),
            "regularization": regularization,
            "fit_iterations": iterations,
        }
        unsigned = {
            "schema_version": "1.0.0",
            "status": "CALIBRATED_VALIDATION_ONLY",
            "positive_class": "SPOOF",
            "input_score_directions": {
                "rawnet2": "HIGHER_IS_MORE_BONAFIDE",
                "aasist": "HIGHER_IS_MORE_BONAFIDE",
            },
            "bias": bias,
            "rawnet2_weight": float(coefficients[0]),
            "aasist_weight": float(coefficients[1]),
            "provenance": provenance,
        }
        return cls(
            bias=bias,
            rawnet2_weight=float(coefficients[0]),
            aasist_weight=float(coefficients[1]),
            calibration_version=_fusion_version(unsigned),
            provenance=provenance,
        )

    def predict_spoof_probability(
        self,
        rawnet2_bonafide_logits: np.ndarray,
        aasist_bonafide_logits: np.ndarray,
    ) -> np.ndarray:
        rawnet = np.asarray(rawnet2_bonafide_logits, dtype=np.float64)
        aasist = np.asarray(aasist_bonafide_logits, dtype=np.float64)
        if (
            rawnet.ndim != 1
            or aasist.ndim != 1
            or rawnet.size != aasist.size
            or not np.isfinite(rawnet).all()
            or not np.isfinite(aasist).all()
        ):
            raise CalibrationError("FUSION_SCORE_INPUT_INVALID")
        logits = self.bias - self.rawnet2_weight * rawnet - self.aasist_weight * aasist
        probabilities = np.asarray(_sigmoid(logits), dtype=np.float64)
        probabilities.setflags(write=False)
        return probabilities

    def to_record(self) -> dict[str, Any]:
        return {
            "schema_version": "1.0.0",
            "status": "CALIBRATED_VALIDATION_ONLY",
            "calibration_version": self.calibration_version,
            "positive_class": "SPOOF",
            "input_score_directions": {
                "rawnet2": "HIGHER_IS_MORE_BONAFIDE",
                "aasist": "HIGHER_IS_MORE_BONAFIDE",
            },
            "bias": self.bias,
            "rawnet2_weight": self.rawnet2_weight,
            "aasist_weight": self.aasist_weight,
            "provenance": dict(self.provenance),
        }
