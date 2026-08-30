"""Evaluate untouched complete generator families separately from clean/seen results."""

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


def evaluate_ood_records(
    records: Sequence[ScoreRecord],
    package: CalibrationPackage,
) -> dict[str, Any]:
    validated = validate_record_provenance(records, package)
    outcomes: dict[str, Any] = {}
    spoof_points = [point for point in package.operating_points if point.task == "SPOOF"]
    if not spoof_points:
        raise EvaluationProtocolError("SPOOF_OPERATING_POINT_MISSING")
    for point in spoof_points:
        selected = [
            record
            for record in validated
            if record.split == "FINAL_OOD"
            and record.condition == "clean"
            and record.task == "SPOOF"
            and record.model_id == point.model_id
        ]
        if not selected:
            raise EvaluationProtocolError(f"FINAL_OOD_RECORDS_MISSING:{point.model_id}")
        if any(
            record.used_for_calibration
            or not record.generator_family
            or record.score_direction != point.score_direction
            for record in selected
        ):
            raise EvaluationProtocolError("FINAL_OOD_INTEGRITY_INVALID")
        by_family: defaultdict[str, list[ScoreRecord]] = defaultdict(list)
        for record in selected:
            by_family[record.generator_family or "MISSING"].append(record)
        outcomes[point.model_id] = {
            "overall": _metric_record(selected, point),
            "generator_families": {
                family: _metric_record(group, point) for family, group in sorted(by_family.items())
            },
            "generator_family_count": len(by_family),
        }
    payload = {
        "schema_version": "1.0.0",
        "status": "MEASURED_FINAL_OOD_NOT_FOR_TUNING",
        "claim_status": "PROJECT_PERFORMANCE_CLAIMS_REQUIRE_REVIEW",
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
            (args.scores, "FINAL_OOD_SCORE_RECORDS_NOT_PROVIDED"),
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
        spoof_package = package.model_copy(
            update={
                "operating_points": tuple(
                    point for point in package.operating_points if point.task == "SPOOF"
                )
            }
        )
        scores = load_score_records(args.scores)
        validate_score_coverage(
            scores,
            manifest_records,
            spoof_package,
            split="FINAL_OOD",
            require_each_condition=False,
        )
        result = evaluate_ood_records(scores, spoof_package)
    except EvaluationProtocolError as error:
        _write(blocked_record((error.code,)), args.output)
        return 2
    _write(result, args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
