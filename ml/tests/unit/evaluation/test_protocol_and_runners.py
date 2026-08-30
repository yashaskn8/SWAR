from __future__ import annotations

from pathlib import Path

import pytest

from evaluation.protocol import (
    CalibrationPackage,
    EvaluationProtocolError,
    OperatingPoint,
    ScoreRecord,
    validate_score_coverage,
)
from evaluation.run_codec_robustness import evaluate_robustness_records
from evaluation.run_evaluation import evaluate_score_records, main
from evaluation.run_ood import evaluate_ood_records

HASH_A = "a" * 64
HASH_B = "b" * 64
HASH_C = "c" * 64


def _package() -> CalibrationPackage:
    return CalibrationPackage(
        status="CANDIDATE_MEASURED_NOT_PROMOTED",
        calibration_package_version="test-only-package",
        manifest_sha256=HASH_A,
        registry_sha256=HASH_B,
        preprocessing_version="phase-l-test",
        operating_points=(
            OperatingPoint(
                model_id="ecapa",
                task="IDENTITY",
                positive_class="GENUINE",
                score_direction="HIGHER_IS_MORE_SIMILAR",
                decision_threshold=0.5,
                selected_on_split="VALIDATION",
                selection_method="generated-test-only",
            ),
            OperatingPoint(
                model_id="rawnet2",
                task="SPOOF",
                positive_class="SPOOF",
                score_direction="HIGHER_IS_MORE_BONAFIDE",
                decision_threshold=0.0,
                selected_on_split="VALIDATION",
                selection_method="generated-test-only",
            ),
        ),
        promotion_decision="NOT_PROMOTED",
    )


def _score(
    sample_id: str,
    *,
    task: str,
    label: str,
    model_id: str,
    raw_score: float,
    split: str = "TEST",
    condition: str = "clean",
    generator_family: str | None = None,
) -> ScoreRecord:
    return ScoreRecord(
        sample_id=sample_id,
        task=task,
        split=split,
        label=label,
        status="SUCCESS",
        model_id=model_id,
        model_version="generated-test-only",
        checkpoint_sha256=HASH_C,
        registry_sha256=HASH_B,
        manifest_sha256=HASH_A,
        preprocessing_version="phase-l-test",
        score_name="cosine_similarity" if task == "IDENTITY" else "bonafide_logit",
        score_direction=(
            "HIGHER_IS_MORE_SIMILAR" if task == "IDENTITY" else "HIGHER_IS_MORE_BONAFIDE"
        ),
        raw_score=raw_score,
        processing_latency_ms=1.0,
        generator_family=generator_family,
        condition=condition,
        degradation_recipe_version="test-recipe-v1" if condition != "clean" else None,
        slice_dimensions={"language": "generated-test"},
    )


def test_blocked_repository_calibration_has_no_thresholds() -> None:
    path = Path(__file__).parents[3] / "config" / "calibration.json"
    package = CalibrationPackage.model_validate_json(path.read_text(encoding="utf-8"))

    assert package.status == "BLOCKED_VALIDATION_REQUIRED"
    assert package.operating_points == ()
    assert package.manifest_sha256 is None
    assert package.promotion_decision == "BLOCKED"


def test_clean_evaluation_is_deterministic_and_keeps_tasks_separate() -> None:
    records = (
        _score("id-g1", task="IDENTITY", label="GENUINE", model_id="ecapa", raw_score=0.9),
        _score("id-g2", task="IDENTITY", label="GENUINE", model_id="ecapa", raw_score=0.8),
        _score("id-i1", task="IDENTITY", label="IMPOSTOR", model_id="ecapa", raw_score=0.2),
        _score("id-i2", task="IDENTITY", label="IMPOSTOR", model_id="ecapa", raw_score=0.1),
        _score("sp-s1", task="SPOOF", label="SPOOF", model_id="rawnet2", raw_score=-2.0),
        _score("sp-s2", task="SPOOF", label="SPOOF", model_id="rawnet2", raw_score=-1.0),
        _score("sp-b1", task="SPOOF", label="BONAFIDE", model_id="rawnet2", raw_score=2.0),
        _score("sp-b2", task="SPOOF", label="BONAFIDE", model_id="rawnet2", raw_score=1.0),
    )

    first = evaluate_score_records(records, _package())
    second = evaluate_score_records(records, _package())

    assert first == second
    assert (
        first["outcomes"]["IDENTITY:ecapa"]["overall"]["metrics"]["false_acceptance_rate"]["value"]
        == 0.0
    )
    assert first["outcomes"]["SPOOF:rawnet2"]["overall"]["metrics"]["f1"] == 1.0


def test_ood_and_robustness_report_separate_groups() -> None:
    ood = (
        _score(
            "ood-s",
            task="SPOOF",
            label="SPOOF",
            model_id="rawnet2",
            raw_score=-1.0,
            split="FINAL_OOD",
            generator_family="held-out-family",
        ),
        _score(
            "ood-b",
            task="SPOOF",
            label="BONAFIDE",
            model_id="rawnet2",
            raw_score=1.0,
            split="FINAL_OOD",
            generator_family="held-out-family",
        ),
    )
    robustness = tuple(
        _score(
            label.lower(),
            task="SPOOF",
            label=label,
            model_id="rawnet2",
            raw_score=-1.0 if label == "SPOOF" else 1.0,
            condition=condition,
        )
        for condition in ("clean", "narrowband")
        for label in ("SPOOF", "BONAFIDE")
    )

    package = _package()
    spoof_package = package.model_copy(
        update={
            "operating_points": tuple(
                point for point in package.operating_points if point.task == "SPOOF"
            )
        }
    )
    ood_result = evaluate_ood_records(ood, spoof_package)
    robustness_result = evaluate_robustness_records(robustness, spoof_package)

    assert ood_result["outcomes"]["rawnet2"]["generator_family_count"] == 1
    assert set(robustness_result["outcomes"]["SPOOF:rawnet2"]) == {
        "clean@source-clean",
        "narrowband@test-recipe-v1",
    }


def test_manifest_coverage_keeps_failed_or_successful_samples_in_denominator() -> None:
    package = _package()
    spoof_package = package.model_copy(
        update={
            "operating_points": tuple(
                point for point in package.operating_points if point.task == "SPOOF"
            )
        }
    )
    records = (
        _score("spoof", task="SPOOF", label="SPOOF", model_id="rawnet2", raw_score=-1.0),
        _score(
            "bonafide",
            task="SPOOF",
            label="BONAFIDE",
            model_id="rawnet2",
            raw_score=1.0,
        ),
    )
    manifest = [
        {"sample_id": sample_id, "usage_role": "SPOOF_EVALUATION", "split": {"name": "TEST"}}
        for sample_id in ("spoof", "bonafide")
    ]

    validate_score_coverage(
        records,
        manifest,
        spoof_package,
        split="TEST",
        require_each_condition=False,
    )
    with pytest.raises(EvaluationProtocolError, match="SCORE_COVERAGE_MISMATCH"):
        validate_score_coverage(
            records[:1],
            manifest,
            spoof_package,
            split="TEST",
            require_each_condition=False,
        )


def test_runner_without_governed_inputs_exits_blocked(capsys: pytest.CaptureFixture[str]) -> None:
    assert main([]) == 2
    output = capsys.readouterr().out
    assert "BLOCKED_VALIDATION_REQUIRED" in output
    assert '"metrics"' not in output
    assert "GOVERNED_MANIFEST_NOT_PROVIDED" in output
