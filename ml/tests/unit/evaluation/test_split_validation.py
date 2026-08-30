from __future__ import annotations

import pytest

from evaluation.split_validation import EvaluationSplitError, validate_evaluation_splits


def _record(
    sample_id: str,
    split: str,
    *,
    speaker: str,
    lineage: str,
    digest: str,
    generator: str | None = None,
    final_ood: bool = False,
    used_for_calibration: bool = False,
) -> dict[str, object]:
    return {
        "sample_id": sample_id,
        "sha256": digest,
        "provenance": {
            "speaker_group_id": speaker,
            "lineage_root_id": lineage,
        },
        "labels": {
            "generator_family": generator,
            "is_final_ood_family": final_ood,
        },
        "split": {"name": split},
        "evaluation": {"used_for_calibration": used_for_calibration},
    }


def test_valid_disjoint_evaluation_records_pass() -> None:
    validate_evaluation_splits(
        [
            _record("a", "VALIDATION", speaker="s1", lineage="l1", digest="a" * 64),
            _record(
                "b",
                "FINAL_OOD",
                speaker="s2",
                lineage="l2",
                digest="b" * 64,
                generator="held-out-family",
                final_ood=True,
            ),
        ]
    )


def test_speaker_and_calibration_leakage_are_rejected() -> None:
    with pytest.raises(EvaluationSplitError) as captured:
        validate_evaluation_splits(
            [
                _record(
                    "a",
                    "VALIDATION",
                    speaker="same-speaker",
                    lineage="l1",
                    digest="a" * 64,
                ),
                _record(
                    "b",
                    "TEST",
                    speaker="same-speaker",
                    lineage="l2",
                    digest="b" * 64,
                    used_for_calibration=True,
                ),
            ]
        )

    assert "SPEAKER_LEAKAGE:same-speaker:TEST,VALIDATION" in captured.value.codes
    assert "CALIBRATION_OUTSIDE_VALIDATION:b:TEST" in captured.value.codes


def test_final_ood_family_cannot_appear_in_seen_split() -> None:
    with pytest.raises(EvaluationSplitError, match="FINAL_OOD_GENERATOR_LEAKAGE"):
        validate_evaluation_splits(
            [
                _record(
                    "a",
                    "FINAL_OOD",
                    speaker="s1",
                    lineage="l1",
                    digest="a" * 64,
                    generator="held-out-family",
                    final_ood=True,
                ),
                _record(
                    "b",
                    "TEST",
                    speaker="s2",
                    lineage="l2",
                    digest="b" * 64,
                    generator="held-out-family",
                ),
            ]
        )
