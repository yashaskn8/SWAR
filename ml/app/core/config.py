"""Fail-closed Phase P runtime configuration."""

from __future__ import annotations

from collections.abc import Mapping
from enum import StrEnum
from pathlib import Path
from typing import Self
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator


class EvidenceMode(StrEnum):
    SIMULATED = "SIMULATED"
    SHADOW = "SHADOW"
    CALIBRATED = "CALIBRATED"


class ConfigurationError(RuntimeError):
    """Stable configuration failure without values or paths."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class MlSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    app_env: str = Field(pattern=r"^(development|test|production)$")
    provider: str = Field(pattern=r"^(real|stub|fixture)$")
    evidence_mode: EvidenceMode
    internal_secret: SecretStr
    backend_evidence_url: str
    livekit_url: str
    checkpoint_root: Path
    model_registry_path: Path
    audio_config_path: Path
    calibration_path: Path
    max_concurrent_sessions: int = Field(ge=1, le=64)
    frame_queue_max: int = Field(ge=1, le=512)
    window_queue_max: int = Field(ge=1, le=64)
    evidence_queue_max: int = Field(ge=1, le=512)
    model_timeout_seconds: float = Field(gt=0.05, le=60)
    track_binding_timeout_seconds: float = Field(gt=0.05, le=30)
    callback_timeout_seconds: float = Field(gt=0.05, le=30)
    callback_max_attempts: int = Field(ge=1, le=5)
    reconnect_max_attempts: int = Field(ge=1, le=5)
    reconnect_backoff_ms: int = Field(ge=10, le=5_000)
    internal_auth_clock_skew_seconds: int = Field(ge=1, le=300)
    auth_nonce_cache_max: int = Field(ge=100, le=100_000)
    stale_window_after_ms: int = Field(ge=1_000, le=60_000)
    model_device: str = Field(pattern=r"^(auto|cpu|cuda)$")

    @model_validator(mode="after")
    def validate_security(self) -> Self:
        secret = self.internal_secret.get_secret_value()
        if len(secret.encode("utf-8")) < 32 or "replace_with" in secret.lower():
            raise ValueError("ML_INTERNAL_SECRET_INVALID")
        backend = urlparse(self.backend_evidence_url)
        livekit = urlparse(self.livekit_url)
        if backend.scheme not in {"http", "https"} or not backend.hostname:
            raise ValueError("BACKEND_EVIDENCE_URL_INVALID")
        if livekit.scheme not in {"ws", "wss"} or not livekit.hostname:
            raise ValueError("LIVEKIT_URL_INVALID")
        if self.app_env == "production" and (backend.scheme != "https" or livekit.scheme != "wss"):
            raise ValueError("PRODUCTION_TRANSPORT_INSECURE")
        if self.provider == "stub" and self.app_env == "production":
            raise ValueError("STUB_FORBIDDEN_IN_PRODUCTION")
        if self.evidence_mode is EvidenceMode.SIMULATED and self.provider != "stub":
            raise ValueError("SIMULATED_MODE_REQUIRES_STUB")
        if self.provider == "stub" and self.evidence_mode is not EvidenceMode.SIMULATED:
            raise ValueError("STUB_REQUIRES_SIMULATED_MODE")
        return self

    @classmethod
    def from_environment(cls, source: Mapping[str, str]) -> Self:
        required = {
            "APP_ENV": "app_env",
            "ML_PROVIDER": "provider",
            "ML_EVIDENCE_MODE": "evidence_mode",
            "ML_INTERNAL_SECRET": "internal_secret",
            "BACKEND_EVIDENCE_URL": "backend_evidence_url",
            "LIVEKIT_URL": "livekit_url",
            "ML_CHECKPOINT_ROOT": "checkpoint_root",
            "ML_MODEL_REGISTRY_PATH": "model_registry_path",
            "ML_AUDIO_CONFIG_PATH": "audio_config_path",
            "ML_CALIBRATION_PATH": "calibration_path",
            "ML_MAX_CONCURRENT_SESSIONS": "max_concurrent_sessions",
            "ML_FRAME_QUEUE_MAX": "frame_queue_max",
            "ML_WINDOW_QUEUE_MAX": "window_queue_max",
            "ML_EVIDENCE_QUEUE_MAX": "evidence_queue_max",
            "ML_MODEL_TIMEOUT_SECONDS": "model_timeout_seconds",
            "ML_TRACK_BINDING_TIMEOUT_SECONDS": "track_binding_timeout_seconds",
            "ML_CALLBACK_TIMEOUT_SECONDS": "callback_timeout_seconds",
            "ML_CALLBACK_MAX_ATTEMPTS": "callback_max_attempts",
            "ML_RECONNECT_MAX_ATTEMPTS": "reconnect_max_attempts",
            "ML_RECONNECT_BACKOFF_MS": "reconnect_backoff_ms",
            "INTERNAL_AUTH_CLOCK_SKEW_SECONDS": "internal_auth_clock_skew_seconds",
        }
        missing = sorted(name for name in required if not source.get(name, "").strip())
        if missing:
            raise ConfigurationError("ML_CONFIGURATION_MISSING:" + ",".join(missing))
        values = {field: source[name].strip() for name, field in required.items()}
        values.update(
            {
                "auth_nonce_cache_max": source.get("ML_AUTH_NONCE_CACHE_MAX", "10000"),
                "stale_window_after_ms": source.get("ML_STALE_WINDOW_AFTER_MS", "8000"),
                "model_device": source.get("ML_MODEL_DEVICE", "cpu").strip().lower(),
            }
        )
        try:
            return cls.model_validate(values)
        except Exception as error:
            raise ConfigurationError("ML_CONFIGURATION_INVALID") from error
