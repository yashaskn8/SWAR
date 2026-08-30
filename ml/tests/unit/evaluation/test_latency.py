from __future__ import annotations

from evaluation.run_latency import LatencyObservation, summarize_latency


def _observation(stage: str, latency: float) -> LatencyObservation:
    return LatencyObservation(
        hardware_profile_id="generated-test-hardware",
        cpu_model="generated-test-cpu",
        operating_system="generated-test-os",
        runtime_version="generated-test-runtime",
        device="cpu",
        stage=stage,
        warm_state="WARM",
        latency_ms=latency,
        peak_memory_bytes=1024,
        concurrency=1,
        registry_sha256="a" * 64,
        preprocessing_version="phase-l-test",
    )


def test_latency_keeps_required_stages_separate() -> None:
    result = summarize_latency(
        tuple(
            _observation(stage, latency)
            for stage, latency in (
                ("preprocessing", 1.0),
                ("ecapa_inference", 2.0),
                ("rawnet2_inference", 3.0),
                ("aasist_inference", 4.0),
            )
        )
    )

    assert result["end_to_end_present"] is False
    assert result["stages"]["rawnet2_inference:WARM"]["p95_ms"] == 3.0
    assert result["status"] == "MEASURED_NAMED_HARDWARE_NOT_A_UNIVERSAL_TARGET"
