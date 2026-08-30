"""Deterministic validation-only Platt calibration with versioned provenance."""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import numpy as np

from evaluation.metrics.common import MetricInputError, validate_binary_inputs

CALIBRATION_METHOD = "swar-platt-logistic-v1"


class CalibrationError(ValueError):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _sigmoid(values: np.ndarray) -> np.ndarray:
    clipped = np.clip(values, -50.0, 50.0)
    return 1.0 / (1.0 + np.exp(-clipped))


def fit_logistic_parameters(
    labels: np.ndarray,
    features: np.ndarray,
    *,
    regularization: float = 1e-6,
    maximum_iterations: int = 100,
    tolerance: float = 1e-10,
) -> tuple[float, np.ndarray, int]:
    """Fit a small deterministic logistic model with an unregularized intercept."""

    target = np.asarray(labels, dtype=np.float64)
    matrix = np.asarray(features, dtype=np.float64)
    if (
        target.ndim != 1
        or matrix.ndim != 2
        or matrix.shape[0] != target.size
        or matrix.shape[1] < 1
        or target.size < 2
        or set(np.unique(target).tolist()) != {0.0, 1.0}
        or not np.isfinite(matrix).all()
        or regularization < 0.0
        or maximum_iterations < 1
        or tolerance <= 0.0
    ):
        raise CalibrationError("CALIBRATION_FIT_INPUT_INVALID")
    design = np.column_stack((np.ones(target.size, dtype=np.float64), matrix))
    parameters = np.zeros(design.shape[1], dtype=np.float64)
    penalty = np.eye(design.shape[1], dtype=np.float64) * regularization
    penalty[0, 0] = 0.0
    iterations_run = 0
    for iteration in range(1, maximum_iterations + 1):
        iterations_run = iteration
        probabilities = _sigmoid(design @ parameters)
        gradient = design.T @ (probabilities - target) + penalty @ parameters
        weights = np.maximum(probabilities * (1.0 - probabilities), 1e-9)
        hessian = design.T @ (design * weights[:, None]) + penalty
        try:
            step = np.linalg.solve(hessian, gradient)
        except np.linalg.LinAlgError as error:
            raise CalibrationError("CALIBRATION_FIT_SINGULAR") from error
        parameters -= step
        if float(np.linalg.norm(step, ord=2)) <= tolerance:
            break
    if not np.isfinite(parameters).all():
        raise CalibrationError("CALIBRATION_FIT_NONFINITE")
    coefficients = np.asarray(parameters[1:], dtype=np.float64)
    coefficients.setflags(write=False)
    return float(parameters[0]), coefficients, iterations_run


