"""Phase K data-governance primitives shared by the command-line checks."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import wave
from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any, Final

SCHEMA_VERSION: Final = "1.0.0"
SPLIT_POLICY_VERSION: Final = "swar-speaker-generator-split-v1"
SPLITS: Final = frozenset({"TRAIN", "VALIDATION", "TEST", "FINAL_OOD"})
LABELS: Final = frozenset({"BONAFIDE", "SPOOF"})
ATTACK_TYPES: Final = frozenset({"NONE", "TTS", "VC", "REPLAY", "MIXED", "UNKNOWN"})
USAGE_ROLES: Final = frozenset(
    {
        "IDENTITY_TRAINING",
        "IDENTITY_EVALUATION",
        "SPOOF_TRAINING",
        "SPOOF_EVALUATION",
        "ROBUSTNESS_EVALUATION",
        "OOD_CANDIDATE",
    }
)
HEX_64 = re.compile(r"^[0-9a-f]{64}$")
HEX_BY_ALGORITHM: Final = {
    "md5": re.compile(r"^[0-9a-f]{32}$"),
    "sha256": HEX_64,
}
STABLE_ID = re.compile(r"^[a-z0-9][a-z0-9._:-]{2,127}$")


class GovernanceError(ValueError):
    """A stable, user-correctable governance validation failure."""


@dataclass(frozen=True)
class AudioInspection:
    """Header-level audio facts that do not require Phase L preprocessing."""

    container: str
    sample_rate_hz: int
    channels: int
    frames: int

    @property
    def duration_seconds(self) -> float:
        return self.frames / self.sample_rate_hz


def load_json_document(path: Path) -> Any:
    """Load JSON, including the repository's JSON-compatible YAML register."""

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise GovernanceError("DOCUMENT_NOT_FOUND") from error
    except json.JSONDecodeError as error:
        raise GovernanceError(f"DOCUMENT_INVALID_JSON_LINE_{error.lineno}") from error


def load_manifest(path: Path) -> list[dict[str, Any]]:
    """Load a non-empty JSONL manifest with precise line failures."""

    records: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError as error:
        raise GovernanceError("MANIFEST_NOT_FOUND") from error

    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as error:
            raise GovernanceError(f"MANIFEST_INVALID_JSON_LINE_{line_number}") from error
        if not isinstance(value, dict):
            raise GovernanceError(f"MANIFEST_RECORD_NOT_OBJECT_LINE_{line_number}")
        records.append(value)

    if not records:
        raise GovernanceError("MANIFEST_EMPTY")
    return records


def digest_file(path: Path, algorithm: str = "sha256") -> str:
    """Hash a file in bounded chunks."""

    if algorithm not in HEX_BY_ALGORITHM:
        raise GovernanceError("CHECKSUM_ALGORITHM_UNSUPPORTED")
    digest = hashlib.new(algorithm)
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stable_split(split_group_id: str, final_ood: bool) -> str:
    """Return the frozen group-level split without inspecting sample content."""

    if final_ood:
        return "FINAL_OOD"
    material = f"{SPLIT_POLICY_VERSION}\0{split_group_id}".encode()
    bucket = int.from_bytes(hashlib.sha256(material).digest()[:8], "big") % 1000
    if bucket < 800:
        return "TRAIN"
    if bucket < 900:
        return "VALIDATION"
    return "TEST"


