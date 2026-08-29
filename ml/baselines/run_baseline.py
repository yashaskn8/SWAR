"""Run or explicitly block the governed Phase M spoof baseline."""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import numpy as np

from app.audio.config import load_audio_config
from app.audio.quality import EvidenceReadiness
from baselines.spectral_baseline import (
    BaselineDataError,
    LogisticRegressionConfig,
    SpectralFeatureConfig,
    SpectralLogisticBaseline,
    compute_binary_metrics,
    extract_spectral_features,
)
from evaluation.result_schema import BaselineMetrics, BaselineRunResult, RuntimeEnvironment
from scripts.data_governance import (
    SPLIT_POLICY_VERSION,
    GovernanceError,
    digest_file,
    leakage_errors,
    load_json_document,
    load_manifest,
    validate_manifest_records,
    validate_source_register,
)
from training.preprocessing import TrainingPreprocessor


class BaselineRunError(RuntimeError):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _runtime_environment() -> RuntimeEnvironment:
    return RuntimeEnvironment(
        python_version=platform.python_version(),
        numpy_version=np.__version__,
        operating_system=platform.system(),
        operating_system_release=platform.release(),
        machine=platform.machine(),
    )


def _run_id(payload: Mapping[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def blocked_result(
    *,
    source_register: Path,
    blocker_codes: Sequence[str],
    manifest: Path | None = None,
    seed: int = 26_104,
    audio_config: Path | None = None,
) -> BaselineRunResult:
    feature_config = SpectralFeatureConfig()
    optimizer_config = LogisticRegressionConfig(seed=seed)
    preprocessing = load_audio_config(audio_config)
    source_sha = digest_file(source_register)
    manifest_sha = digest_file(manifest) if manifest is not None and manifest.is_file() else None
    record = {
        "status": "BLOCKED_VALIDATION_REQUIRED",
        "source_register_sha256": source_sha,
        "manifest_sha256": manifest_sha,
        "preprocessing_version": preprocessing.preprocessing_version,
        "seed": seed,
        "feature_parameters": feature_config.as_record(),
        "optimizer_parameters": optimizer_config.as_record(),
        "blocker_codes": sorted(set(blocker_codes)),
        "runtime_environment": _runtime_environment().model_dump(),
    }
    return BaselineRunResult(
        run_id=_run_id(record),
        status="BLOCKED_VALIDATION_REQUIRED",
        claim_status="BLOCKED_VALIDATION_REQUIRED",
        data_version=None,
        manifest_sha256=manifest_sha,
        source_register_sha256=source_sha,
        split_policy_version=SPLIT_POLICY_VERSION,
        preprocessing_version=preprocessing.preprocessing_version,
        seed=seed,
        feature_parameters=feature_config.as_record(),
        optimizer_parameters=optimizer_config.as_record(),
        runtime_environment=_runtime_environment(),
        sample_counts={},
        blocker_codes=tuple(sorted(set(blocker_codes))),
    )


def validate_baseline_records(records: list[dict[str, Any]]) -> None:
    errors = leakage_errors(records)
    if errors:
        raise BaselineRunError("BASELINE_DATA_LEAKAGE_DETECTED")
    selected = [
        record
        for record in records
        if record["usage_role"] in {"SPOOF_TRAINING", "SPOOF_EVALUATION"}
        and record["split"]["name"] != "FINAL_OOD"
    ]
    if not selected:
        raise BaselineRunError("BASELINE_SPOOF_ROLE_DATA_UNAVAILABLE")


def _extract_split_features(
    records: list[dict[str, Any]],
    *,
    data_root: Path,
    audio_config: Path | None,
    feature_config: SpectralFeatureConfig,
) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    preprocessor = TrainingPreprocessor(load_audio_config(audio_config))
    features: dict[str, list[np.ndarray]] = {"TRAIN": [], "VALIDATION": [], "TEST": []}
    labels: dict[str, list[int]] = {"TRAIN": [], "VALIDATION": [], "TEST": []}
    for record in records:
        split = str(record["split"]["name"])
        if split not in features or record["usage_role"] not in {
            "SPOOF_TRAINING",
            "SPOOF_EVALUATION",
        }:
            continue
        batch = preprocessor.preprocess_file(data_root / str(record["relative_path"]))
        label = 1 if record["labels"]["class"] == "SPOOF" else 0
        for prepared in batch.windows:
            if prepared.quality.readiness is not EvidenceReadiness.SUFFICIENT:
                continue
            features[split].append(
                extract_spectral_features(prepared.window.samples, feature_config)
            )
            labels[split].append(label)
    result: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for split in features:
        if features[split]:
            result[split] = (
                np.stack(features[split]).astype(np.float64),
                np.asarray(labels[split], dtype=np.int64),
            )
    return result


def run_governed_baseline(
    *,
    manifest: Path,
    source_register: Path,
    data_root: Path,
    audio_config: Path | None = None,
    seed: int = 26_104,
) -> BaselineRunResult:
    if not manifest.is_file():
        raise BaselineRunError("GOVERNED_MANIFEST_NOT_FOUND")
    if not data_root.is_dir():
        raise BaselineRunError("GOVERNED_DATA_ROOT_NOT_FOUND")
    try:
        sources = validate_source_register(load_json_document(source_register))
        records = validate_manifest_records(
            load_manifest(manifest),
            sources,
            data_root=data_root,
            check_files=True,
        )
    except GovernanceError as error:
        raise BaselineRunError("GOVERNED_MANIFEST_VALIDATION_FAILED") from error
    validate_baseline_records(records)
    feature_config = SpectralFeatureConfig()
    optimizer_config = LogisticRegressionConfig(seed=seed)
    split_features = _extract_split_features(
        records,
        data_root=data_root,
        audio_config=audio_config,
        feature_config=feature_config,
    )
    if "TRAIN" not in split_features:
        raise BaselineRunError("BASELINE_TRAIN_WINDOWS_UNAVAILABLE")
    evaluation_splits = [split for split in ("VALIDATION", "TEST") if split in split_features]
    if not evaluation_splits:
        raise BaselineRunError("BASELINE_EVALUATION_WINDOWS_UNAVAILABLE")
    train_features, train_labels = split_features["TRAIN"]
    model = SpectralLogisticBaseline(optimizer_config)
    try:
        model.fit(train_features, train_labels)
    except BaselineDataError as error:
        raise BaselineRunError(error.code) from error

    metrics: dict[str, BaselineMetrics] = {}
    for split in evaluation_splits:
        split_matrix, split_labels = split_features[split]
        try:
            summary = compute_binary_metrics(
                split_labels,
                model.decision_function(split_matrix),
                decision_threshold=optimizer_config.decision_threshold,
            )
        except BaselineDataError as error:
            raise BaselineRunError(error.code) from error
        metrics[split] = BaselineMetrics.model_validate(summary.as_record())

    preprocessing = load_audio_config(audio_config)
    data_version = str(records[0]["data_version"])
    sample_counts = {
        "manifest_records": len(records),
        **{
            f"{split.lower()}_windows": int(values[1].size)
            for split, values in split_features.items()
        },
    }
    provenance = {
        "data_version": data_version,
        "manifest_sha256": digest_file(manifest),
        "source_register_sha256": digest_file(source_register),
        "split_policy_version": SPLIT_POLICY_VERSION,
        "preprocessing_version": preprocessing.preprocessing_version,
        "seed": seed,
        "feature_parameters": feature_config.as_record(),
        "optimizer_parameters": optimizer_config.as_record(),
        "sample_counts": sample_counts,
        "metrics": {key: value.model_dump() for key, value in metrics.items()},
        "runtime_environment": _runtime_environment().model_dump(),
    }
    return BaselineRunResult(
        run_id=_run_id(provenance),
        status="COMPLETED",
        claim_status="MEASURED_GOVERNED_BASELINE_NOT_PROMOTED",
        data_version=data_version,
        manifest_sha256=digest_file(manifest),
        source_register_sha256=digest_file(source_register),
        split_policy_version=SPLIT_POLICY_VERSION,
        preprocessing_version=preprocessing.preprocessing_version,
        seed=seed,
        feature_parameters=feature_config.as_record(),
        optimizer_parameters=optimizer_config.as_record(),
        runtime_environment=_runtime_environment(),
        sample_counts=sample_counts,
        metrics=metrics,
    )


def _write_result(result: BaselineRunResult, output: Path | None) -> None:
    rendered = json.dumps(result.serializable(), indent=2, sort_keys=True) + "\n"
    if output is None:
        print(rendered, end="")
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(rendered, encoding="utf-8")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--data-root", type=Path)
    parser.add_argument(
        "--source-register",
        type=Path,
        default=Path(__file__).parents[1] / "data" / "manifests" / "source-register.yaml",
    )
    parser.add_argument("--audio-config", type=Path)
    parser.add_argument("--seed", type=int, default=26_104)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)

    blockers: list[str] = []
    if args.manifest is None:
        blockers.append("GOVERNED_MANIFEST_NOT_PROVIDED")
    elif not args.manifest.is_file():
        blockers.append("GOVERNED_MANIFEST_NOT_FOUND")
    if args.data_root is None:
        blockers.append("GOVERNED_DATA_ROOT_NOT_PROVIDED")
    elif not args.data_root.is_dir():
        blockers.append("GOVERNED_DATA_ROOT_NOT_FOUND")
    if blockers:
        result = blocked_result(
            source_register=args.source_register,
            blocker_codes=blockers,
            manifest=args.manifest,
            seed=args.seed,
            audio_config=args.audio_config,
        )
        _write_result(result, args.output)
        return 2
    try:
        result = run_governed_baseline(
            manifest=args.manifest,
            source_register=args.source_register,
            data_root=args.data_root,
            audio_config=args.audio_config,
            seed=args.seed,
        )
    except BaselineRunError as error:
        result = blocked_result(
            source_register=args.source_register,
            blocker_codes=[error.code],
            manifest=args.manifest,
            seed=args.seed,
            audio_config=args.audio_config,
        )
        _write_result(result, args.output)
        return 2
    _write_result(result, args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
