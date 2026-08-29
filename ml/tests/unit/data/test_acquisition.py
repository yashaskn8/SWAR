from __future__ import annotations

from pathlib import Path

import pytest

from scripts.data_governance import GovernanceError, acquire_archive, validate_source_register


def test_acquisition_requires_exact_license_acknowledgment(
    tmp_path: Path, governed_fixture
) -> None:
    source = validate_source_register(governed_fixture["register"])["fixture-source"]
    destination = tmp_path.parent / f"{tmp_path.name}-governed"

    with pytest.raises(GovernanceError, match="ACQUISITION_LICENSE_ACKNOWLEDGMENT_REQUIRED"):
        acquire_archive(
            source,
            governed_fixture["archive"],
            destination,
            None,
            tmp_path / "repository",
        )


def test_acquisition_verifies_copies_and_replays_idempotently(
    tmp_path: Path, governed_fixture
) -> None:
    source = validate_source_register(governed_fixture["register"])["fixture-source"]
    destination = tmp_path.parent / f"{tmp_path.name}-governed"
    repository_root = tmp_path / "repository"

    first = acquire_archive(
        source,
        governed_fixture["archive"],
        destination,
        "SWAR-TEST-ONLY",
        repository_root,
    )
    second = acquire_archive(
        source,
        governed_fixture["archive"],
        destination,
        "SWAR-TEST-ONLY",
        repository_root,
    )

    assert first["status"] == "IMPORTED"
    assert second["status"] == "IDEMPOTENT_REPLAY"
    assert first["archive_sha256"] == second["archive_sha256"]
    assert first["content_extracted"] is False


def test_acquisition_rejects_destination_inside_repository(
    tmp_path: Path, governed_fixture
) -> None:
    source = validate_source_register(governed_fixture["register"])["fixture-source"]
    repository_root = tmp_path / "repository"

    with pytest.raises(GovernanceError, match="ACQUISITION_DESTINATION_INSIDE_REPOSITORY"):
        acquire_archive(
            source,
            governed_fixture["archive"],
            repository_root / "data",
            "SWAR-TEST-ONLY",
            repository_root,
        )


def test_unverified_source_is_never_acquired(tmp_path: Path, governed_fixture) -> None:
    governed_fixture["source"]["license"]["status"] = "VALIDATION_REQUIRED"
    governed_fixture["source"]["adoption"] = {
        "status": "REFERENCE_ONLY_VALIDATION_REQUIRED",
        "permitted_roles": ["SPOOF_EVALUATION"],
        "blockers": ["Terms missing"],
    }
    governed_fixture["source"]["acquisition"] = {"mode": "REFERENCE_ONLY", "artifacts": []}
    source = validate_source_register(governed_fixture["register"])["fixture-source"]

    with pytest.raises(GovernanceError, match="ACQUISITION_LICENSE_UNVERIFIED"):
        acquire_archive(
            source,
            governed_fixture["archive"],
            tmp_path.parent / f"{tmp_path.name}-governed",
            "SWAR-TEST-ONLY",
            tmp_path / "repository",
        )
