"""Common, claim-safe interfaces for real model adapters."""

from __future__ import annotations

import math
from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from dataclasses import dataclass, field
from enum import StrEnum
from threading import RLock
from time import perf_counter
from typing import Any

import numpy as np


class ModelCapability(StrEnum):
    IDENTITY = "IDENTITY"
    SPOOF_FAST = "SPOOF_FAST"
    SPOOF_DEEP = "SPOOF_DEEP"


class ModelReadiness(StrEnum):
    NOT_LOADED = "NOT_LOADED"
    READY = "READY"
    ERROR = "ERROR"
    CLOSED = "CLOSED"


class ScoreDirection(StrEnum):
    HIGHER_IS_MORE_SIMILAR = "HIGHER_IS_MORE_SIMILAR"
    HIGHER_IS_MORE_BONAFIDE = "HIGHER_IS_MORE_BONAFIDE"
    HIGHER_IS_MORE_SPOOF = "HIGHER_IS_MORE_SPOOF"


class ModelErrorCode(StrEnum):
    MODEL_NOT_READY = "MODEL_NOT_READY"
    MODEL_ALREADY_CLOSED = "MODEL_ALREADY_CLOSED"
    MODEL_ARTIFACT_MISSING = "MODEL_ARTIFACT_MISSING"
    MODEL_ARTIFACT_HASH_MISMATCH = "MODEL_ARTIFACT_HASH_MISMATCH"
    MODEL_ARCHITECTURE_MISMATCH = "MODEL_ARCHITECTURE_MISMATCH"
    MODEL_INFERENCE_TIMEOUT = "MODEL_INFERENCE_TIMEOUT"
    MODEL_INFERENCE_FAILED = "MODEL_INFERENCE_FAILED"
    INVALID_MODEL_INPUT = "INVALID_MODEL_INPUT"
    REFERENCE_EMBEDDING_REQUIRED = "REFERENCE_EMBEDDING_REQUIRED"
    DEVICE_UNAVAILABLE = "DEVICE_UNAVAILABLE"
    MODEL_REGISTRY_INVALID = "MODEL_REGISTRY_INVALID"


class ModelAdapterError(RuntimeError):
    """Stable adapter failure that never contains audio, embeddings, or private paths."""

    def __init__(self, code: ModelErrorCode) -> None:
        self.code = code
        super().__init__(code.value)


@dataclass(frozen=True)
class ModelInput:
    """One canonical Phase L window and its non-sensitive lineage."""

    samples: np.ndarray = field(repr=False)
    sample_rate_hz: int
    window_id: str
    sequence: int
    start_ms: int
    end_ms: int
    preprocessing_version: str

    def __post_init__(self) -> None:
        if (
            not isinstance(self.samples, np.ndarray)
            or self.samples.dtype != np.float32
            or self.samples.ndim != 1
            or self.samples.size == 0
            or self.sample_rate_hz != 16_000
            or not np.isfinite(self.samples).all()
            or not self.window_id
            or self.sequence < 0
            or self.start_ms < 0
            or self.end_ms <= self.start_ms
            or not self.preprocessing_version
        ):
            raise ModelAdapterError(ModelErrorCode.INVALID_MODEL_INPUT)


@dataclass(frozen=True)
class ModelMetadata:
    model_id: str
    model_name: str
    model_version: str
    capability: ModelCapability
    checkpoint_sha256: str
    source_revision: str
    license_identifier: str
    input_sample_rate_hz: int
    input_samples: int
    score_name: str
    score_direction: ScoreDirection
    score_semantics: str
    adapter_version: str


@dataclass(frozen=True)
class ModelInferenceResult:
    metadata: ModelMetadata
    raw_score: float
    processing_latency_ms: float
    window_id: str
    sequence: int
    start_ms: int
    end_ms: int
    preprocessing_version: str
    readiness: ModelReadiness = ModelReadiness.READY

    def __post_init__(self) -> None:
        if not math.isfinite(self.raw_score) or self.processing_latency_ms < 0:
            raise ModelAdapterError(ModelErrorCode.MODEL_INFERENCE_FAILED)

    def as_record(self) -> dict[str, str | int | float]:
        """Serialize technical evidence without calling an uncalibrated score a probability."""

        return {
            "modelId": self.metadata.model_id,
            "modelName": self.metadata.model_name,
            "modelVersion": self.metadata.model_version,
            "checkpointSha256": self.metadata.checkpoint_sha256,
            "capability": self.metadata.capability.value,
            "scoreName": self.metadata.score_name,
            "scoreDirection": self.metadata.score_direction.value,
            "scoreSemantics": self.metadata.score_semantics,
            "rawScore": self.raw_score,
            "processingLatencyMs": self.processing_latency_ms,
            "windowId": self.window_id,
            "sequence": self.sequence,
            "startMs": self.start_ms,
            "endMs": self.end_ms,
            "preprocessingVersion": self.preprocessing_version,
            "adapterVersion": self.metadata.adapter_version,
            "readiness": self.readiness.value,
        }


