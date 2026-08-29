"""Run an in-memory non-human CPU compatibility experiment for the pinned real adapters."""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
from collections.abc import Sequence
from pathlib import Path

import numpy as np
import torch
from pydantic import BaseModel, ConfigDict, Field

from app.audio.config import load_audio_config
from app.models.ecapa import EcapaTdnnAdapter
from app.models.interfaces import ModelInput
from app.models.registry import ModelRegistry


class SmokeModelRecord(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    model_id: str
    model_version: str
    checkpoint_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    score_name: str
    score_direction: str
    input_shape: tuple[int, ...]
    input_dtype: str
    processing_latency_ms: float = Field(ge=0)
    readiness_after_close: str


class IntegrationExperimentRecord(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    schema_version: str = "1.0.0"
    experiment_id: str = Field(pattern=r"^[0-9a-f]{64}$")
    status: str
    claim_status: str
    registry_version: str
    registry_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    preprocessing_version: str
    signal_definition: dict[str, str | int | float]
    runtime: dict[str, str]
    models: tuple[SmokeModelRecord, ...]
    validation_required: tuple[str, ...]


def _input(samples: np.ndarray, preprocessing_version: str, sequence: int) -> ModelInput:
    return ModelInput(
        samples=samples,
        sample_rate_hz=16_000,
        window_id=f"generated-nonhuman-{sequence}",
        sequence=sequence,
        start_ms=sequence * 1000,
        end_ms=sequence * 1000 + 4000,
        preprocessing_version=preprocessing_version,
    )


def _generated_signals(seed: int) -> tuple[np.ndarray, np.ndarray]:
    generator = np.random.default_rng(seed)
    time_axis = np.arange(64_000, dtype=np.float32) / np.float32(16_000)
    reference = (0.02 * np.sin(2 * np.pi * 311.0 * time_axis)).astype(np.float32)
    candidate = (
        0.02 * np.sin(2 * np.pi * 317.0 * time_axis) + generator.normal(0.0, 0.0001, time_axis.size)
    ).astype(np.float32)
    return reference, candidate


def run_cpu_smoke(
    *,
    registry_path: Path | None,
    checkpoint_root: Path,
    seed: int = 26_104,
) -> IntegrationExperimentRecord:
    registry = ModelRegistry.load(registry_path)
    preprocessing = load_audio_config()
    reference_samples, candidate_samples = _generated_signals(seed)
    reference_input = _input(reference_samples, preprocessing.preprocessing_version, 0)
    candidate_input = _input(candidate_samples, preprocessing.preprocessing_version, 1)
    records: list[SmokeModelRecord] = []
    for model_id in ("ecapa-tdnn", "rawnet2", "aasist"):
        adapter = registry.create_adapter(
            model_id,
            checkpoint_root=checkpoint_root,
            device="cpu",
        )
        adapter.load()
        if isinstance(adapter, EcapaTdnnAdapter):
            reference = adapter.enroll([reference_input])
            try:
                result = adapter.infer(
                    candidate_input,
                    timeout_seconds=30.0,
                    reference=reference,
                )
            finally:
                reference.clear()
        else:
            result = adapter.infer(candidate_input, timeout_seconds=30.0)
        adapter.close()
        records.append(
            SmokeModelRecord(
                model_id=result.metadata.model_id,
                model_version=result.metadata.model_version,
                checkpoint_sha256=result.metadata.checkpoint_sha256,
                score_name=result.metadata.score_name,
                score_direction=result.metadata.score_direction.value,
                input_shape=tuple(candidate_samples.shape),
                input_dtype=str(candidate_samples.dtype),
                processing_latency_ms=result.processing_latency_ms,
                readiness_after_close=adapter.readiness.value,
            )
        )
    reference_samples.fill(0.0)
    candidate_samples.fill(0.0)
    signal_definition: dict[str, str | int | float] = {
        "kind": "generated_nonhuman_analytic_signal",
        "sample_rate_hz": 16_000,
        "samples": 64_000,
        "seed": seed,
    }
    identity = {
        "registry_version": registry.document.registry_version,
        "registry_sha256": registry.registry_sha256,
        "preprocessing_version": preprocessing.preprocessing_version,
        "signal_definition": signal_definition,
        "model_versions": [record.model_version for record in records],
        "checkpoint_hashes": [record.checkpoint_sha256 for record in records],
    }
    experiment_id = hashlib.sha256(
        json.dumps(identity, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return IntegrationExperimentRecord(
        experiment_id=experiment_id,
        status="COMPLETED_ENGINEERING_COMPATIBILITY_ONLY",
        claim_status="NO_SCIENTIFIC_PERFORMANCE_CLAIM",
        registry_version=registry.document.registry_version,
        registry_sha256=registry.registry_sha256,
        preprocessing_version=preprocessing.preprocessing_version,
        signal_definition=signal_definition,
        runtime={
            "python": platform.python_version(),
            "torch": torch.__version__,
            "device": "cpu",
            "machine": platform.machine(),
        },
        models=tuple(records),
        validation_required=(
            "Run governed speaker, spoof, OOD, codec, subgroup, calibration, and "
            "target-hardware evaluation in Phase O.",
        ),
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path)
    parser.add_argument(
        "--checkpoint-root",
        type=Path,
        default=Path(__file__).parents[1] / "checkpoints",
    )
    parser.add_argument("--seed", type=int, default=26_104)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--acknowledge-nonhuman-smoke", action="store_true")
    args = parser.parse_args(argv)
    if not args.acknowledge_nonhuman_smoke:
        print("NONHUMAN_SMOKE_ACKNOWLEDGMENT_REQUIRED", file=sys.stderr)
        return 2
    result = run_cpu_smoke(
        registry_path=args.registry,
        checkpoint_root=args.checkpoint_root,
        seed=args.seed,
    )
    rendered = json.dumps(result.model_dump(mode="json"), indent=2, sort_keys=True) + "\n"
    if args.output is None:
        print(rendered, end="")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
