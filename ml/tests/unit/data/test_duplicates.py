from __future__ import annotations

from pathlib import Path

from scripts.data_governance import (
    leakage_errors,
    validate_manifest_records,
    validate_source_register,
)
from tests.unit.data.conftest import group_for_split


def test_exact_and_near_duplicates_are_rejected(
    tmp_path: Path, governed_fixture, write_pcm_wav, make_record
) -> None:
    first_path = tmp_path / "first.wav"
    second_path = tmp_path / "second.wav"
    write_pcm_wav(first_path, frames=800)
    write_pcm_wav(second_path, frames=801)
    first = make_record(first_path)
    second = make_record(
        second_path,
        sample_id="fixture-sample-002",
        split_group_id="fixture-group-002",
        speaker_group_id="fixture-speaker-group-002",
        lineage_root_id="fixture-lineage-002",
        near_duplicate_id=first["provenance"]["near_duplicate_id"],
        sha256=first["sha256"],
    )
    sources = validate_source_register(governed_fixture["register"])
    records = validate_manifest_records([first, second], sources)

    errors = leakage_errors(records)

    assert any(error.startswith("EXACT_DUPLICATE:") for error in errors)
    assert any(error.startswith("NEAR_DUPLICATE:") for error in errors)


def test_speaker_and_lineage_split_leakage_are_rejected(
    tmp_path: Path, governed_fixture, write_pcm_wav, make_record
) -> None:
    first_path = tmp_path / "train.wav"
    second_path = tmp_path / "test.wav"
    write_pcm_wav(first_path, frames=800)
    write_pcm_wav(second_path, frames=801)
    shared_speaker = "shared-speaker-group"
    shared_lineage = "shared-lineage-root"
    first = make_record(
        first_path,
        split_group_id=group_for_split("TRAIN"),
        speaker_group_id=shared_speaker,
        lineage_root_id=shared_lineage,
    )
    second = make_record(
        second_path,
        sample_id="fixture-sample-002",
        split_group_id=group_for_split("TEST"),
        speaker_group_id=shared_speaker,
        lineage_root_id=shared_lineage,
        near_duplicate_id="fixture-near-002",
    )
    sources = validate_source_register(governed_fixture["register"])
    records = validate_manifest_records([first, second], sources)

    errors = leakage_errors(records)

    assert any(error.startswith("SPEAKER_GROUP_LEAKAGE:") for error in errors)
    assert any(error.startswith("LINEAGE_ROOT_LEAKAGE:") for error in errors)


def test_final_ood_generator_family_is_absent_from_train_and_validation(
    tmp_path: Path, governed_fixture, write_pcm_wav, make_record
) -> None:
    known_path = tmp_path / "known.wav"
    ood_path = tmp_path / "ood.wav"
    write_pcm_wav(known_path, frames=800)
    write_pcm_wav(ood_path, frames=801)
    known = make_record(
        known_path,
        split_group_id=group_for_split("TRAIN"),
        label="SPOOF",
        attack_type="TTS",
        generator_family="generator-family-x",
        generator_version="known-v1",
    )
    ood = make_record(
        ood_path,
        sample_id="fixture-sample-002",
        split_group_id="final-ood-group",
        speaker_group_id="fixture-speaker-group-002",
        lineage_root_id="fixture-lineage-002",
        near_duplicate_id="fixture-near-002",
        label="SPOOF",
        attack_type="VC",
        generator_family="generator-family-x",
        generator_version="held-out-v2",
        final_ood=True,
    )
    sources = validate_source_register(governed_fixture["register"])
    records = validate_manifest_records([known, ood], sources)

    errors = leakage_errors(records)

    assert errors == ["FINAL_OOD_GENERATOR_LEAKAGE:generator-family-x:TRAIN"]
