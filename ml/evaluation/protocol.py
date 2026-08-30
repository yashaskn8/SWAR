"""Typed, provenance-bound Phase O score and operating-point records."""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class EvaluationProtocolError(ValueError):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class ScoreRecord(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    schema_version: Literal["1.0.0"] = "1.0.0"
    sample_id: str = Field(min_length=1, max_length=128)
    task: Literal["IDENTITY", "SPOOF"]
    split: Literal["VALIDATION", "TEST", "FINAL_OOD"]
    label: Literal["GENUINE", "IMPOSTOR", "BONAFIDE", "SPOOF"]
    status: Literal["SUCCESS", "FAILED", "INSUFFICIENT_EVIDENCE"]
    failure_code: str | None = Field(default=None, max_length=80)
    model_id: str = Field(min_length=1, max_length=80)
    model_version: str = Field(min_length=1, max_length=160)
    checkpoint_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    registry_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    manifest_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    preprocessing_version: str = Field(min_length=1, max_length=160)
    score_name: str = Field(min_length=1, max_length=120)
    score_direction: Literal[
        "HIGHER_IS_MORE_SIMILAR",
        "HIGHER_IS_MORE_BONAFIDE",
        "HIGHER_IS_MORE_SPOOF",
    ]
    raw_score: float | None = None
    calibrated_probability: float | None = Field(default=None, ge=0.0, le=1.0)
    calibration_version: str | None = Field(default=None, max_length=80)
    processing_latency_ms: float | None = Field(default=None, ge=0.0)
    generator_family: str | None = Field(default=None, max_length=160)
    condition: str = Field(default="clean", min_length=1, max_length=160)
    degradation_recipe_version: str | None = Field(default=None, max_length=160)
    slice_dimensions: dict[str, str] = Field(default_factory=dict)
    used_for_calibration: bool = False

    @model_validator(mode="after")
    def validate_semantics(self) -> ScoreRecord:
        if self.task == "IDENTITY" and self.label not in {"GENUINE", "IMPOSTOR"}:
            raise ValueError("identity score requires genuine/impostor label")
        if self.task == "SPOOF" and self.label not in {"BONAFIDE", "SPOOF"}:
            raise ValueError("spoof score requires bona-fide/spoof label")
        if self.status == "SUCCESS":
            if self.raw_score is None or self.processing_latency_ms is None or self.failure_code:
                raise ValueError("successful score requires score/latency and no failure code")
        elif self.raw_score is not None or not self.failure_code:
            raise ValueError("failed/insufficient score requires failure code and no raw score")
        if (self.calibrated_probability is None) != (self.calibration_version is None):
            raise ValueError("calibrated probability requires a calibration version")
        if self.status != "SUCCESS" and self.calibrated_probability is not None:
            raise ValueError("failed/insufficient score cannot contain calibrated probability")
        if self.used_for_calibration and self.split != "VALIDATION":
            raise ValueError("calibration input must come from validation only")
        if self.split == "FINAL_OOD" and self.used_for_calibration:
            raise ValueError("final OOD may never be used for calibration")
        if self.split == "FINAL_OOD" and self.task == "SPOOF" and not self.generator_family:
            raise ValueError("final OOD spoof record requires generator family")
        if self.condition != "clean" and not self.degradation_recipe_version:
            raise ValueError("degraded score requires recipe version")
        if len(self.slice_dimensions) > 12 or any(
            not key or len(key) > 80 or not value or len(value) > 160
            for key, value in self.slice_dimensions.items()
        ):
            raise ValueError("slice dimensions invalid")
        return self


class OperatingPoint(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    model_id: str
    task: Literal["IDENTITY", "SPOOF"]
    positive_class: Literal["GENUINE", "SPOOF"]
    score_direction: Literal[
        "HIGHER_IS_MORE_SIMILAR",
        "HIGHER_IS_MORE_BONAFIDE",
        "HIGHER_IS_MORE_SPOOF",
    ]
    decision_threshold: float
    selected_on_split: Literal["VALIDATION"]
    selection_method: str = Field(min_length=1, max_length=160)
    calibration_version: str | None = Field(default=None, max_length=80)


class CalibrationPackage(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    schema_version: Literal["1.0.0"] = "1.0.0"
    status: Literal[
        "BLOCKED_VALIDATION_REQUIRED",
        "CANDIDATE_MEASURED_NOT_PROMOTED",
        "PROMOTED",
    ]
    calibration_package_version: str | None = None
    manifest_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    registry_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    preprocessing_version: str
    operating_points: tuple[OperatingPoint, ...] = ()
    blocker_codes: tuple[str, ...] = ()
    promotion_decision: Literal["BLOCKED", "NOT_PROMOTED", "PROMOTED"]

    @model_validator(mode="after")
    def validate_state(self) -> CalibrationPackage:
        if self.status == "BLOCKED_VALIDATION_REQUIRED":
            if (
                self.calibration_package_version is not None
                or self.manifest_sha256 is not None
                or self.operating_points
                or not self.blocker_codes
                or self.promotion_decision != "BLOCKED"
            ):
                raise ValueError("blocked package may not expose thresholds or calibration")
        else:
            if (
                self.calibration_package_version is None
                or self.manifest_sha256 is None
                or not self.operating_points
                or self.blocker_codes
            ):
                raise ValueError("measured package requires versions and operating points")
        if self.status == "PROMOTED" and self.promotion_decision != "PROMOTED":
            raise ValueError("promoted package requires promoted decision")
        if self.status != "PROMOTED" and self.promotion_decision == "PROMOTED":
            raise ValueError("only promoted package may carry promoted decision")
        return self


def load_score_records(path: Path) -> tuple[ScoreRecord, ...]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise EvaluationProtocolError("SCORE_RECORDS_UNREADABLE") from error
    records: list[ScoreRecord] = []
    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            records.append(ScoreRecord.model_validate_json(line))
        except Exception as error:
            raise EvaluationProtocolError(f"SCORE_RECORD_INVALID_LINE_{line_number}") from error
    if not records:
        raise EvaluationProtocolError("SCORE_RECORDS_EMPTY")
    return tuple(records)


def load_calibration_package(path: Path) -> CalibrationPackage:
    try:
        package = CalibrationPackage.model_validate_json(path.read_text(encoding="utf-8"))
    except Exception as error:
        raise EvaluationProtocolError("CALIBRATION_PACKAGE_INVALID") from error
    if package.status == "BLOCKED_VALIDATION_REQUIRED":
        raise EvaluationProtocolError("CALIBRATION_PACKAGE_BLOCKED")
    return package


def validate_record_provenance(
    records: Iterable[ScoreRecord],
    package: CalibrationPackage,
) -> tuple[ScoreRecord, ...]:
    materialized = tuple(records)
    if not materialized:
        raise EvaluationProtocolError("SCORE_RECORDS_EMPTY")
    for record in materialized:
        if (
            record.manifest_sha256 != package.manifest_sha256
            or record.registry_sha256 != package.registry_sha256
            or record.preprocessing_version != package.preprocessing_version
        ):
            raise EvaluationProtocolError("EVALUATION_VERSION_MISMATCH")
    return materialized


def validate_score_coverage(
    records: Iterable[ScoreRecord],
    manifest_records: Iterable[Mapping[str, Any]],
    package: CalibrationPackage,
    *,
    split: Literal["TEST", "FINAL_OOD"],
    require_each_condition: bool,
) -> None:
    """Require every eligible governed sample to remain in result/failure counts."""

    materialized = tuple(records)
    manifest = tuple(manifest_records)
    role_by_task = {
        "IDENTITY": {"IDENTITY_EVALUATION"},
        "SPOOF": {"SPOOF_EVALUATION", "ROBUSTNESS_EVALUATION", "OOD_CANDIDATE"},
    }
    for point in package.operating_points:
        expected = {
            str(record["sample_id"])
            for record in manifest
            if isinstance(record.get("split"), Mapping)
            and record["split"].get("name") == split
            and record.get("usage_role") in role_by_task[point.task]
        }
        if not expected:
            raise EvaluationProtocolError(f"MANIFEST_COVERAGE_MISSING:{point.model_id}:{split}")
        selected = [
            record
            for record in materialized
            if record.model_id == point.model_id
            and record.task == point.task
            and record.split == split
        ]
        conditions = (
            {record.condition for record in selected} if require_each_condition else {"clean"}
        )
        if not conditions:
            raise EvaluationProtocolError(f"SCORE_COVERAGE_MISSING:{point.model_id}:{split}")
        for condition in conditions:
            observed = {record.sample_id for record in selected if record.condition == condition}
            if observed != expected:
                raise EvaluationProtocolError(
                    f"SCORE_COVERAGE_MISMATCH:{point.model_id}:{split}:{condition}"
                )


def summarize_failures(records: Iterable[ScoreRecord]) -> dict[str, int]:
    counts = Counter(
        record.failure_code or "UNKNOWN_FAILURE" for record in records if record.status != "SUCCESS"
    )
    return dict(sorted(counts.items()))


def deterministic_record_hash(value: Mapping[str, Any]) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
