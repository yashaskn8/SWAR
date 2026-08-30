"""Bounded authenticated and idempotent ML-to-NestJS evidence delivery."""

from __future__ import annotations

import asyncio
from collections import OrderedDict, deque
from dataclasses import dataclass
from uuid import UUID

import httpx
from pydantic import BaseModel, ConfigDict, Field

from app.core.config import MlSettings
from app.core.telemetry import Telemetry
from app.schemas.analysis import EvidenceEvent


class EvidenceDeliveryError(RuntimeError):
    def __init__(self, code: str, status_code: int | None = None) -> None:
        self.code = code
        self.status_code = status_code
        super().__init__(code)


class EvidenceAcceptance(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", populate_by_name=True)
    evidence_event_id: UUID = Field(alias="evidenceEventId")
    event_id: UUID = Field(alias="eventId")
    acceptance_status: str = Field(alias="acceptanceStatus", pattern=r"^(ACCEPTED|STALE)$")


@dataclass(frozen=True)
class DeadLetterDiagnostic:
    event_id: UUID
    error_code: str


class EvidenceClient:
    def __init__(
        self,
        settings: MlSettings,
        telemetry: Telemetry,
        *,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.settings = settings
        self.telemetry = telemetry
        self._client = client or httpx.AsyncClient()
        self._owns_client = client is None
        self._accepted: OrderedDict[UUID, EvidenceAcceptance] = OrderedDict()
        self._dead_letters: deque[DeadLetterDiagnostic] = deque(maxlen=256)
        self._closed = False

    @property
    def dead_letters(self) -> tuple[DeadLetterDiagnostic, ...]:
        return tuple(self._dead_letters)

    async def send(self, event: EvidenceEvent) -> EvidenceAcceptance:
        if self._closed:
            raise EvidenceDeliveryError("EVIDENCE_CLIENT_CLOSED")
        cached = self._accepted.get(event.event_id)
        if cached is not None:
            self.telemetry.increment("swar_ml_duplicate_delivery_total")
            return cached
        headers = {
            "Authorization": (f"Bearer {self.settings.internal_secret.get_secret_value()}"),
            "X-SWAR-Service": "swar-ml",
            "Idempotency-Key": str(event.event_id),
        }
        last_error = "BACKEND_CALLBACK_UNAVAILABLE"
        for attempt in range(1, self.settings.callback_max_attempts + 1):
            try:
                response = await self._client.post(
                    self.settings.backend_evidence_url,
                    json=event.callback_body(),
                    headers=headers,
                    timeout=self.settings.callback_timeout_seconds,
                )
            except (httpx.TimeoutException, httpx.TransportError):
                response = None
            if response is not None and response.status_code == 202:
                try:
                    acceptance = EvidenceAcceptance.model_validate(response.json())
                except Exception as error:
                    raise EvidenceDeliveryError("BACKEND_CALLBACK_RESPONSE_INVALID") from error
                if acceptance.event_id != event.event_id:
                    raise EvidenceDeliveryError("BACKEND_CALLBACK_RESPONSE_MISMATCH")
                self._accepted[event.event_id] = acceptance
                while len(self._accepted) > 10_000:
                    self._accepted.popitem(last=False)
                return acceptance
            if response is not None and response.status_code < 500 and response.status_code != 429:
                raise EvidenceDeliveryError(
                    "BACKEND_CALLBACK_REJECTED", status_code=response.status_code
                )
            if attempt < self.settings.callback_max_attempts:
                self.telemetry.increment("swar_ml_evidence_retries_total")
                await asyncio.sleep(self.settings.reconnect_backoff_ms * attempt / 1000)
        self._dead_letters.append(
            DeadLetterDiagnostic(event_id=event.event_id, error_code=last_error)
        )
        self.telemetry.increment("swar_ml_evidence_delivery_failures_total", last_error)
        raise EvidenceDeliveryError(last_error)

    async def close(self) -> None:
        self._closed = True
        self._accepted.clear()
        self._dead_letters.clear()
        if self._owns_client:
            await self._client.aclose()
