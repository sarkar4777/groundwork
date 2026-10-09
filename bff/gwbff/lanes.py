"""Calls to Abenix in lanes, each with a timeout, a circuit breaker and its own latency record."""

from __future__ import annotations

import asyncio
import time
from collections import deque


class Rolling:
    """Last n samples in ms, for percentiles."""

    def __init__(self, n: int = 200, window_s: float | None = None):
        self.samples: deque = deque(maxlen=n)
        self.window_s = window_s

    def add(self, ms: float) -> None:
        self.samples.append((time.monotonic(), ms))

    def values(self) -> list:
        if self.window_s is None:
            return [v for _, v in self.samples]
        cut = time.monotonic() - self.window_s
        return [v for t, v in self.samples if t >= cut]

    def pct(self, p: float, last: int | None = None) -> float | None:
        v = self.values()
        if last:
            v = v[-last:]
        if not v:
            return None
        v = sorted(v)
        return round(v[min(len(v) - 1, int(p * len(v)))], 2)

    def last(self) -> float | None:
        return round(self.samples[-1][1], 2) if self.samples else None


class Open(Exception):
    pass


class Lane:
    """closed: calls go through. open: calls fail at once for cooldown_s. half_open: one trial call."""

    def __init__(self, name: str, timeout_s: float, threshold: int = 3, cooldown_s: float = 10.0):
        self.name = name
        self.timeout_s = timeout_s
        self.threshold = threshold
        self.cooldown_s = cooldown_s
        self.failures = 0
        self.opened_at: float | None = None
        self.state = "closed"
        self.latency = Rolling()
        self.calls = 0
        self.errors = 0
        self.last_error = ""

    def _admit(self) -> None:
        if self.state == "open":
            if time.monotonic() - (self.opened_at or 0) >= self.cooldown_s:
                self.state = "half_open"
            else:
                raise Open(f"{self.name} circuit open: {self.last_error}")

    async def call(self, coro_fn, timeout_s: float | None = None):
        self._admit()
        self.calls += 1
        t0 = time.perf_counter()
        try:
            out = await asyncio.wait_for(coro_fn(), timeout_s or self.timeout_s)
        except Exception as e:  # noqa: BLE001
            self.errors += 1
            self.failures += 1
            self.last_error = f"{type(e).__name__}: {str(e)[:160]}"
            if self.state == "half_open" or self.failures >= self.threshold:
                self.state = "open"
                self.opened_at = time.monotonic()
            raise
        self.latency.add((time.perf_counter() - t0) * 1000)
        self.failures = 0
        self.state = "closed"
        return out

    def info(self) -> dict:
        return {"state": self.state, "calls": self.calls, "errors": self.errors, "last_error": self.last_error,
                "p50_ms": self.latency.pct(0.5, 50), "p99_ms": self.latency.pct(0.99, 200)}
