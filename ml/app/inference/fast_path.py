"""FAST model orchestration with transient input and reference zeroization."""

from __future__ import annotations

import asyncio
import hashlib
from dataclasses import dataclass
from time import perf_counter
from typing import Protocol
from uuid import UUID

from app.models.interfaces import ModelInferenceResult, ModelInput, SensitiveEmbedding
from app.models.registry import ModelRegistry


@dataclass(frozen=True)
class TechnicalResult:
    capability: str
    model_name: str
    model_version: str
    checkpoint_sha256: str
    score_name: str
    score_direction: str
    raw_score: float
    processing_latency_ms: int

    @classmethod
    def from_adapter(cls, result: ModelInferenceResult) -> TechnicalResult:
        return cls(
            capability=result.metadata.capability.value,
            model_name=result.metadata.model_name,
            model_version=result.metadata.model_version,
            checkpoint_sha256=result.metadata.checkpoint_sha256,
            score_name=result.metadata.score_name,
            score_direction=result.metadata.score_direction.value,
            raw_score=result.raw_score,
            processing_latency_ms=max(0, round(result.processing_latency_ms)),
        )


class VoiceprintResolver(Protocol):
    async def resolve(self, reference: UUID) -> SensitiveEmbedding | None: ...


class InferenceRuntime(Protocol):
    @property
    def ready(self) -> bool: ...

    async def fast(
        self, model_input: ModelInput, voiceprint_reference: UUID | None
    ) -> tuple[TechnicalResult, ...]: ...

    async def deep(self, model_input: ModelInput) -> TechnicalResult: ...

    async def close(self) -> None: ...


class RealModelRuntime:
    def __init__(
        self,
        registry: ModelRegistry,
        *,
        checkpoint_root,
        device: str,
        timeout_seconds: float,
        voiceprints: VoiceprintResolver | None = None,
    ) -> None:
        self._timeout = timeout_seconds
        self._voiceprints = voiceprints
        self._ecapa = registry.create_adapter(
            "ecapa-tdnn", checkpoint_root=checkpoint_root, device=device
        )
        self._rawnet = registry.create_adapter(
            "rawnet2", checkpoint_root=checkpoint_root, device=device
        )
        self._aasist = registry.create_adapter(
            "aasist", checkpoint_root=checkpoint_root, device=device
        )
        self._ready = False

    @property
    def ready(self) -> bool:
        return self._ready

    async def load(self) -> None:
        try:
            await asyncio.to_thread(self._ecapa.load)
            await asyncio.to_thread(self._rawnet.load)
            await asyncio.to_thread(self._aasist.load)
            self._ready = True
        except Exception:
            await self.close()
            raise

    async def fast(
        self, model_input: ModelInput, voiceprint_reference: UUID | None
    ) -> tuple[TechnicalResult, ...]:
        raw = await asyncio.to_thread(
            self._rawnet.infer, model_input, timeout_seconds=self._timeout
        )
        results = [TechnicalResult.from_adapter(raw)]
        if voiceprint_reference is not None and self._voiceprints is not None:
            reference = await self._voiceprints.resolve(voiceprint_reference)
            if reference is not None:
                try:
                    identity = await asyncio.to_thread(
                        self._ecapa.infer,
                        model_input,
                        timeout_seconds=self._timeout,
                        reference=reference,
                    )
                    results.insert(0, TechnicalResult.from_adapter(identity))
                finally:
                    reference.clear()
        return tuple(results)

    async def deep(self, model_input: ModelInput) -> TechnicalResult:
        result = await asyncio.to_thread(
            self._aasist.infer, model_input, timeout_seconds=self._timeout
        )
        return TechnicalResult.from_adapter(result)

    async def close(self) -> None:
        self._ready = False
        await asyncio.gather(
            asyncio.to_thread(self._ecapa.close),
            asyncio.to_thread(self._rawnet.close),
            asyncio.to_thread(self._aasist.close),
            return_exceptions=True,
        )


class SimulatedModelRuntime:
    """Non-scientific deterministic runtime for explicitly simulated demo sessions only."""

    _descriptor = hashlib.sha256(b"SWAR Phase P simulated evidence fixture").hexdigest()

    @property
    def ready(self) -> bool:
        return True

    async def fast(
        self, model_input: ModelInput, voiceprint_reference: UUID | None
    ) -> tuple[TechnicalResult, ...]:
        started = perf_counter()
        output = []
        if voiceprint_reference is not None:
            output.append(self._result("IDENTITY", "SIMULATED_IDENTITY", started))
        output.append(self._result("SPOOF_FAST", "SIMULATED_FAST", started))
        return tuple(output)

    async def deep(self, model_input: ModelInput) -> TechnicalResult:
        return self._result("SPOOF_DEEP", "SIMULATED_DEEP", perf_counter())

    async def close(self) -> None:
        return None

    @classmethod
    def _result(cls, capability: str, name: str, started: float) -> TechnicalResult:
        return TechnicalResult(
            capability=capability,
            model_name=name,
            model_version="phase-p-simulated-v1",
            checkpoint_sha256=cls._descriptor,
            score_name="simulated_non_scientific_raw_score",
            score_direction="HIGHER_IS_MORE_SPOOF",
            raw_score=0.0,
            processing_latency_ms=max(0, round((perf_counter() - started) * 1000)),
        )
