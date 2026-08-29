from __future__ import annotations

import time

import numpy as np
import pytest

from app.models.interfaces import (
    ModelAdapter,
    ModelAdapterError,
    ModelCapability,
    ModelErrorCode,
    ModelInput,
    ModelMetadata,
    ModelReadiness,
    ScoreDirection,
    SensitiveEmbedding,
)


def metadata() -> ModelMetadata:
    return ModelMetadata(
        model_id="test-model",
        model_name="Test model",
        model_version="test-v1",
        capability=ModelCapability.SPOOF_FAST,
        checkpoint_sha256="a" * 64,
        source_revision="b" * 40,
        license_identifier="MIT",
        input_sample_rate_hz=16_000,
        input_samples=64_000,
        score_name="raw_logit",
        score_direction=ScoreDirection.HIGHER_IS_MORE_BONAFIDE,
        score_semantics="Uncalibrated test score.",
        adapter_version="test-adapter-v1",
    )


def model_input() -> ModelInput:
    return ModelInput(
        samples=np.zeros(64_000, dtype=np.float32),
        sample_rate_hz=16_000,
        window_id="window-1",
        sequence=1,
        start_ms=0,
        end_ms=4000,
        preprocessing_version="test-preprocess-v1",
    )


class FakeAdapter(ModelAdapter):
    def __init__(self, *, delay: float = 0.0) -> None:
        super().__init__(metadata())
        self.delay = delay

    def load(self) -> None:
        self._mark_ready()

    def _infer_raw(self, model_input: ModelInput, **kwargs: object) -> float:
        time.sleep(self.delay)
        return 0.25

    def close(self) -> None:
        self._mark_closed()


def test_model_input_rejects_wrong_dtype() -> None:
    with pytest.raises(ModelAdapterError) as raised:
        ModelInput(
            samples=np.zeros(64_000, dtype=np.float64),
            sample_rate_hz=16_000,
            window_id="window-1",
            sequence=0,
            start_ms=0,
            end_ms=4000,
            preprocessing_version="v1",
        )
    assert raised.value.code is ModelErrorCode.INVALID_MODEL_INPUT


def test_result_envelope_uses_raw_score_not_probability() -> None:
    adapter = FakeAdapter()
    adapter.load()
    record = adapter.infer(model_input(), timeout_seconds=1.0).as_record()
    assert record["rawScore"] == 0.25
    assert record["scoreDirection"] == "HIGHER_IS_MORE_BONAFIDE"
    assert "probability" not in " ".join(record).lower()


def test_timeout_fails_closed_and_cleanup_is_explicit() -> None:
    adapter = FakeAdapter(delay=0.05)
    adapter.load()
    with pytest.raises(ModelAdapterError) as raised:
        adapter.infer(model_input(), timeout_seconds=0.001)
    assert raised.value.code is ModelErrorCode.MODEL_INFERENCE_TIMEOUT
    assert adapter.readiness is ModelReadiness.ERROR
    adapter.close()
    assert adapter.readiness is ModelReadiness.CLOSED


def test_sensitive_embedding_zeroizes_and_cannot_be_reused() -> None:
    embedding = SensitiveEmbedding(
        np.ones(192, dtype=np.float32), model_id="ecapa-tdnn", model_version="v1"
    )
    assert float(embedding.values.sum()) == 192.0
    embedding.clear()
    assert embedding.cleared
    with pytest.raises(ModelAdapterError) as raised:
        _ = embedding.values
    assert raised.value.code is ModelErrorCode.MODEL_ALREADY_CLOSED
