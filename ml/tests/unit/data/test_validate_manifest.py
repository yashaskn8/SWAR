from __future__ import annotations

from pathlib import Path

import pytest

from scripts.data_governance import (
    GovernanceError,
    validate_manifest_records,
    validate_source_register,
)


def test_valid_manifest_and_audio_integrity_pass(
    tmp_path: Path, governed_fixture, write_pcm_wav, make_record
) -> None:
    audio_path = tmp_path / "valid.wav"
    write_pcm_wav(audio_path)
    sources = validate_source_register(governed_fixture["register"])

    validated = validate_manifest_records(
        [make_record(audio_path)], sources, data_root=tmp_path, check_files=True
    )

    assert [record["sample_id"] for record in validated] == ["fixture-sample-001"]


def test_missing_audio_is_rejected(
    tmp_path: Path, governed_fixture, write_pcm_wav, make_record
) -> None:
    audio_path = tmp_path / "missing.wav"
    write_pcm_wav(audio_path)
    record = make_record(audio_path)
    audio_path.unlink()
    sources = validate_source_register(governed_fixture["register"])

    with pytest.raises(GovernanceError, match="SAMPLE_FILE_MISSING"):
        validate_manifest_records([record], sources, data_root=tmp_path, check_files=True)


def test_corrupt_audio_is_rejected(
    tmp_path: Path, governed_fixture, write_pcm_wav, make_record
) -> None:
    valid_path = tmp_path / "seed.wav"
    write_pcm_wav(valid_path)
    corrupt_path = tmp_path / "corrupt.wav"
    corrupt_path.write_bytes(b"not-a-wave-file")
    record = make_record(valid_path)
    record["relative_path"] = corrupt_path.name
    record["byte_size"] = corrupt_path.stat().st_size
    record["sha256"] = __import__("hashlib").sha256(corrupt_path.read_bytes()).hexdigest()
    sources = validate_source_register(governed_fixture["register"])

    with pytest.raises(GovernanceError, match="AUDIO_WAV_CORRUPT"):
        validate_manifest_records([record], sources, data_root=tmp_path, check_files=True)


def test_checksum_mismatch_is_rejected(
    tmp_path: Path, governed_fixture, write_pcm_wav, make_record
) -> None:
    audio_path = tmp_path / "checksum.wav"
    write_pcm_wav(audio_path)
    record = make_record(audio_path, sha256="f" * 64)
    sources = validate_source_register(governed_fixture["register"])

    with pytest.raises(GovernanceError, match="SAMPLE_CHECKSUM_CONFLICT"):
        validate_manifest_records([record], sources, data_root=tmp_path, check_files=True)


def test_conflicting_bonafide_label_is_rejected(
    tmp_path: Path, governed_fixture, write_pcm_wav, make_record
) -> None:
    audio_path = tmp_path / "label.wav"
    write_pcm_wav(audio_path)
    record = make_record(audio_path)
    record["labels"]["attack_type"] = "TTS"
    sources = validate_source_register(governed_fixture["register"])

    with pytest.raises(GovernanceError, match="BONAFIDE_LABEL_CONFLICT"):
        validate_manifest_records([record], sources)


def test_reference_only_source_cannot_enter_manifest(
    tmp_path: Path, governed_fixture, write_pcm_wav, make_record
) -> None:
    audio_path = tmp_path / "reference-only.wav"
    write_pcm_wav(audio_path)
    governed_fixture["source"]["adoption"] = {
        "status": "REFERENCE_ONLY_VALIDATION_REQUIRED",
        "permitted_roles": ["IDENTITY_TRAINING"],
        "blockers": ["Fixture blocker"],
    }
    governed_fixture["source"]["acquisition"] = {"mode": "REFERENCE_ONLY", "artifacts": []}
    sources = validate_source_register(governed_fixture["register"])

    with pytest.raises(GovernanceError, match="SAMPLE_SOURCE_NOT_APPROVED"):
        validate_manifest_records([make_record(audio_path)], sources)
