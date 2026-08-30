"""Run provenance-bound Phase O clean/seen evaluation or fail closed."""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np

from evaluation.metrics.calibration import compute_calibration_metrics
from evaluation.metrics.common import MetricInputError
from evaluation.metrics.speaker_verification import compute_speaker_metrics
from evaluation.metrics.spoof_detection import compute_spoof_metrics
from evaluation.protocol import (
    CalibrationPackage,
    EvaluationProtocolError,
    OperatingPoint,
    ScoreRecord,
    deterministic_record_hash,
    load_calibration_package,
    load_score_records,
    summarize_failures,
    validate_record_provenance,
    validate_score_coverage,
)
from evaluation.split_validation import EvaluationSplitError, validate_evaluation_splits
from scripts.data_governance import (
    GovernanceError,
    digest_file,
    leakage_errors,
    load_json_document,
    load_manifest,
    validate_manifest_records,
    validate_source_register,
)


def _labels(records: Sequence[ScoreRecord], task: str) -> np.ndarray:
    if task == "IDENTITY":
        return np.asarray([1 if record.label == "GENUINE" else 0 for record in records])
    return np.asarray([1 if record.label == "SPOOF" else 0 for record in records])


def _metric_record(records: Sequence[ScoreRecord], point: OperatingPoint) -> dict[str, Any]:
    successful = [record for record in records if record.status == "SUCCESS"]
    result: dict[str, Any] = {
        "status": "MEASURED" if successful else "INSUFFICIENT_SLICE_EVIDENCE",
        "record_count": len(records),
        "successful_count": len(successful),
        "failure_counts": summarize_failures(records),
    }
    if not successful:
        return result
    labels = _labels(successful, point.task)
    if set(labels.tolist()) != {0, 1}:
        result["status"] = "INSUFFICIENT_SLICE_EVIDENCE"
        result["class_counts"] = {
            "positive": int(np.count_nonzero(labels == 1)),
            "negative": int(np.count_nonzero(labels == 0)),
        }
        return result
    scores = np.asarray([record.raw_score for record in successful], dtype=np.float64)
    if point.task == "IDENTITY":
        summary = compute_speaker_metrics(
            labels,
            scores,
            decision_threshold=point.decision_threshold,
            higher_is_more_similar=point.score_direction == "HIGHER_IS_MORE_SIMILAR",
        )
    else:
        summary = compute_spoof_metrics(
            labels,
            scores,
            decision_threshold=point.decision_threshold,
            higher_is_more_spoof=point.score_direction == "HIGHER_IS_MORE_SPOOF",
        )
    result["metrics"] = summary.as_record()
    calibrated = [record for record in successful if record.calibrated_probability is not None]
    if calibrated:
        versions = {record.calibration_version for record in calibrated}
        if len(calibrated) != len(successful) or len(versions) != 1:
            raise EvaluationProtocolError("CALIBRATION_COVERAGE_OR_VERSION_MISMATCH")
        calibration = compute_calibration_metrics(
            labels,
            np.asarray(
                [record.calibrated_probability for record in calibrated],
                dtype=np.float64,
            ),
        )
        result["calibration"] = {
            **calibration.__dict__,
            "calibration_version": next(iter(versions)),
        }
    return result


