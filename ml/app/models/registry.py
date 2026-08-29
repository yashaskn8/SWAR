"""Validated model registry, artifact hashing, and adapter construction."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath
from typing import Any, Literal

import torch
import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.models.interfaces import (
    ModelAdapter,
    ModelAdapterError,
    ModelCapability,
    ModelErrorCode,
    ModelMetadata,
    ScoreDirection,
)


class ArtifactSpec(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    artifact_id: str = Field(pattern=r"^[a-z0-9][a-z0-9._-]+$")
    relative_path: str
    kind: Literal["CHECKPOINT", "SOURCE", "CONFIG"]
    url: str
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    byte_size: int = Field(gt=0)

    @field_validator("relative_path")
    @classmethod
    def validate_relative_path(cls, value: str) -> str:
        path = PurePosixPath(value)
        if path.is_absolute() or ".." in path.parts or len(path.parts) < 2:
            raise ValueError("artifact path must be a bounded relative path")
        return value

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        if not value.startswith("https://"):
            raise ValueError("artifact URL must use HTTPS")
        return value


class ModelSpec(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    model_id: str
    model_name: str
    model_version: str
    capability: ModelCapability
    source_revision: str = Field(pattern=r"^[0-9a-f]{40}$")
    source_repository: str
    license_identifier: str
    license_url: str
    license_acknowledgment: str
    input_sample_rate_hz: Literal[16000]
    input_samples: int = Field(gt=0)
    score_name: str
    score_direction: ScoreDirection
    score_semantics: str
    adapter_version: str
    architecture: dict[str, Any]
    checkpoint_artifact_id: str
    artifacts: tuple[ArtifactSpec, ...]

    @field_validator("license_acknowledgment")
    @classmethod
    def require_acknowledgment_text(cls, value: str) -> str:
        if len(value.strip()) < 20:
            raise ValueError("license acknowledgment must be explicit")
        return value

    def artifact(self, artifact_id: str) -> ArtifactSpec:
        matches = [item for item in self.artifacts if item.artifact_id == artifact_id]
        if len(matches) != 1:
            raise ModelAdapterError(ModelErrorCode.MODEL_REGISTRY_INVALID)
        return matches[0]

    @property
    def checkpoint(self) -> ArtifactSpec:
        checkpoint = self.artifact(self.checkpoint_artifact_id)
        if checkpoint.kind != "CHECKPOINT":
            raise ModelAdapterError(ModelErrorCode.MODEL_REGISTRY_INVALID)
        return checkpoint

    def metadata(self) -> ModelMetadata:
        return ModelMetadata(
            model_id=self.model_id,
            model_name=self.model_name,
            model_version=self.model_version,
            capability=self.capability,
            checkpoint_sha256=self.checkpoint.sha256,
            source_revision=self.source_revision,
            license_identifier=self.license_identifier,
            input_sample_rate_hz=self.input_sample_rate_hz,
            input_samples=self.input_samples,
            score_name=self.score_name,
            score_direction=self.score_direction,
            score_semantics=self.score_semantics,
            adapter_version=self.adapter_version,
        )


class RegistryDocument(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    schema_version: Literal["1.0.0"]
    registry_version: str
    models: tuple[ModelSpec, ...]


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verified_artifact_path(checkpoint_root: Path, artifact: ArtifactSpec) -> Path:
    root = checkpoint_root.resolve()
    path = (root / Path(artifact.relative_path)).resolve()
    try:
        path.relative_to(root)
    except ValueError as error:
        raise ModelAdapterError(ModelErrorCode.MODEL_REGISTRY_INVALID) from error
    if not path.is_file() or path.stat().st_size != artifact.byte_size:
        raise ModelAdapterError(ModelErrorCode.MODEL_ARTIFACT_MISSING)
    if file_sha256(path) != artifact.sha256:
        raise ModelAdapterError(ModelErrorCode.MODEL_ARTIFACT_HASH_MISMATCH)
    return path


def select_device(requested: str) -> torch.device:
    normalized = requested.strip().lower()
    if normalized == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if normalized == "cpu":
        return torch.device("cpu")
    if normalized == "cuda" and torch.cuda.is_available():
        return torch.device("cuda")
    raise ModelAdapterError(ModelErrorCode.DEVICE_UNAVAILABLE)


class ModelRegistry:
    def __init__(self, document: RegistryDocument, *, registry_sha256: str) -> None:
        identifiers = [model.model_id for model in document.models]
        if len(identifiers) != len(set(identifiers)) or set(identifiers) != {
            "ecapa-tdnn",
            "rawnet2",
            "aasist",
        }:
            raise ModelAdapterError(ModelErrorCode.MODEL_REGISTRY_INVALID)
        for model in document.models:
            artifact_ids = [artifact.artifact_id for artifact in model.artifacts]
            if len(artifact_ids) != len(set(artifact_ids)):
                raise ModelAdapterError(ModelErrorCode.MODEL_REGISTRY_INVALID)
            _ = model.checkpoint
        self.document = document
        self.registry_sha256 = registry_sha256
        self._models = {model.model_id: model for model in document.models}

    @classmethod
    def load(cls, path: Path | None = None) -> ModelRegistry:
        registry_path = path or Path(__file__).parents[2] / "config" / "model_registry.yaml"
        try:
            raw = registry_path.read_bytes()
            parsed = yaml.safe_load(raw)
            document = RegistryDocument.model_validate(parsed)
        except (OSError, UnicodeDecodeError, yaml.YAMLError, ValidationError) as error:
            raise ModelAdapterError(ModelErrorCode.MODEL_REGISTRY_INVALID) from error
        return cls(document, registry_sha256=hashlib.sha256(raw).hexdigest())

    def get(self, model_id: str) -> ModelSpec:
        try:
            return self._models[model_id]
        except KeyError as error:
            raise ModelAdapterError(ModelErrorCode.MODEL_REGISTRY_INVALID) from error

    def verify(self, model_id: str, checkpoint_root: Path) -> dict[str, Path]:
        spec = self.get(model_id)
        return {
            artifact.artifact_id: verified_artifact_path(checkpoint_root, artifact)
            for artifact in spec.artifacts
        }

    def create_adapter(
        self,
        model_id: str,
        *,
        checkpoint_root: Path,
        device: str = "auto",
    ) -> ModelAdapter:
        spec = self.get(model_id)
        selected_device = select_device(device)
        if model_id == "ecapa-tdnn":
            from app.models.ecapa import EcapaTdnnAdapter

            return EcapaTdnnAdapter(spec, checkpoint_root, selected_device)
        if model_id == "rawnet2":
            from app.models.rawnet2 import RawNet2Adapter

            return RawNet2Adapter(spec, checkpoint_root, selected_device)
        if model_id == "aasist":
            from app.models.aasist import AasistAdapter

            return AasistAdapter(spec, checkpoint_root, selected_device)
        raise ModelAdapterError(ModelErrorCode.MODEL_REGISTRY_INVALID)

    def canonical_json(self) -> str:
        return json.dumps(
            self.document.model_dump(mode="json"), sort_keys=True, separators=(",", ":")
        )
