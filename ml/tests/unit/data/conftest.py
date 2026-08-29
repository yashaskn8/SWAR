from __future__ import annotations

import hashlib
import json
import wave
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from scripts.data_governance import SCHEMA_VERSION, SPLIT_POLICY_VERSION, digest_file, stable_split


@pytest.fixture
def governed_fixture(tmp_path: Path) -> dict[str, Any]:
    archive = tmp_path / "fixture-source.zip"
    archive.write_bytes(b"governed-fixture-archive")
    source = {
        "source_id": "fixture-source",
        "title": "Generated test fixture source",
        "version": "fixture-v1",
        "sample_kinds": ["BONAFIDE", "TTS", "VC", "REPLAY"],
        "official_sources": [
            {
                "url": "https://example.invalid/fixture",
                "authority": "Unit-test-only local fixture",
                "accessed_at": "2026-08-29",
            }
        ],
        "provenance": {
            "publisher": "SWAR tests",
            "description": "Generated temporary files containing no personal voice.",
            "label_authority": "Test construction",
            "speaker_partition": "Fictional generated groups",
            "languages": ["unknown"],
            "accent_status": "UNKNOWN",
        },
        "license": {
            "status": "VERIFIED_OFFICIAL",
            "identifier": "SWAR-TEST-ONLY",
            "url": "https://example.invalid/fixture-license",
            "permitted_uses": ["Repository unit tests only"],
            "redistribution": "Contains no dataset or human voice.",
            "acknowledgment_required": True,
            "notes": "Generated fixture bytes only.",
        },
        "adoption": {
            "status": "APPROVED_FOR_LOCAL_RESEARCH",
            "permitted_roles": [
                "IDENTITY_TRAINING",
                "IDENTITY_EVALUATION",
                "SPOOF_TRAINING",
                "SPOOF_EVALUATION",
                "ROBUSTNESS_EVALUATION",
                "OOD_CANDIDATE",
            ],
            "blockers": [],
        },
        "acquisition": {
            "mode": "MANUAL_ARCHIVE_IMPORT",
            "artifacts": [
                {
                    "filename": archive.name,
                    "checksum_algorithm": "sha256",
                    "checksum": digest_file(archive),
                }
            ],
        },
    }
    register = {
        "schema_version": SCHEMA_VERSION,
        "reviewed_at": "2026-08-29",
        "sources": [source],
    }
    register_path = tmp_path / "source-register.yaml"
    register_path.write_text(json.dumps(register), encoding="utf-8")
    return {
        "archive": archive,
        "source": source,
        "register": register,
        "register_path": register_path,
    }


@pytest.fixture
def write_pcm_wav() -> Callable[[Path, int, int, int], None]:
    def write(path: Path, sample_rate: int = 16_000, channels: int = 1, frames: int = 800) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(path), "wb") as audio:
            audio.setnchannels(channels)
            audio.setsampwidth(2)
            audio.setframerate(sample_rate)
            audio.writeframes(b"\x00\x00" * channels * frames)

    return write


@pytest.fixture
def make_record() -> Callable[..., dict[str, Any]]:
    def make(
        path: Path,
        *,
        sample_id: str = "fixture-sample-001",
        split_group_id: str = "fixture-group-001",
        speaker_group_id: str = "fixture-speaker-group-001",
        lineage_root_id: str = "fixture-lineage-001",
        near_duplicate_id: str = "fixture-near-001",
        label: str = "BONAFIDE",
        attack_type: str = "NONE",
        generator_family: str | None = None,
        generator_version: str | None = None,
        final_ood: bool = False,
        sha256: str | None = None,
    ) -> dict[str, Any]:
        size = path.stat().st_size
        digest = sha256 or hashlib.sha256(path.read_bytes()).hexdigest()
        with wave.open(str(path), "rb") as audio:
            sample_rate = audio.getframerate()
            channels = audio.getnchannels()
            frames = audio.getnframes()
        return {
            "schema_version": SCHEMA_VERSION,
            "data_version": "fixture-data-v1",
            "sample_id": sample_id,
            "source_id": "fixture-source",
            "source_version": "fixture-v1",
            "usage_role": "SPOOF_TRAINING" if label == "SPOOF" else "IDENTITY_TRAINING",
            "relative_path": path.name,
            "sha256": digest,
            "byte_size": size,
            "audio": {
                "container": "WAV",
                "codec": "PCM_S16LE",
                "sample_rate_hz": sample_rate,
                "channels": channels,
                "frames": frames,
                "duration_seconds": frames / sample_rate,
            },
            "provenance": {
                "provider_sample_id": f"provider-{sample_id}",
                "speaker_id": f"speaker-{speaker_group_id}",
                "speaker_group_id": speaker_group_id,
                "split_group_id": split_group_id,
                "lineage_root_id": lineage_root_id,
                "parent_sample_ids": [f"parent-{sample_id}"] if label == "SPOOF" else [],
                "near_duplicate_id": near_duplicate_id,
                "label_authority": "Generated test fixture",
                "acquisition_receipt_sha256": "a" * 64,
            },
            "labels": {
                "class": label,
                "attack_type": attack_type,
                "generator_family": generator_family,
                "generator_version": generator_version,
                "is_final_ood_family": final_ood,
            },
            "locale": {"status": "UNKNOWN", "language_bcp47": None, "accent": None},
            "channel": {
                "capture_lineage": ["generated-test-silence"],
                "codec_lineage": [],
                "degradation_lineage": [],
                "recipe_version": "test-only-v1",
            },
            "governance": {
                "license_id": "SWAR-TEST-ONLY",
                "consent_status": "PROVIDER_DOCUMENTED_REUSE_TERMS",
                "redistribution": "Generated test fixture only.",
                "contains_biometric_like_data": True,
            },
            "split": {
                "name": stable_split(split_group_id, final_ood),
                "policy_version": SPLIT_POLICY_VERSION,
            },
        }

    return make


def group_for_split(split_name: str) -> str:
    for index in range(10_000):
        candidate = f"fixture-split-{split_name.lower()}-{index}"
        if stable_split(candidate, False) == split_name:
            return candidate
    raise AssertionError(f"No group found for {split_name}")
