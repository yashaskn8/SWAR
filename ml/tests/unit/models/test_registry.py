from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from app.models.interfaces import ModelAdapterError, ModelErrorCode
from app.models.registry import (
    ArtifactSpec,
    ModelRegistry,
    select_device,
    verified_artifact_path,
)


def test_frozen_registry_has_exact_models_and_claim_safe_directions() -> None:
    registry = ModelRegistry.load()
    assert [model.model_id for model in registry.document.models] == [
        "ecapa-tdnn",
        "rawnet2",
        "aasist",
    ]
    assert registry.get("ecapa-tdnn").score_name == "cosine_similarity"
    assert registry.get("rawnet2").score_name == "bonafide_logit"
    assert registry.get("aasist").score_name == "bonafide_logit"
    assert all("probability" not in model.score_name.lower() for model in registry.document.models)
    assert all("probability" in model.score_semantics.lower() for model in registry.document.models)


def artifact_for(payload: bytes, *, sha256: str | None = None) -> ArtifactSpec:
    return ArtifactSpec(
        artifact_id="test-checkpoint",
        relative_path="test/model.pth",
        kind="CHECKPOINT",
        url="https://example.invalid/model.pth",
        sha256=sha256 or hashlib.sha256(payload).hexdigest(),
        byte_size=len(payload),
    )


def test_artifact_missing_and_hash_mismatch_are_distinct(tmp_path: Path) -> None:
    payload = b"verified-test-artifact"
    artifact = artifact_for(payload)
    with pytest.raises(ModelAdapterError) as missing:
        verified_artifact_path(tmp_path, artifact)
    assert missing.value.code is ModelErrorCode.MODEL_ARTIFACT_MISSING

    target = tmp_path / "test" / "model.pth"
    target.parent.mkdir()
    target.write_bytes(b"modified-test-artifact")
    modified = artifact_for(target.read_bytes(), sha256="a" * 64)
    with pytest.raises(ModelAdapterError) as mismatch:
        verified_artifact_path(tmp_path, modified)
    assert mismatch.value.code is ModelErrorCode.MODEL_ARTIFACT_HASH_MISMATCH


def test_artifact_path_cannot_escape_checkpoint_root() -> None:
    with pytest.raises(ValueError):
        ArtifactSpec(
            artifact_id="bad-checkpoint",
            relative_path="../outside.pth",
            kind="CHECKPOINT",
            url="https://example.invalid/outside.pth",
            sha256="a" * 64,
            byte_size=1,
        )


def test_device_policy_fails_closed() -> None:
    assert select_device("cpu").type == "cpu"
    with pytest.raises(ModelAdapterError) as raised:
        select_device("not-a-device")
    assert raised.value.code is ModelErrorCode.DEVICE_UNAVAILABLE
