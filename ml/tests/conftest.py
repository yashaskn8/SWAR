from __future__ import annotations

import os
from pathlib import Path

ML_ROOT = Path(__file__).parents[1]

TEST_ENVIRONMENT = {
    "APP_ENV": "test",
    "ML_PROVIDER": "stub",
    "ML_EVIDENCE_MODE": "SIMULATED",
    "ML_INTERNAL_SECRET": "phase-p-test-internal-secret-1234567890",
    "BACKEND_EVIDENCE_URL": "http://127.0.0.1:3000/api/v1/internal/ml/evidence",
    "LIVEKIT_URL": "ws://127.0.0.1:7880",
    "ML_CHECKPOINT_ROOT": str(ML_ROOT / "checkpoints"),
    "ML_MODEL_REGISTRY_PATH": str(ML_ROOT / "config" / "model_registry.yaml"),
    "ML_AUDIO_CONFIG_PATH": str(ML_ROOT / "config" / "audio.yaml"),
    "ML_CALIBRATION_PATH": str(ML_ROOT / "config" / "calibration.json"),
    "ML_MAX_CONCURRENT_SESSIONS": "2",
    "ML_FRAME_QUEUE_MAX": "4",
    "ML_WINDOW_QUEUE_MAX": "2",
    "ML_EVIDENCE_QUEUE_MAX": "8",
    "ML_MODEL_TIMEOUT_SECONDS": "1",
    "ML_TRACK_BINDING_TIMEOUT_SECONDS": "0.1",
    "ML_CALLBACK_TIMEOUT_SECONDS": "1",
    "ML_CALLBACK_MAX_ATTEMPTS": "2",
    "ML_RECONNECT_MAX_ATTEMPTS": "2",
    "ML_RECONNECT_BACKOFF_MS": "10",
    "INTERNAL_AUTH_CLOCK_SKEW_SECONDS": "30",
    "ML_AUTH_NONCE_CACHE_MAX": "1000",
    "ML_STALE_WINDOW_AFTER_MS": "8000",
    "ML_MODEL_DEVICE": "cpu",
}

for name, value in TEST_ENVIRONMENT.items():
    os.environ.setdefault(name, value)
