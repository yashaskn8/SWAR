"""Compare clean and versioned degradation conditions without pooling results."""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from evaluation.protocol import (
    CalibrationPackage,
    EvaluationProtocolError,
    ScoreRecord,
    deterministic_record_hash,
    load_calibration_package,
    load_score_records,
    validate_record_provenance,
    validate_score_coverage,
)
from evaluation.run_evaluation import (
    _metric_record,
    _write,
    blocked_record,
    load_governed_evaluation_manifest,
)
from scripts.data_governance import digest_file


def evaluate_robustness_records(
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
            and record.model_id == point.model_id
            and record.task == point.task
        ]
        if not selected:
            raise EvaluationProtocolError(f"ROBUSTNESS_RECORDS_MISSING:{point.model_id}")
        if not any(record.condition == "clean" for record in selected):
            raise EvaluationProtocolError(f"CLEAN_REFERENCE_MISSING:{point.model_id}")
        by_condition: defaultdict[tuple[str, str], list[ScoreRecord]] = defaultdict(list)
        for record in selected:
            recipe_version = record.degradation_recipe_version or "source-clean"
            by_condition[(record.condition, recipe_version)].append(record)
        outcomes[f"{point.task}:{point.model_id}"] = {
            f"{condition}@{recipe}": _metric_record(group, point)
            for (condition, recipe), group in sorted(by_condition.items())
        }
    payload = {
        "schema_version": "1.0.0",
        "status": "MEASURED_ROBUSTNESS_NOT_PROMOTED",
        "claim_status": "CONDITIONS_REPORTED_SEPARATELY_PROJECT_CLAIMS_REQUIRE_REVIEW",
        "calibration_package_version": package.calibration_package_version,
        "manifest_sha256": package.manifest_sha256,
        "registry_sha256": package.registry_sha256,
        "preprocessing_version": package.preprocessing_version,
        "outcomes": outcomes,
    }
    return {"run_id": deterministic_record_hash(payload), **payload}


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
            (args.scores, "ROBUSTNESS_SCORE_RECORDS_NOT_PROVIDED"),
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
            require_each_condition=True,
        )
        result = evaluate_robustness_records(scores, package)
    except EvaluationProtocolError as error:
        _write(blocked_record((error.code,)), args.output)
        return 2
    _write(result, args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