class SensitiveEmbedding:
    """In-memory-only embedding with explicit zeroization semantics."""

    def __init__(self, values: np.ndarray, *, model_id: str, model_version: str) -> None:
        if values.dtype != np.float32 or values.ndim != 1 or not np.isfinite(values).all():
            raise ModelAdapterError(ModelErrorCode.INVALID_MODEL_INPUT)
        self._values = values.copy()
        self.model_id = model_id
        self.model_version = model_version
        self._cleared = False

    @property
    def values(self) -> np.ndarray:
        if self._cleared:
            raise ModelAdapterError(ModelErrorCode.MODEL_ALREADY_CLOSED)
        view = self._values.view()
        view.flags.writeable = False
        return view

    @property
    def cleared(self) -> bool:
        return self._cleared

    def clear(self) -> None:
        self._values.fill(0.0)
        self._cleared = True

    def __enter__(self) -> SensitiveEmbedding:
        return self

    def __exit__(self, *_: object) -> None:
        self.clear()


class ModelAdapter(ABC):
    """Lifecycle, timeout, and result envelope shared by every real adapter."""

    def __init__(self, metadata: ModelMetadata) -> None:
        self.metadata = metadata
        self._readiness = ModelReadiness.NOT_LOADED
        self._state_lock = RLock()

    @property
    def readiness(self) -> ModelReadiness:
        return self._readiness

    @abstractmethod
    def load(self) -> None:
        """Verify artifacts and load the model exactly once."""

    @abstractmethod
    def _infer_raw(self, model_input: ModelInput, **kwargs: Any) -> float:
        """Return one uncalibrated raw score."""

    def infer(
        self,
        model_input: ModelInput,
        *,
        timeout_seconds: float,
        **kwargs: Any,
    ) -> ModelInferenceResult:
        if timeout_seconds <= 0:
            raise ModelAdapterError(ModelErrorCode.INVALID_MODEL_INPUT)
        if self._readiness is not ModelReadiness.READY:
            raise ModelAdapterError(ModelErrorCode.MODEL_NOT_READY)
        started = perf_counter()
        executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix=self.metadata.model_id)
        future = executor.submit(self._infer_raw, model_input, **kwargs)
        try:
            raw_score = float(future.result(timeout=timeout_seconds))
        except FutureTimeoutError as error:
            future.cancel()
            self._readiness = ModelReadiness.ERROR
            executor.shutdown(wait=False, cancel_futures=True)
            raise ModelAdapterError(ModelErrorCode.MODEL_INFERENCE_TIMEOUT) from error
        except ModelAdapterError:
            executor.shutdown(wait=True, cancel_futures=True)
            raise
        except Exception as error:
            self._readiness = ModelReadiness.ERROR
            executor.shutdown(wait=True, cancel_futures=True)
            raise ModelAdapterError(ModelErrorCode.MODEL_INFERENCE_FAILED) from error
        executor.shutdown(wait=True, cancel_futures=True)
        elapsed_ms = (perf_counter() - started) * 1000.0
        return ModelInferenceResult(
            metadata=self.metadata,
            raw_score=raw_score,
            processing_latency_ms=elapsed_ms,
            window_id=model_input.window_id,
            sequence=model_input.sequence,
            start_ms=model_input.start_ms,
            end_ms=model_input.end_ms,
            preprocessing_version=model_input.preprocessing_version,
        )

    @abstractmethod
    def close(self) -> None:
        """Release model resources and mark the adapter closed."""

    def _mark_ready(self) -> None:
        with self._state_lock:
            if self._readiness is ModelReadiness.CLOSED:
                raise ModelAdapterError(ModelErrorCode.MODEL_ALREADY_CLOSED)
            self._readiness = ModelReadiness.READY

    def _mark_closed(self) -> None:
        with self._state_lock:
            self._readiness = ModelReadiness.CLOSED
