"""Authenticated, time-bounded, replay-resistant internal request verification."""

from __future__ import annotations

import hashlib
import hmac
import time
from collections import OrderedDict
from dataclasses import dataclass
from threading import Lock

from fastapi import Request

from app.core.config import MlSettings


class ServiceAuthenticationError(RuntimeError):
    def __init__(self, code: str, status_code: int = 401) -> None:
        self.code = code
        self.status_code = status_code
        super().__init__(code)


@dataclass(frozen=True)
class VerifiedServiceRequest:
    service_id: str
    idempotency_key: str
    nonce: str


class NonceReplayCache:
    def __init__(self, *, maximum_entries: int, ttl_seconds: int) -> None:
        self._maximum_entries = maximum_entries
        self._ttl_seconds = ttl_seconds
        self._entries: OrderedDict[str, int] = OrderedDict()
        self._lock = Lock()

    def consume(self, nonce: str, timestamp: int) -> None:
        now = int(time.time())
        with self._lock:
            while self._entries:
                _, oldest = next(iter(self._entries.items()))
                if now - oldest <= self._ttl_seconds:
                    break
                self._entries.popitem(last=False)
            if nonce in self._entries:
                raise ServiceAuthenticationError("INTERNAL_AUTH_REPLAY_DETECTED", 409)
            self._entries[nonce] = timestamp
            while len(self._entries) > self._maximum_entries:
                self._entries.popitem(last=False)


class BackendRequestAuthenticator:
    def __init__(self, settings: MlSettings) -> None:
        self._secret = settings.internal_secret.get_secret_value()
        self._skew = settings.internal_auth_clock_skew_seconds
        self._nonces = NonceReplayCache(
            maximum_entries=settings.auth_nonce_cache_max,
            ttl_seconds=settings.internal_auth_clock_skew_seconds * 2,
        )

    async def authenticate(self, request: Request) -> VerifiedServiceRequest:
        headers = request.headers
        authorization = headers.get("authorization", "")
        service = headers.get("x-swar-service", "")
        timestamp_text = headers.get("x-swar-timestamp", "")
        nonce = headers.get("x-swar-nonce", "")
        signature = headers.get("x-swar-signature", "")
        idempotency_key = headers.get("idempotency-key", "")
        supplied = authorization[7:] if authorization.startswith("Bearer ") else ""
        if (
            service != "swar-backend"
            or not supplied
            or not hmac.compare_digest(supplied, self._secret)
        ):
            raise ServiceAuthenticationError("INTERNAL_AUTH_INVALID")
        if not timestamp_text.isdigit() or len(nonce) < 8 or len(idempotency_key) < 8:
            raise ServiceAuthenticationError("INTERNAL_AUTH_HEADERS_INVALID")
        timestamp = int(timestamp_text)
        if abs(int(time.time()) - timestamp) > self._skew:
            raise ServiceAuthenticationError("INTERNAL_AUTH_CREDENTIAL_EXPIRED")
        body = await request.body()
        body_hash = hashlib.sha256(body).hexdigest()
        canonical = "\n".join(
            [request.method, request.url.path, timestamp_text, nonce, idempotency_key, body_hash]
        )
        expected = hmac.new(
            self._secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256
        ).hexdigest()
        if len(signature) != 64 or not hmac.compare_digest(signature, expected):
            raise ServiceAuthenticationError("INTERNAL_AUTH_SIGNATURE_INVALID")
        self._nonces.consume(nonce, timestamp)
        return VerifiedServiceRequest(
            service_id=service,
            idempotency_key=idempotency_key,
            nonce=nonce,
        )


async def authenticate_backend_request(request: Request) -> VerifiedServiceRequest:
    authenticator: BackendRequestAuthenticator = request.app.state.backend_authenticator
    return await authenticator.authenticate(request)