def _require_mapping(value: Any, code: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise GovernanceError(code)
    return value


def _require_list(value: Any, code: str) -> list[Any]:
    if not isinstance(value, list) or not value:
        raise GovernanceError(code)
    return value


def _require_text(value: Any, code: str, *, stable_id: bool = False) -> str:
    if not isinstance(value, str) or not value.strip():
        raise GovernanceError(code)
    if stable_id and not STABLE_ID.fullmatch(value):
        raise GovernanceError(code)
    return value


def _reject_unknown_keys(value: Mapping[str, Any], allowed: set[str], code: str) -> None:
    unknown = set(value) - allowed
    if unknown:
        raise GovernanceError(f"{code}:{','.join(sorted(unknown))}")


def validate_source_register(document: Any) -> dict[str, dict[str, Any]]:
    """Validate source authority, licensing, adoption, and acquisition metadata."""

    root = _require_mapping(document, "SOURCE_REGISTER_NOT_OBJECT")
    if root.get("schema_version") != SCHEMA_VERSION:
        raise GovernanceError("SOURCE_REGISTER_SCHEMA_VERSION_UNSUPPORTED")
    _require_text(root.get("reviewed_at"), "SOURCE_REGISTER_REVIEW_DATE_MISSING")
    sources = _require_list(root.get("sources"), "SOURCE_REGISTER_SOURCES_MISSING")
    by_id: dict[str, dict[str, Any]] = {}
    represented_kinds: set[str] = set()

    for item in sources:
        source = dict(_require_mapping(item, "SOURCE_ENTRY_NOT_OBJECT"))
        source_id = _require_text(source.get("source_id"), "SOURCE_ID_INVALID", stable_id=True)
        if source_id in by_id:
            raise GovernanceError(f"SOURCE_ID_DUPLICATE:{source_id}")
        _require_text(source.get("title"), f"SOURCE_TITLE_MISSING:{source_id}")
        _require_text(source.get("version"), f"SOURCE_VERSION_MISSING:{source_id}")

        kinds = set(_require_list(source.get("sample_kinds"), f"SOURCE_KINDS_MISSING:{source_id}"))
        if not kinds.issubset({"BONAFIDE", "TTS", "VC", "REPLAY"}):
            raise GovernanceError(f"SOURCE_KIND_INVALID:{source_id}")
        represented_kinds.update(kinds)

        official_sources = _require_list(
            source.get("official_sources"), f"SOURCE_AUTHORITY_MISSING:{source_id}"
        )
        for authority in official_sources:
            authority_map = _require_mapping(authority, f"SOURCE_AUTHORITY_INVALID:{source_id}")
            _require_text(authority_map.get("url"), f"SOURCE_URL_MISSING:{source_id}")
            _require_text(authority_map.get("authority"), f"SOURCE_AUTHORITY_MISSING:{source_id}")
            _require_text(
                authority_map.get("accessed_at"), f"SOURCE_ACCESS_DATE_MISSING:{source_id}"
            )

        provenance = _require_mapping(
            source.get("provenance"), f"SOURCE_PROVENANCE_MISSING:{source_id}"
        )
        for field in ("publisher", "description", "label_authority", "speaker_partition"):
            _require_text(provenance.get(field), f"SOURCE_PROVENANCE_{field.upper()}:{source_id}")
        _require_list(provenance.get("languages"), f"SOURCE_LANGUAGES_MISSING:{source_id}")
        _require_text(provenance.get("accent_status"), f"SOURCE_ACCENT_STATUS_MISSING:{source_id}")

        license_info = _require_mapping(
            source.get("license"), f"SOURCE_LICENSE_MISSING:{source_id}"
        )
        license_status = _require_text(
            license_info.get("status"), f"SOURCE_LICENSE_STATUS_MISSING:{source_id}"
        )
        if license_status not in {"VERIFIED_OFFICIAL", "VALIDATION_REQUIRED"}:
            raise GovernanceError(f"SOURCE_LICENSE_STATUS_INVALID:{source_id}")
        _require_text(license_info.get("identifier"), f"SOURCE_LICENSE_ID_MISSING:{source_id}")
        _require_text(license_info.get("url"), f"SOURCE_LICENSE_URL_MISSING:{source_id}")
        _require_list(license_info.get("permitted_uses"), f"SOURCE_LICENSE_USE_MISSING:{source_id}")
        _require_text(
            license_info.get("redistribution"), f"SOURCE_REDISTRIBUTION_MISSING:{source_id}"
        )
        if not isinstance(license_info.get("acknowledgment_required"), bool):
            raise GovernanceError(f"SOURCE_ACKNOWLEDGMENT_INVALID:{source_id}")

        adoption = _require_mapping(source.get("adoption"), f"SOURCE_ADOPTION_MISSING:{source_id}")
        adoption_status = _require_text(
            adoption.get("status"), f"SOURCE_ADOPTION_STATUS_MISSING:{source_id}"
        )
        if adoption_status not in {
            "APPROVED_FOR_LOCAL_RESEARCH",
            "REFERENCE_ONLY_VALIDATION_REQUIRED",
            "REJECTED",
        }:
            raise GovernanceError(f"SOURCE_ADOPTION_STATUS_INVALID:{source_id}")
        permitted_roles = _require_list(
            adoption.get("permitted_roles"), f"SOURCE_ROLES_MISSING:{source_id}"
        )
        if not all(role in USAGE_ROLES for role in permitted_roles):
            raise GovernanceError(f"SOURCE_ROLE_INVALID:{source_id}")
        blockers = adoption.get("blockers")
        if not isinstance(blockers, list):
            raise GovernanceError(f"SOURCE_BLOCKERS_INVALID:{source_id}")
        if (
            adoption_status == "APPROVED_FOR_LOCAL_RESEARCH"
            and license_status != "VERIFIED_OFFICIAL"
        ):
            raise GovernanceError(f"SOURCE_UNVERIFIED_LICENSE_APPROVED:{source_id}")
        if adoption_status == "REFERENCE_ONLY_VALIDATION_REQUIRED" and not blockers:
            raise GovernanceError(f"SOURCE_VALIDATION_BLOCKER_MISSING:{source_id}")

        acquisition = _require_mapping(
            source.get("acquisition"), f"SOURCE_ACQUISITION_MISSING:{source_id}"
        )
        mode = _require_text(
            acquisition.get("mode"), f"SOURCE_ACQUISITION_MODE_MISSING:{source_id}"
        )
        if mode not in {"MANUAL_ARCHIVE_IMPORT", "REFERENCE_ONLY"}:
            raise GovernanceError(f"SOURCE_ACQUISITION_MODE_INVALID:{source_id}")
        artifacts = acquisition.get("artifacts")
        if not isinstance(artifacts, list):
            raise GovernanceError(f"SOURCE_ARTIFACTS_INVALID:{source_id}")
        for artifact in artifacts:
            artifact_map = _require_mapping(artifact, f"SOURCE_ARTIFACT_INVALID:{source_id}")
            filename = _require_text(
                artifact_map.get("filename"), f"SOURCE_ARTIFACT_FILENAME:{source_id}"
            )
            if Path(filename).name != filename:
                raise GovernanceError(f"SOURCE_ARTIFACT_FILENAME_INVALID:{source_id}")
            algorithm = _require_text(
                artifact_map.get("checksum_algorithm"),
                f"SOURCE_ARTIFACT_CHECKSUM_ALGORITHM:{source_id}",
            )
            digest = _require_text(
                artifact_map.get("checksum"), f"SOURCE_ARTIFACT_CHECKSUM:{source_id}"
            )
            pattern = HEX_BY_ALGORITHM.get(algorithm)
            if pattern is None or not pattern.fullmatch(digest):
                raise GovernanceError(f"SOURCE_ARTIFACT_CHECKSUM_INVALID:{source_id}")
        if adoption_status == "APPROVED_FOR_LOCAL_RESEARCH":
            if mode != "MANUAL_ARCHIVE_IMPORT" or not artifacts:
                raise GovernanceError(f"SOURCE_APPROVED_WITHOUT_VERIFIABLE_ARTIFACT:{source_id}")

        by_id[source_id] = source

    missing_kinds = {"BONAFIDE", "TTS", "VC", "REPLAY"} - represented_kinds
    if missing_kinds:
        raise GovernanceError(f"SOURCE_KIND_COVERAGE_MISSING:{','.join(sorted(missing_kinds))}")
    return by_id


def _validate_relative_path(value: Any, sample_id: str) -> str:
    relative_path = _require_text(value, f"SAMPLE_PATH_MISSING:{sample_id}")
    pure_path = PurePosixPath(relative_path)
    if pure_path.is_absolute() or ".." in pure_path.parts or "\\" in relative_path:
        raise GovernanceError(f"SAMPLE_PATH_UNSAFE:{sample_id}")
    return relative_path


def _inspect_wav(path: Path) -> AudioInspection:
    try:
        with wave.open(str(path), "rb") as audio:
            if audio.getcomptype() != "NONE":
                raise GovernanceError("AUDIO_WAV_COMPRESSED_UNSUPPORTED")
            return AudioInspection(
                container="WAV",
                sample_rate_hz=audio.getframerate(),
                channels=audio.getnchannels(),
                frames=audio.getnframes(),
            )
    except (EOFError, wave.Error) as error:
        raise GovernanceError("AUDIO_WAV_CORRUPT") from error


def _inspect_flac(path: Path) -> AudioInspection:
    try:
        with path.open("rb") as handle:
            if handle.read(4) != b"fLaC":
                raise GovernanceError("AUDIO_FLAC_CORRUPT")
            while True:
                header = handle.read(4)
                if len(header) != 4:
                    raise GovernanceError("AUDIO_FLAC_STREAMINFO_MISSING")
                is_last = bool(header[0] & 0x80)
                block_type = header[0] & 0x7F
                block_length = int.from_bytes(header[1:4], "big")
                block = handle.read(block_length)
                if len(block) != block_length:
                    raise GovernanceError("AUDIO_FLAC_TRUNCATED")
                if block_type == 0:
                    if block_length != 34:
                        raise GovernanceError("AUDIO_FLAC_STREAMINFO_INVALID")
                    packed = int.from_bytes(block[10:18], "big")
                    sample_rate_hz = (packed >> 44) & 0xFFFFF
                    channels = ((packed >> 41) & 0x7) + 1
                    frames = packed & ((1 << 36) - 1)
                    if sample_rate_hz <= 0 or frames <= 0:
                        raise GovernanceError("AUDIO_FLAC_STREAMINFO_INVALID")
                    return AudioInspection("FLAC", sample_rate_hz, channels, frames)
                if is_last:
                    raise GovernanceError("AUDIO_FLAC_STREAMINFO_MISSING")
    except OSError as error:
        raise GovernanceError("AUDIO_FLAC_READ_FAILED") from error


def inspect_audio(path: Path, expected_container: str) -> AudioInspection:
    """Inspect WAV or FLAC headers without defining Phase L transformations."""

    if expected_container == "WAV":
        return _inspect_wav(path)
    if expected_container == "FLAC":
        return _inspect_flac(path)
    raise GovernanceError("AUDIO_CONTAINER_UNSUPPORTED")


def _resolve_data_path(data_root: Path, relative_path: str, sample_id: str) -> Path:
    root = data_root.resolve()
    candidate = (root / PurePosixPath(relative_path)).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as error:
        raise GovernanceError(f"SAMPLE_PATH_ESCAPES_ROOT:{sample_id}") from error
    return candidate


def validate_manifest_records(
    records: Iterable[Mapping[str, Any]],
    sources: Mapping[str, Mapping[str, Any]],
    *,
    data_root: Path | None = None,
    check_files: bool = False,
) -> list[dict[str, Any]]:
    """Validate manifest semantics, deterministic splits, and optional file integrity."""

    validated: list[dict[str, Any]] = []
    sample_ids: set[str] = set()
    data_versions: set[str] = set()

    if check_files and data_root is None:
        raise GovernanceError("DATA_ROOT_REQUIRED")

    for original in records:
        record = dict(_require_mapping(original, "MANIFEST_RECORD_NOT_OBJECT"))
        sample_id = _require_text(record.get("sample_id"), "SAMPLE_ID_INVALID", stable_id=True)
        _reject_unknown_keys(
            record,
            {
                "schema_version",
                "data_version",
                "sample_id",
                "source_id",
                "source_version",
                "usage_role",
                "relative_path",
                "sha256",
                "byte_size",
                "audio",
                "provenance",
                "labels",
                "locale",
                "channel",
                "governance",
                "split",
            },
            f"SAMPLE_UNKNOWN_FIELDS:{sample_id}",
        )
        if sample_id in sample_ids:
            raise GovernanceError(f"SAMPLE_ID_DUPLICATE:{sample_id}")
        sample_ids.add(sample_id)

        if record.get("schema_version") != SCHEMA_VERSION:
            raise GovernanceError(f"SAMPLE_SCHEMA_VERSION_UNSUPPORTED:{sample_id}")
        data_version = _require_text(
            record.get("data_version"), f"DATA_VERSION_MISSING:{sample_id}", stable_id=True
        )
        data_versions.add(data_version)
        source_id = _require_text(
            record.get("source_id"), f"SAMPLE_SOURCE_ID_INVALID:{sample_id}", stable_id=True
        )
        source = sources.get(source_id)
        if source is None:
            raise GovernanceError(f"SAMPLE_SOURCE_UNKNOWN:{sample_id}")
        if record.get("source_version") != source.get("version"):
            raise GovernanceError(f"SAMPLE_SOURCE_VERSION_CONFLICT:{sample_id}")
        if source["adoption"]["status"] != "APPROVED_FOR_LOCAL_RESEARCH":
            raise GovernanceError(f"SAMPLE_SOURCE_NOT_APPROVED:{sample_id}")

        usage_role = _require_text(record.get("usage_role"), f"USAGE_ROLE_MISSING:{sample_id}")
        if usage_role not in USAGE_ROLES:
            raise GovernanceError(f"USAGE_ROLE_INVALID:{sample_id}")
        if usage_role not in source["adoption"]["permitted_roles"]:
            raise GovernanceError(f"USAGE_ROLE_NOT_PERMITTED:{sample_id}")

        relative_path = _validate_relative_path(record.get("relative_path"), sample_id)
        sha256 = _require_text(record.get("sha256"), f"SAMPLE_SHA256_MISSING:{sample_id}")
        if not HEX_64.fullmatch(sha256):
            raise GovernanceError(f"SAMPLE_SHA256_INVALID:{sample_id}")
        byte_size = record.get("byte_size")
        if not isinstance(byte_size, int) or byte_size <= 0:
            raise GovernanceError(f"SAMPLE_BYTE_SIZE_INVALID:{sample_id}")

        audio = _require_mapping(record.get("audio"), f"AUDIO_METADATA_MISSING:{sample_id}")
        _reject_unknown_keys(
            audio,
            {"container", "codec", "sample_rate_hz", "channels", "frames", "duration_seconds"},
            f"AUDIO_UNKNOWN_FIELDS:{sample_id}",
        )
        container = audio.get("container")
        if container not in {"WAV", "FLAC"}:
            raise GovernanceError(f"AUDIO_CONTAINER_INVALID:{sample_id}")
        if audio.get("codec") not in {"PCM_S16LE", "FLAC_PCM_S16"}:
            raise GovernanceError(f"AUDIO_CODEC_INVALID:{sample_id}")
        expected_codec = "PCM_S16LE" if container == "WAV" else "FLAC_PCM_S16"
        if audio.get("codec") != expected_codec:
            raise GovernanceError(f"AUDIO_CODEC_CONTAINER_CONFLICT:{sample_id}")
        for field in ("sample_rate_hz", "channels", "frames"):
            if not isinstance(audio.get(field), int) or audio[field] <= 0:
                raise GovernanceError(f"AUDIO_{field.upper()}_INVALID:{sample_id}")
        duration = audio.get("duration_seconds")
        if not isinstance(duration, (int, float)) or isinstance(duration, bool) or duration <= 0:
            raise GovernanceError(f"AUDIO_DURATION_INVALID:{sample_id}")

        provenance = _require_mapping(record.get("provenance"), f"PROVENANCE_MISSING:{sample_id}")
        _reject_unknown_keys(
            provenance,
            {
                "provider_sample_id",
                "speaker_id",
                "speaker_group_id",
                "split_group_id",
                "lineage_root_id",
                "parent_sample_ids",
                "near_duplicate_id",
                "label_authority",
                "acquisition_receipt_sha256",
            },
            f"PROVENANCE_UNKNOWN_FIELDS:{sample_id}",
        )
        for field in (
            "provider_sample_id",
            "speaker_id",
            "speaker_group_id",
            "split_group_id",
            "lineage_root_id",
            "near_duplicate_id",
            "label_authority",
            "acquisition_receipt_sha256",
        ):
            _require_text(provenance.get(field), f"PROVENANCE_{field.upper()}:{sample_id}")
        if not HEX_64.fullmatch(provenance["acquisition_receipt_sha256"]):
            raise GovernanceError(f"PROVENANCE_RECEIPT_SHA256_INVALID:{sample_id}")
        parent_ids = provenance.get("parent_sample_ids")
        if not isinstance(parent_ids, list) or not all(
            isinstance(value, str) for value in parent_ids
        ):
            raise GovernanceError(f"PROVENANCE_PARENT_IDS_INVALID:{sample_id}")

        labels = _require_mapping(record.get("labels"), f"LABELS_MISSING:{sample_id}")
        _reject_unknown_keys(
            labels,
            {
                "class",
                "attack_type",
                "generator_family",
                "generator_version",
                "is_final_ood_family",
            },
            f"LABEL_UNKNOWN_FIELDS:{sample_id}",
        )
        label = labels.get("class")
        attack_type = labels.get("attack_type")
        if label not in LABELS or attack_type not in ATTACK_TYPES:
            raise GovernanceError(f"LABEL_INVALID:{sample_id}")
        generator_family = labels.get("generator_family")
        generator_version = labels.get("generator_version")
        final_ood = labels.get("is_final_ood_family")
        if not isinstance(final_ood, bool):
            raise GovernanceError(f"FINAL_OOD_FLAG_INVALID:{sample_id}")
        if label == "BONAFIDE":
            if (
                attack_type != "NONE"
                or generator_family is not None
                or generator_version is not None
            ):
                raise GovernanceError(f"BONAFIDE_LABEL_CONFLICT:{sample_id}")
            if final_ood:
                raise GovernanceError(f"BONAFIDE_FINAL_OOD_INVALID:{sample_id}")
        else:
            if attack_type == "NONE":
                raise GovernanceError(f"SPOOF_ATTACK_TYPE_MISSING:{sample_id}")
            _require_text(generator_family, f"GENERATOR_FAMILY_MISSING:{sample_id}")
            _require_text(generator_version, f"GENERATOR_VERSION_MISSING:{sample_id}")

        locale = _require_mapping(record.get("locale"), f"LOCALE_MISSING:{sample_id}")
        _reject_unknown_keys(
            locale,
            {"status", "language_bcp47", "accent"},
            f"LOCALE_UNKNOWN_FIELDS:{sample_id}",
        )
        if locale.get("status") not in {"KNOWN", "UNKNOWN"}:
            raise GovernanceError(f"LOCALE_STATUS_INVALID:{sample_id}")
        if locale["status"] == "KNOWN":
            _require_text(locale.get("language_bcp47"), f"LANGUAGE_MISSING:{sample_id}")
            accent = locale.get("accent")
            if accent is not None and (not isinstance(accent, str) or not accent.strip()):
                raise GovernanceError(f"ACCENT_INVALID:{sample_id}")
        elif locale.get("language_bcp47") is not None or locale.get("accent") is not None:
            raise GovernanceError(f"LOCALE_UNKNOWN_WITH_CLAIM:{sample_id}")

        channel = _require_mapping(record.get("channel"), f"CHANNEL_MISSING:{sample_id}")
        _reject_unknown_keys(
            channel,
            {"capture_lineage", "codec_lineage", "degradation_lineage", "recipe_version"},
            f"CHANNEL_UNKNOWN_FIELDS:{sample_id}",
        )
        for field in ("capture_lineage", "codec_lineage", "degradation_lineage"):
            values = channel.get(field)
            if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
                raise GovernanceError(f"CHANNEL_{field.upper()}_INVALID:{sample_id}")
        _require_text(channel.get("recipe_version"), f"CHANNEL_RECIPE_MISSING:{sample_id}")

        governance = _require_mapping(record.get("governance"), f"GOVERNANCE_MISSING:{sample_id}")
        _reject_unknown_keys(
            governance,
            {"license_id", "consent_status", "redistribution", "contains_biometric_like_data"},
            f"GOVERNANCE_UNKNOWN_FIELDS:{sample_id}",
        )
        if governance.get("license_id") != source["license"]["identifier"]:
            raise GovernanceError(f"SAMPLE_LICENSE_CONFLICT:{sample_id}")
        if governance.get("consent_status") not in {
            "EXPLICIT_DATASET_CONSENT",
            "PROVIDER_DOCUMENTED_REUSE_TERMS",
        }:
            raise GovernanceError(f"SAMPLE_CONSENT_UNRESOLVED:{sample_id}")
        if governance.get("contains_biometric_like_data") is not True:
            raise GovernanceError(f"SAMPLE_SENSITIVITY_UNDECLARED:{sample_id}")
        _require_text(
            governance.get("redistribution"), f"SAMPLE_REDISTRIBUTION_MISSING:{sample_id}"
        )

        split = _require_mapping(record.get("split"), f"SPLIT_MISSING:{sample_id}")
        _reject_unknown_keys(
            split,
            {"name", "policy_version"},
            f"SPLIT_UNKNOWN_FIELDS:{sample_id}",
        )
        if split.get("policy_version") != SPLIT_POLICY_VERSION:
            raise GovernanceError(f"SPLIT_POLICY_VERSION_CONFLICT:{sample_id}")
        split_name = split.get("name")
        if split_name not in SPLITS:
            raise GovernanceError(f"SPLIT_NAME_INVALID:{sample_id}")
        expected_split = stable_split(provenance["split_group_id"], final_ood)
        if split_name != expected_split:
            raise GovernanceError(f"SPLIT_ASSIGNMENT_CONFLICT:{sample_id}")

        if check_files:
            assert data_root is not None
            sample_path = _resolve_data_path(data_root, relative_path, sample_id)
            if not sample_path.is_file():
                raise GovernanceError(f"SAMPLE_FILE_MISSING:{sample_id}")
            if sample_path.stat().st_size != byte_size:
                raise GovernanceError(f"SAMPLE_BYTE_SIZE_CONFLICT:{sample_id}")
            if digest_file(sample_path) != sha256:
                raise GovernanceError(f"SAMPLE_CHECKSUM_CONFLICT:{sample_id}")
            inspected = inspect_audio(sample_path, container)
            if inspected.sample_rate_hz != audio["sample_rate_hz"]:
                raise GovernanceError(f"AUDIO_SAMPLE_RATE_CONFLICT:{sample_id}")
            if inspected.channels != audio["channels"]:
                raise GovernanceError(f"AUDIO_CHANNELS_CONFLICT:{sample_id}")
            if inspected.frames != audio["frames"]:
                raise GovernanceError(f"AUDIO_FRAMES_CONFLICT:{sample_id}")
            tolerance = max(1 / inspected.sample_rate_hz, 0.000001)
            if abs(inspected.duration_seconds - float(duration)) > tolerance:
                raise GovernanceError(f"AUDIO_DURATION_CONFLICT:{sample_id}")

        validated.append(record)

    if len(data_versions) != 1:
        raise GovernanceError("MANIFEST_MULTIPLE_DATA_VERSIONS")
    return validated


def leakage_errors(records: Iterable[Mapping[str, Any]]) -> list[str]:
    """Return deterministic exact/near-duplicate and split-leakage diagnostics."""

    errors: set[str] = set()
    by_sha: defaultdict[str, list[Mapping[str, Any]]] = defaultdict(list)
    by_near: defaultdict[str, list[Mapping[str, Any]]] = defaultdict(list)
    split_sets: dict[str, defaultdict[str, set[str]]] = {
        "speaker_group": defaultdict(set),
        "lineage_root": defaultdict(set),
    }
    generator_splits: defaultdict[str, set[str]] = defaultdict(set)
    final_ood_families: set[str] = set()

    for record in records:
        sample_id = str(record["sample_id"])
        split_name = str(record["split"]["name"])
        provenance = record["provenance"]
        labels = record["labels"]
        by_sha[str(record["sha256"])].append(record)
        by_near[str(provenance["near_duplicate_id"])].append(record)
        split_sets["speaker_group"][str(provenance["speaker_group_id"])].add(split_name)
        split_sets["lineage_root"][str(provenance["lineage_root_id"])].add(split_name)
        family = labels.get("generator_family")
        if isinstance(family, str):
            generator_splits[family].add(split_name)
            if labels.get("is_final_ood_family") is True:
                final_ood_families.add(family)
        if labels["class"] == "SPOOF" and not provenance["parent_sample_ids"]:
            errors.add(f"SPOOF_LINEAGE_PARENT_MISSING:{sample_id}")

    for digest, group in by_sha.items():
        if len(group) > 1:
            ids = ",".join(sorted(str(item["sample_id"]) for item in group))
            label_pairs = {
                (item["labels"]["class"], item["labels"]["attack_type"]) for item in group
            }
            code = "EXACT_DUPLICATE_CONFLICT" if len(label_pairs) > 1 else "EXACT_DUPLICATE"
            errors.add(f"{code}:{digest}:{ids}")
    for near_id, group in by_near.items():
        if len(group) > 1:
            ids = ",".join(sorted(str(item["sample_id"]) for item in group))
            errors.add(f"NEAR_DUPLICATE:{near_id}:{ids}")
    for category, groups in split_sets.items():
        for group_id, splits in groups.items():
            if len(splits) > 1:
                errors.add(f"{category.upper()}_LEAKAGE:{group_id}:{','.join(sorted(splits))}")
    for family in final_ood_families:
        unexpected = generator_splits[family] - {"FINAL_OOD"}
        if unexpected:
            errors.add(f"FINAL_OOD_GENERATOR_LEAKAGE:{family}:{','.join(sorted(unexpected))}")

    return sorted(errors)


def acquire_archive(
    source: Mapping[str, Any],
    archive: Path,
    destination: Path,
    acknowledged_license: str | None,
    repository_root: Path,
) -> dict[str, Any]:
    """Verify and copy one approved archive outside the repository with an idempotent receipt."""

    source_id = str(source["source_id"])
    if source["license"]["status"] != "VERIFIED_OFFICIAL":
        raise GovernanceError("ACQUISITION_LICENSE_UNVERIFIED")
    if source["adoption"]["status"] != "APPROVED_FOR_LOCAL_RESEARCH":
        raise GovernanceError("ACQUISITION_SOURCE_NOT_APPROVED")
    if source["acquisition"]["mode"] != "MANUAL_ARCHIVE_IMPORT":
        raise GovernanceError("ACQUISITION_MODE_NOT_IMPORTABLE")
    license_id = str(source["license"]["identifier"])
    if source["license"]["acknowledgment_required"] and acknowledged_license != license_id:
        raise GovernanceError("ACQUISITION_LICENSE_ACKNOWLEDGMENT_REQUIRED")
    if not archive.is_file():
        raise GovernanceError("ACQUISITION_ARCHIVE_NOT_FOUND")

    artifacts = {str(item["filename"]): item for item in source["acquisition"]["artifacts"]}
    artifact = artifacts.get(archive.name)
    if artifact is None:
        raise GovernanceError("ACQUISITION_ARCHIVE_NOT_REGISTERED")
    algorithm = str(artifact["checksum_algorithm"])
    if digest_file(archive, algorithm) != artifact["checksum"]:
        raise GovernanceError("ACQUISITION_PROVIDER_CHECKSUM_MISMATCH")

    repository = repository_root.resolve()
    target_root = destination.resolve()
    try:
        target_root.relative_to(repository)
    except ValueError:
        pass
    else:
        raise GovernanceError("ACQUISITION_DESTINATION_INSIDE_REPOSITORY")

    source_version = str(source["version"])
    target_directory = target_root / source_id / source_version
    target_directory.mkdir(parents=True, exist_ok=True)
    target_archive = target_directory / archive.name
    receipt_path = target_directory / "acquisition-receipt.json"
    archive_sha256 = digest_file(archive)
    receipt = {
        "schema_version": SCHEMA_VERSION,
        "source_id": source_id,
        "source_version": source_version,
        "license_id": license_id,
        "provider_checksum_algorithm": algorithm,
        "provider_checksum": artifact["checksum"],
        "archive_filename": archive.name,
        "archive_sha256": archive_sha256,
        "acquired_at": datetime.now(UTC).isoformat(),
        "content_extracted": False,
    }

    if receipt_path.exists():
        existing = load_json_document(receipt_path)
        if (
            isinstance(existing, Mapping)
            and existing.get("archive_sha256") == archive_sha256
            and target_archive.is_file()
            and digest_file(target_archive) == archive_sha256
        ):
            return {**dict(existing), "status": "IDEMPOTENT_REPLAY"}
        raise GovernanceError("ACQUISITION_RECEIPT_CONFLICT")

    temporary_archive = target_directory / f".{archive.name}.partial"
    temporary_receipt = target_directory / ".acquisition-receipt.json.partial"
    try:
        shutil.copyfile(archive, temporary_archive)
        if digest_file(temporary_archive) != archive_sha256:
            raise GovernanceError("ACQUISITION_COPY_CHECKSUM_MISMATCH")
        os.replace(temporary_archive, target_archive)
        temporary_receipt.write_text(
            json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        os.replace(temporary_receipt, receipt_path)
    finally:
        temporary_archive.unlink(missing_ok=True)
        temporary_receipt.unlink(missing_ok=True)

    return {**receipt, "status": "IMPORTED"}