def _artifact_version(record: Mapping[str, Any]) -> str:
    material = json.dumps(record, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "swar-cal-" + hashlib.sha256(material).hexdigest()[:24]


@dataclass(frozen=True)
class PlattCalibrator:
    bias: float
    weight: float
    positive_class: str
    score_direction: str
    calibration_version: str
    provenance: Mapping[str, str | int | float]

    @classmethod
    def fit(
        cls,
        labels: np.ndarray,
        raw_scores: np.ndarray,
        *,
        positive_class: str,
        score_direction: str,
        higher_is_positive: bool,
        split_name: str,
        manifest_sha256: str,
        registry_sha256: str,
        preprocessing_version: str,
        model_id: str,
        model_version: str,
        checkpoint_sha256: str,
        score_name: str,
        regularization: float = 1e-6,
    ) -> PlattCalibrator:
        if split_name != "VALIDATION":
            raise CalibrationError("CALIBRATION_REQUIRES_VALIDATION_SPLIT")
        if not positive_class or not score_direction or not score_name:
            raise CalibrationError("CALIBRATION_SEMANTICS_REQUIRED")
        direction_implies_higher_positive = score_direction in {
            "HIGHER_IS_MORE_SIMILAR",
            "HIGHER_IS_MORE_SPOOF",
        }
        if direction_implies_higher_positive != higher_is_positive:
            raise CalibrationError("CALIBRATION_SCORE_DIRECTION_CONTRADICTED")
        try:
            target, scores = validate_binary_inputs(labels, raw_scores)
        except MetricInputError as error:
            raise CalibrationError("CALIBRATION_FIT_INPUT_INVALID") from error
        oriented = scores if higher_is_positive else -scores
        bias, coefficients, iterations = fit_logistic_parameters(
            target,
            oriented[:, None],
            regularization=regularization,
        )
        if coefficients[0] <= 0.0:
            raise CalibrationError("CALIBRATION_SCORE_DIRECTION_CONTRADICTED")
        provenance: dict[str, str | int | float] = {
            "method": CALIBRATION_METHOD,
            "fit_split": split_name,
            "manifest_sha256": manifest_sha256,
            "registry_sha256": registry_sha256,
            "preprocessing_version": preprocessing_version,
            "model_id": model_id,
            "model_version": model_version,
            "checkpoint_sha256": checkpoint_sha256,
            "score_name": score_name,
            "sample_count": int(target.size),
            "positive_count": int(np.count_nonzero(target == 1)),
            "negative_count": int(np.count_nonzero(target == 0)),
            "regularization": regularization,
            "fit_iterations": iterations,
        }
        unsigned = {
            "schema_version": "1.0.0",
            "status": "CALIBRATED_VALIDATION_ONLY",
            "positive_class": positive_class,
            "score_direction": score_direction,
            "bias": bias,
            "weight": float(coefficients[0]),
            "provenance": provenance,
        }
        return cls(
            bias=bias,
            weight=float(coefficients[0]),
            positive_class=positive_class,
            score_direction=score_direction,
            calibration_version=_artifact_version(unsigned),
            provenance=provenance,
        )

    def predict_probability(self, raw_scores: np.ndarray) -> np.ndarray:
        values = np.asarray(raw_scores, dtype=np.float64)
        if values.ndim != 1 or not np.isfinite(values).all():
            raise CalibrationError("CALIBRATION_SCORE_INPUT_INVALID")
        higher_is_positive = self.score_direction in {
            "HIGHER_IS_MORE_SIMILAR",
            "HIGHER_IS_MORE_SPOOF",
        }
        oriented = values if higher_is_positive else -values
        probabilities = np.asarray(_sigmoid(self.bias + self.weight * oriented), dtype=np.float64)
        probabilities.setflags(write=False)
        return probabilities

    def to_record(self) -> dict[str, Any]:
        return {
            "schema_version": "1.0.0",
            "status": "CALIBRATED_VALIDATION_ONLY",
            "calibration_version": self.calibration_version,
            "positive_class": self.positive_class,
            "score_direction": self.score_direction,
            "bias": self.bias,
            "weight": self.weight,
            "provenance": dict(self.provenance),
        }

    @classmethod
    def from_record(cls, record: Mapping[str, Any]) -> PlattCalibrator:
        required = {
            "schema_version",
            "status",
            "calibration_version",
            "positive_class",
            "score_direction",
            "bias",
            "weight",
            "provenance",
        }
        if set(record) != required or record.get("status") != "CALIBRATED_VALIDATION_ONLY":
            raise CalibrationError("CALIBRATION_ARTIFACT_INVALID")
        provenance = record.get("provenance")
        if not isinstance(provenance, Mapping) or provenance.get("fit_split") != "VALIDATION":
            raise CalibrationError("CALIBRATION_ARTIFACT_INVALID")
        unsigned = {key: record[key] for key in required - {"calibration_version"}}
        if record.get("calibration_version") != _artifact_version(unsigned):
            raise CalibrationError("CALIBRATION_ARTIFACT_HASH_MISMATCH")
        bias = float(record["bias"])
        weight = float(record["weight"])
        if not math.isfinite(bias) or not math.isfinite(weight):
            raise CalibrationError("CALIBRATION_ARTIFACT_INVALID")
        return cls(
            bias=bias,
            weight=weight,
            positive_class=str(record["positive_class"]),
            score_direction=str(record["score_direction"]),
            calibration_version=str(record["calibration_version"]),
            provenance=dict(provenance),
        )
