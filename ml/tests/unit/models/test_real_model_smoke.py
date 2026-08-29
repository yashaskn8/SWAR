from __future__ import annotations

import os
from pathlib import Path

import pytest

from experiments.run_experiment import run_cpu_smoke


@pytest.mark.real_models
def test_all_pinned_models_load_and_infer_on_cpu() -> None:
    if os.environ.get("SWAR_RUN_REAL_MODEL_TESTS") != "1":
        pytest.skip("set SWAR_RUN_REAL_MODEL_TESTS=1 with locally fetched verified artifacts")
    checkpoint_root = Path(__file__).parents[3] / "checkpoints"
    result = run_cpu_smoke(registry_path=None, checkpoint_root=checkpoint_root)
    assert result.status == "COMPLETED_ENGINEERING_COMPATIBILITY_ONLY"
    assert result.claim_status == "NO_SCIENTIFIC_PERFORMANCE_CLAIM"
    assert [model.model_id for model in result.models] == ["ecapa-tdnn", "rawnet2", "aasist"]
    assert all(model.readiness_after_close == "CLOSED" for model in result.models)
