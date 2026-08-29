from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from baselines.run_baseline import BaselineRunError, blocked_result, main, validate_baseline_records
from evaluation.result_schema import BaselineRunResult


def source_register() -> Path:
    return Path(__file__).parents[3] / "data" / "manifests" / "source-register.yaml"


def test_missing_governed_data_produces_a_deterministic_metric_free_blocked_record(
    capsys: pytest.CaptureFixture[str],
) -> None:
    first = blocked_result(
        source_register=source_register(),
        blocker_codes=["GOVERNED_MANIFEST_NOT_PROVIDED"],
    )
    second = blocked_result(
        source_register=source_register(),
        blocker_codes=["GOVERNED_MANIFEST_NOT_PROVIDED"],
    )

    assert first == second
    assert first.metrics is None
    assert first.data_version is None
    assert first.blocker_codes == ("GOVERNED_MANIFEST_NOT_PROVIDED",)
    assert main([]) == 2
    rendered = json.loads(capsys.readouterr().out)
    assert rendered["status"] == "BLOCKED_VALIDATION_REQUIRED"
    assert "metrics" not in rendered
    assert "precision" not in json.dumps(rendered)


def test_result_schema_rejects_hand_entered_metrics_on_a_blocked_run() -> None:
    record = blocked_result(
        source_register=source_register(),
        blocker_codes=["GOVERNED_DATA_ROOT_NOT_PROVIDED"],
    ).model_dump()
    record["metrics"] = {
        "TEST": {
            "positive_class": "SPOOF",
            "decision_threshold": 0.0,
            "sample_count": 2,
            "positive_count": 1,
            "negative_count": 1,
            "true_positive": 1,
            "false_positive": 0,
            "true_negative": 1,
            "false_negative": 0,
            "precision": 1.0,
            "recall": 1.0,
            "f1": 1.0,
            "eer": 0.0,
            "eer_threshold": 0.0,
        }
    }
    with pytest.raises(ValueError, match="blocked runs cannot contain metrics"):
        BaselineRunResult.model_validate(record)


def test_baseline_gate_rejects_phase_k_duplicate_leakage() -> None:
    def record(sample_id: str, split: str) -> dict[str, Any]:
        return {
            "sample_id": sample_id,
            "sha256": "a" * 64,
            "usage_role": "SPOOF_TRAINING",
            "provenance": {
                "near_duplicate_id": f"near-{sample_id}",
                "speaker_group_id": f"speaker-{sample_id}",
                "lineage_root_id": f"lineage-{sample_id}",
                "parent_sample_ids": ["fictional-parent"],
            },
            "labels": {
                "class": "SPOOF",
                "attack_type": "TTS",
                "generator_family": "fictional-generator",
                "is_final_ood_family": False,
            },
            "split": {"name": split},
        }

    with pytest.raises(BaselineRunError, match="BASELINE_DATA_LEAKAGE_DETECTED"):
        validate_baseline_records([record("fixture-a", "TRAIN"), record("fixture-b", "TEST")])
