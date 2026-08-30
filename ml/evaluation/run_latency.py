"""Summarize named-hardware latency observations without inventing a target."""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from collections.abc import Sequence
from pathlib import Path
from typing import Any, Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from evaluation.protocol import EvaluationProtocolError, deterministic_record_hash
from evaluation.run_evaluation import _write, blocked_record


class LatencyObservation(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    schema_version: Literal["1.0.0"] = "1.0.0"
    hardware_profile_id: str = Field(min_length=1, max_length=120)
    cpu_model: str = Field(min_length=1, max_length=200)
    gpu_model: str | None = Field(default=None, max_length=200)
    operating_system: str = Field(min_length=1, max_length=160)
    runtime_version: str = Field(min_length=1, max_length=160)
    device: Literal["cpu", "cuda"]
    stage: Literal[
        "speech_accumulation",
        "queue",
        "preprocessing",
        "ecapa_inference",
        "rawnet2_inference",
        "aasist_inference",
        "calibration_fusion",
        "temporal_policy",
        "event_delivery",
        "total_intervention",
    ]
    warm_state: Literal["COLD", "WARM"]
    latency_ms: float = Field(ge=0.0)
    peak_memory_bytes: int | None = Field(default=None, ge=0)
    concurrency: int = Field(ge=1)
    manifest_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    registry_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    preprocessing_version: str


def load_latency_observations(path: Path) -> tuple[LatencyObservation, ...]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise EvaluationProtocolError("LATENCY_OBSERVATIONS_UNREADABLE") from error
    observations: list[LatencyObservation] = []
    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            observations.append(LatencyObservation.model_validate_json(line))
        except Exception as error:
            raise EvaluationProtocolError(
                f"LATENCY_OBSERVATION_INVALID_LINE_{line_number}"
            ) from error
    if not observations:
        raise EvaluationProtocolError("LATENCY_OBSERVATIONS_EMPTY")
    return tuple(observations)


def summarize_latency(observations: Sequence[LatencyObservation]) -> dict[str, Any]:
    identities = {
        (
            item.hardware_profile_id,
            item.cpu_model,
            item.gpu_model,
            item.operating_system,
            item.runtime_version,
            item.device,
            item.concurrency,
            item.manifest_sha256,
            item.registry_sha256,
            item.preprocessing_version,
        )
        for item in observations
    }
    if len(identities) != 1:
        raise EvaluationProtocolError("LATENCY_PROFILE_VERSION_MISMATCH")
    groups: defaultdict[tuple[str, str], list[LatencyObservation]] = defaultdict(list)
    for item in observations:
        groups[(item.stage, item.warm_state)].append(item)
    stages = {stage for stage, _ in groups}
    required = {
        "preprocessing",
        "ecapa_inference",
        "rawnet2_inference",
        "aasist_inference",
    }
    missing = required - stages
    if missing:
        raise EvaluationProtocolError(
            "LATENCY_REQUIRED_STAGES_MISSING:" + ",".join(sorted(missing))
        )
    summaries: dict[str, Any] = {}
    for (stage, warm_state), group in sorted(groups.items()):
        values = np.asarray([item.latency_ms for item in group], dtype=np.float64)
        memory = [item.peak_memory_bytes for item in group if item.peak_memory_bytes is not None]
        summaries[f"{stage}:{warm_state}"] = {
            "sample_count": int(values.size),
            "minimum_ms": float(np.min(values)),
            "p50_ms": float(np.percentile(values, 50)),
            "p95_ms": float(np.percentile(values, 95)),
            "maximum_ms": float(np.max(values)),
            "peak_memory_bytes_max": max(memory) if memory else None,
        }
    identity = next(iter(identities))
    payload = {
        "schema_version": "1.0.0",
        "status": "MEASURED_NAMED_HARDWARE_NOT_A_UNIVERSAL_TARGET",
        "claim_status": "TARGET_ACCEPTANCE_REQUIRES_PROJECT_REVIEW",
        "hardware": {
            "hardware_profile_id": identity[0],
            "cpu_model": identity[1],
            "gpu_model": identity[2],
            "operating_system": identity[3],
            "runtime_version": identity[4],
            "device": identity[5],
            "concurrency": identity[6],
        },
        "manifest_sha256": identity[7],
        "registry_sha256": identity[8],
        "preprocessing_version": identity[9],
        "stages": summaries,
        "end_to_end_present": "total_intervention" in stages,
    }
    return {"run_id": deterministic_record_hash(payload), **payload}


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--observations", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    if args.observations is None:
        _write(blocked_record(("LATENCY_OBSERVATIONS_NOT_PROVIDED",)), args.output)
        return 2
    try:
        result = summarize_latency(load_latency_observations(args.observations))
    except EvaluationProtocolError as error:
        _write(blocked_record((error.code,)), args.output)
        return 2
    _write(result, args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
