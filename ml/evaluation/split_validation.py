"""Phase O split and trial leakage gates layered on Phase K governance."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping
from typing import Any


class EvaluationSplitError(ValueError):
    def __init__(self, codes: Iterable[str]) -> None:
        self.codes = tuple(sorted(set(codes)))
        super().__init__(";".join(self.codes))


def _mapping(record: Mapping[str, Any], key: str) -> Mapping[str, Any]:
    value = record.get(key)
    return value if isinstance(value, Mapping) else {}


def _text(value: object, code: str) -> str:
    if not isinstance(value, str) or not value:
        raise EvaluationSplitError((code,))
    return value


def evaluation_leakage_errors(records: Iterable[Mapping[str, Any]]) -> list[str]:
    """Return leakage errors for validated Phase K manifest-shaped records.

    Optional ``evaluation`` metadata may mark ``used_for_calibration`` and a
    ``trial_role`` of ``ENROLLMENT`` or ``SPEAKER_TEST``. This metadata belongs
    in a separate score/trial artifact; the governed manifest itself is never
    modified to carry experiment outcomes.
    """

    errors: set[str] = set()
    by_source_hash: defaultdict[str, set[str]] = defaultdict(set)
    by_speaker: defaultdict[str, set[str]] = defaultdict(set)
    by_lineage: defaultdict[str, set[str]] = defaultdict(set)
    final_ood_families: set[str] = set()
    generator_splits: defaultdict[str, set[str]] = defaultdict(set)
    enrollment_ids: set[str] = set()
    evaluation_ids: set[str] = set()

    try:
        for record in records:
            provenance = _mapping(record, "provenance")
            labels = _mapping(record, "labels")
            split_record = _mapping(record, "split")
            evaluation = _mapping(record, "evaluation")
            sample_id = _text(record.get("sample_id"), "SAMPLE_ID_MISSING")
            split = _text(split_record.get("name"), f"SPLIT_MISSING:{sample_id}")
            source_hash = _text(record.get("sha256"), f"SOURCE_HASH_MISSING:{sample_id}")
            speaker_key = _text(
                provenance.get("speaker_group_id"),
                f"SPEAKER_GROUP_MISSING:{sample_id}",
            )
            lineage_root = _text(
                provenance.get("lineage_root_id"),
                f"LINEAGE_ROOT_MISSING:{sample_id}",
            )
            generator_family = labels.get("generator_family")
            by_source_hash[source_hash].add(split)
            by_speaker[speaker_key].add(split)
            by_lineage[lineage_root].add(split)
            if isinstance(generator_family, str) and generator_family:
                generator_splits[generator_family].add(split)
                if labels.get("is_final_ood_family") is True:
                    final_ood_families.add(generator_family)
            trial_role = evaluation.get("trial_role")
            if trial_role == "ENROLLMENT":
                enrollment_ids.add(sample_id)
            elif trial_role == "SPEAKER_TEST":
                evaluation_ids.add(sample_id)
            if evaluation.get("used_for_calibration") is True and split != "VALIDATION":
                errors.add(f"CALIBRATION_OUTSIDE_VALIDATION:{sample_id}:{split}")
            if evaluation.get("used_for_calibration") is True and split == "FINAL_OOD":
                errors.add(f"FINAL_OOD_USED_FOR_CALIBRATION:{sample_id}")
    except EvaluationSplitError as error:
        return list(error.codes)

    for digest, splits in by_source_hash.items():
        if len(splits) > 1:
            errors.add(f"SOURCE_LEAKAGE:{digest}:{','.join(sorted(splits))}")
    for speaker, splits in by_speaker.items():
        if len(splits) > 1:
            errors.add(f"SPEAKER_LEAKAGE:{speaker}:{','.join(sorted(splits))}")
    for lineage, splits in by_lineage.items():
        if len(splits) > 1:
            errors.add(f"LINEAGE_LEAKAGE:{lineage}:{','.join(sorted(splits))}")
    for family in final_ood_families:
        unexpected = generator_splits[family] - {"FINAL_OOD"}
        if unexpected:
            errors.add(f"FINAL_OOD_GENERATOR_LEAKAGE:{family}:{','.join(sorted(unexpected))}")
    for sample_id in enrollment_ids & evaluation_ids:
        errors.add(f"ENROLLMENT_TEST_OVERLAP:{sample_id}")
    return sorted(errors)


def validate_evaluation_splits(records: Iterable[Mapping[str, Any]]) -> None:
    errors = evaluation_leakage_errors(records)
    if errors:
        raise EvaluationSplitError(errors)
