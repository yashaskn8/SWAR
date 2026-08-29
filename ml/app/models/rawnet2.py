"""Verified RawNet2 fast spoof-evidence adapter."""

from __future__ import annotations

import copy
import gc
import importlib.util
from pathlib import Path
from types import ModuleType
from typing import Any

import torch

from app.models.interfaces import ModelAdapter, ModelAdapterError, ModelErrorCode, ModelInput
from app.models.registry import ModelSpec, verified_artifact_path


def _load_source(path: Path, module_name: str) -> ModuleType:
    module_spec = importlib.util.spec_from_file_location(module_name, path)
    if module_spec is None or module_spec.loader is None:
        raise ModelAdapterError(ModelErrorCode.MODEL_ARCHITECTURE_MISMATCH)
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    return module


class RawNet2Adapter(ModelAdapter):
    def __init__(self, spec: ModelSpec, checkpoint_root: Path, device: torch.device) -> None:
        super().__init__(spec.metadata())
        self._spec = spec
        self._checkpoint_root = checkpoint_root
        self._device = device
        self._model: torch.nn.Module | None = None

    def load(self) -> None:
        artifacts = {
            artifact.artifact_id: verified_artifact_path(self._checkpoint_root, artifact)
            for artifact in self._spec.artifacts
        }
        try:
            source = _load_source(artifacts["rawnet2-source"], "swar_verified_rawnet2")
            model = source.RawNet(copy.deepcopy(self._spec.architecture), self._device).to(
                self._device
            )
            package = torch.load(
                artifacts[self._spec.checkpoint_artifact_id],
                map_location=self._device,
                weights_only=True,
            )
            state = package["model_state_dict"]
            model.load_state_dict(state, strict=True)
            model.eval()
            del package, state
        except Exception as error:
            raise ModelAdapterError(ModelErrorCode.MODEL_ARCHITECTURE_MISMATCH) from error
        self._model = model
        self._mark_ready()

    @staticmethod
    def bonafide_logit(output: torch.Tensor) -> float:
        if output.shape != (1, 2):
            raise ModelAdapterError(ModelErrorCode.MODEL_INFERENCE_FAILED)
        return float(output[0, 1].detach().cpu().item())

    def _infer_raw(self, model_input: ModelInput, **_: Any) -> float:
        if model_input.samples.size != self.metadata.input_samples:
            raise ModelAdapterError(ModelErrorCode.INVALID_MODEL_INPUT)
        if self._model is None:
            raise ModelAdapterError(ModelErrorCode.MODEL_NOT_READY)
        waveform = torch.from_numpy(model_input.samples.copy()).unsqueeze(0).to(self._device)
        with torch.inference_mode():
            output = self._model(waveform)
        score = self.bonafide_logit(output)
        del waveform, output
        return score

    def close(self) -> None:
        self._model = None
        gc.collect()
        if self._device.type == "cuda":
            torch.cuda.empty_cache()
        self._mark_closed()
