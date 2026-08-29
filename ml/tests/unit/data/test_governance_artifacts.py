from __future__ import annotations

import json
from pathlib import Path

from scripts.data_governance import (
    leakage_errors,
    load_json_document,
    load_manifest,
    validate_manifest_records,
    validate_source_register,
)

ML_ROOT = Path(__file__).resolve().parents[3]
REPOSITORY_ROOT = ML_ROOT.parent
SOURCE_REGISTER = ML_ROOT / "data" / "manifests" / "source-register.yaml"
EXAMPLE_MANIFEST = ML_ROOT / "data" / "manifests" / "data-version.example.jsonl"


def test_source_register_is_complete_and_fail_closed() -> None:
    sources = validate_source_register(load_json_document(SOURCE_REGISTER))

    assert {
        "wavefake-1.2.0",
        "asvspoof-2021-release",
        "asvspoof-2019-release",
        "librispeech-slr12",
        "indicvoices-r-2024",
        "indicsynth-2025",
        "indiefake-2025",
    } == set(sources)
    approved = [
        source
        for source in sources.values()
        if source["adoption"]["status"] == "APPROVED_FOR_LOCAL_RESEARCH"
    ]
    assert [source["source_id"] for source in approved] == ["wavefake-1.2.0"]
    assert all(source["license"]["status"] == "VERIFIED_OFFICIAL" for source in approved)
    assert all(source["acquisition"]["artifacts"] for source in approved)


def test_manifest_schema_declares_all_governance_fields() -> None:
    schema = json.loads((ML_ROOT / "data" / "manifests" / "schema.json").read_text())

    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    assert {
        "source_id",
        "sha256",
        "provenance",
        "labels",
        "locale",
        "channel",
        "governance",
        "split",
    }.issubset(schema["required"])


def test_fictional_example_is_semantically_valid_without_claiming_a_file() -> None:
    sources = validate_source_register(load_json_document(SOURCE_REGISTER))
    records = validate_manifest_records(load_manifest(EXAMPLE_MANIFEST), sources)

    assert leakage_errors(records) == []
    assert records[0]["relative_path"].startswith("audio-not-committed/")
    assert "EXAMPLE_ONLY" in records[0]["provenance"]["provider_sample_id"]


def test_repository_contains_no_dataset_audio_or_archive() -> None:
    forbidden_suffixes = {
        ".wav",
        ".flac",
        ".mp3",
        ".m4a",
        ".aac",
        ".ogg",
        ".opus",
        ".pcm",
        ".raw",
        ".zip",
        ".tar",
        ".gz",
        ".parquet",
    }
    files = [
        path
        for path in (ML_ROOT / "data").rglob("*")
        if path.is_file() and path.suffix.lower() in forbidden_suffixes
    ]

    assert files == []


def test_runtime_enrollment_reuse_and_indic_claims_are_explicitly_blocked() -> None:
    governance = (REPOSITORY_ROOT / "docs" / "evaluation" / "data-governance.md").read_text(
        encoding="utf-8"
    )
    indic_plan = (REPOSITORY_ROOT / "docs" / "evaluation" / "indic-coverage-plan.md").read_text(
        encoding="utf-8"
    )

    assert "never automatically reusable" in governance
    assert "Runtime call audio and enrollment samples" in governance
    assert "Claim allowed now" in indic_plan
    assert indic_plan.count("| None. |") >= 5
