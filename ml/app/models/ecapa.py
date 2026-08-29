"""SpeechBrain ECAPA-TDNN expected-speaker similarity adapter."""

from __future__ import annotations

import gc
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np
import torch
from speechbrain.lobes.features import Fbank
from speechbrain.lobes.models.ECAPA_TDNN import ECAPA_TDNN
from speechbrain.processing.features import InputNormalization

from app.models.interfaces import (
    ModelAdapter,
    ModelAdapterError,
    ModelErrorCode,
    ModelInput,
    SensitiveEmbedding,
)
from app.models.registry import ModelSpec, verified_artifact_path


class EcapaTdnnAdapter(ModelAdapter):
    def __init__(self, spec: ModelSpec, checkpoint_root: Path, device: torch.device) -> None:
        super().__init__(spec.metadata())
        self._spec = spec
        self._checkpoint_root = checkpoint_root
        self._device = device
        self._features: Fbank | None = None
        self._normalizer: InputNormalization | None = None
        self._model: ECAPA_TDNN | None = None

    def load(self) -> None:
        artifacts = {
            artifact.artifact_id: verified_artifact_path(self._checkpoint_root, artifact)
            for artifact in self._spec.artifacts
        }
        architecture = self._spec.architecture
        try:
            model = ECAPA_TDNN(**architecture).to(self._device)
            state = torch.load(
                artifacts[self._spec.checkpoint_artifact_id],
                map_location=self._device,
                weights_only=True,
            )
            model.load_state_dict(state, strict=True)
            model.eval()
        except Exception as error:
            raise ModelAdapterError(ModelErrorCode.MODEL_ARCHITECTURE_MISMATCH) from error
        self._features = Fbank(n_mels=int(architecture["input_size"]))
        self._normalizer = InputNormalization(norm_type="sentence", std_norm=False)
        self._model = model
        self._mark_ready()

    def _embedding(self, model_input: ModelInput) -> np.ndarray:
        if model_input.samples.size != self.metadata.input_samples:
            raise ModelAdapterError(ModelErrorCode.INVALID_MODEL_INPUT)
        if self._model is None or self._features is None or self._normalizer is None:
            raise ModelAdapterError(ModelErrorCode.MODEL_NOT_READY)
        waveform = torch.from_numpy(model_input.samples.copy()).unsqueeze(0).to(self._device)
        lengths = torch.ones(1, device=self._device)
        with torch.inference_mode():
            features = self._features(waveform)
            normalized = self._normalizer(features, lengths)
            embedding = self._model(normalized, lengths).reshape(-1)
            embedding = torch.nn.functional.normalize(embedding, dim=0)
        values = embedding.detach().cpu().numpy().astype(np.float32, copy=True)
        del waveform, features, normalized, embedding
        return values

    def enroll(self, inputs: Sequence[ModelInput]) -> SensitiveEmbedding:
        if not inputs:
            raise ModelAdapterError(ModelErrorCode.INVALID_MODEL_INPUT)
        embeddings = np.stack([self._embedding(item) for item in inputs])
        mean = embeddings.mean(axis=0, dtype=np.float32)
        norm = float(np.linalg.norm(mean))
        embeddings.fill(0.0)
        if norm <= 0 or not np.isfinite(norm):
            mean.fill(0.0)
            raise ModelAdapterError(ModelErrorCode.MODEL_INFERENCE_FAILED)
        mean /= norm
        return SensitiveEmbedding(
            mean,
            model_id=self.metadata.model_id,
            model_version=self.metadata.model_version,
        )

    def _infer_raw(self, model_input: ModelInput, **kwargs: Any) -> float:
        reference = kwargs.get("reference")
        if (
            not isinstance(reference, SensitiveEmbedding)
            or reference.model_id != self.metadata.model_id
        ):
            raise ModelAdapterError(ModelErrorCode.REFERENCE_EMBEDDING_REQUIRED)
        candidate = self._embedding(model_input)
        reference_values = reference.values
        if candidate.shape != reference_values.shape:
            candidate.fill(0.0)
            raise ModelAdapterError(ModelErrorCode.INVALID_MODEL_INPUT)
        similarity = float(np.dot(candidate, reference_values))
        candidate.fill(0.0)
        return similarity

    def close(self) -> None:
        self._model = None
        self._features = None
        self._normalizer = None
        gc.collect()
        if self._device.type == "cuda":
            torch.cuda.empty_cache()
        self._mark_closed()