def evaluate_score_records(
    records: Sequence[ScoreRecord],
    package: CalibrationPackage,
) -> dict[str, Any]:
    validated = validate_record_provenance(records, package)
    outcomes: dict[str, Any] = {}
    for point in package.operating_points:
        selected = [
            record
            for record in validated
            if record.split == "TEST"
            and record.condition == "clean"
            and record.model_id == point.model_id
            and record.task == point.task
        ]
        if not selected:
            raise EvaluationProtocolError(f"TEST_RECORDS_MISSING:{point.model_id}")
        if any(record.score_direction != point.score_direction for record in selected):
            raise EvaluationProtocolError(f"SCORE_DIRECTION_MISMATCH:{point.model_id}")
        model_outcome: dict[str, Any] = {"overall": _metric_record(selected, point)}
        slice_groups: defaultdict[tuple[str, str], list[ScoreRecord]] = defaultdict(list)
        for record in selected:
            for dimension, value in record.slice_dimensions.items():
                slice_groups[(dimension, value)].append(record)
        model_outcome["slices"] = {
            f"{dimension}:{value}": _metric_record(group, point)
            for (dimension, value), group in sorted(slice_groups.items())
        }
        model_outcome["missing_slice_metadata_count"] = sum(
            1 for record in selected if not record.slice_dimensions
        )
        outcomes[f"{point.task}:{point.model_id}"] = model_outcome
    payload = {
        "schema_version": "1.0.0",
        "status": "MEASURED_GOVERNED_NOT_PROMOTED",
        "claim_status": "PROJECT_PERFORMANCE_CLAIMS_REQUIRE_REVIEW",
        "calibration_package_version": package.calibration_package_version,
        "manifest_sha256": package.manifest_sha256,
        "registry_sha256": package.registry_sha256,
        "preprocessing_version": package.preprocessing_version,
        "outcomes": outcomes,
    }
    return {"run_id": deterministic_record_hash(payload), **payload}


def blocked_record(codes: Sequence[str]) -> dict[str, Any]:
    payload = {
        "schema_version": "1.0.0",
        "status": "BLOCKED_VALIDATION_REQUIRED",
        "claim_status": "NO_METRIC_THRESHOLD_CALIBRATION_OR_PROMOTION_CLAIM",
        "blocker_codes": sorted(set(codes)),
    }
    return {"run_id": deterministic_record_hash(payload), **payload}


def load_governed_evaluation_manifest(
    manifest: Path,
    data_root: Path,
    source_register: Path,
) -> list[dict[str, Any]]:
    sources = validate_source_register(load_json_document(source_register))
    manifest_records = validate_manifest_records(
        load_manifest(manifest),
        sources,
        data_root=data_root,
        check_files=True,
    )
    leakage = leakage_errors(manifest_records)
    if leakage:
        raise EvaluationProtocolError("PHASE_K_LEAKAGE_GATE_FAILED")
    validate_evaluation_splits(manifest_records)
    return manifest_records


def _write(record: dict[str, Any], output: Path | None) -> None:
    rendered = json.dumps(record, indent=2, sort_keys=True) + "\n"
    if output is None:
        print(rendered, end="")
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered, encoding="utf-8")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--data-root", type=Path)
    parser.add_argument("--scores", type=Path)
    parser.add_argument("--calibration-package", type=Path)
    parser.add_argument(
        "--source-register",
        type=Path,
        default=Path(__file__).parents[1] / "data" / "manifests" / "source-register.yaml",
    )
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    missing = [
        code
        for value, code in (
            (args.manifest, "GOVERNED_MANIFEST_NOT_PROVIDED"),
            (args.data_root, "GOVERNED_DATA_ROOT_NOT_PROVIDED"),
            (args.scores, "MEASURED_SCORE_RECORDS_NOT_PROVIDED"),
            (args.calibration_package, "CALIBRATION_PACKAGE_NOT_PROVIDED"),
        )
        if value is None
    ]
    if missing:
        _write(blocked_record(missing), args.output)
        return 2
    try:
        manifest_records = load_governed_evaluation_manifest(
            args.manifest,
            args.data_root,
            args.source_register,
        )
        package = load_calibration_package(args.calibration_package)
        if digest_file(args.manifest) != package.manifest_sha256:
            raise EvaluationProtocolError("MANIFEST_HASH_MISMATCH")
        scores = load_score_records(args.scores)
        validate_score_coverage(
            scores,
            manifest_records,
            package,
            split="TEST",
            require_each_condition=False,
        )
        result = evaluate_score_records(scores, package)
    except (
        GovernanceError,
        EvaluationSplitError,
        EvaluationProtocolError,
        MetricInputError,
    ) as error:
        code = getattr(error, "code", type(error).__name__.upper())
        _write(blocked_record((str(code),)), args.output)
        return 2
    _write(result, args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
