"""Low-cardinality telemetry that never labels tenant, call, audio, or token content."""

from __future__ import annotations

from collections import defaultdict
from threading import Lock


class Telemetry:
    def __init__(self) -> None:
        self._counters: defaultdict[tuple[str, str], float] = defaultdict(float)
        self._gauges: defaultdict[tuple[str, str], float] = defaultdict(float)
        self._lock = Lock()

    def increment(self, metric: str, label: str = "all", value: float = 1.0) -> None:
        with self._lock:
            self._counters[(metric, label)] += value

    def gauge(self, metric: str, label: str, value: float) -> None:
        with self._lock:
            self._gauges[(metric, label)] = value

    def observe_latency(self, path: str, milliseconds: float) -> None:
        self.increment("swar_ml_inference_latency_ms_count", path)
        self.increment("swar_ml_inference_latency_ms_sum", path, max(0.0, milliseconds))

    def render_prometheus(self) -> str:
        with self._lock:
            rows = []
            for (metric, label), value in sorted(self._counters.items()):
                rows.append(f'{metric}{{category="{label}"}} {value:g}')
            for (metric, label), value in sorted(self._gauges.items()):
                rows.append(f'{metric}{{queue="{label}"}} {value:g}')
        return "\n".join(rows) + ("\n" if rows else "")
