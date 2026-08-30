"""Cancelable asynchronous DEEP execution helper."""

from __future__ import annotations

from app.inference.fast_path import InferenceRuntime, TechnicalResult
from app.models.interfaces import ModelInput


async def run_deep(runtime: InferenceRuntime, model_input: ModelInput) -> TechnicalResult:
    return await runtime.deep(model_input)
