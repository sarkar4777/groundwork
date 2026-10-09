"""The bff with Abenix down: lanes open their breakers, nothing hangs, the UI hears why."""

import asyncio
import time

import pytest

from gwbff.engine import Engine, unwrap
from gwbff.lanes import Lane, Open


class FakeHub:
    def __init__(self):
        self.frames = []

    async def send(self, frame):
        self.frames.append(frame)


async def _boom():
    raise ConnectionError("Abenix down")


async def test_breaker_opens_and_fails_fast():
    lane = Lane("twin", timeout_s=1.0, threshold=3, cooldown_s=0.3)
    for _ in range(3):
        with pytest.raises(ConnectionError):
            await lane.call(_boom)
    assert lane.state == "open"
    t0 = time.perf_counter()
    with pytest.raises(Open):
        await lane.call(_boom)
    assert time.perf_counter() - t0 < 0.01
    await asyncio.sleep(0.35)

    async def ok():
        return 1
    assert await lane.call(ok) == 1
    assert lane.state == "closed"


async def test_half_open_failure_reopens():
    lane = Lane("ml", timeout_s=1.0, threshold=1, cooldown_s=0.05)
    with pytest.raises(ConnectionError):
        await lane.call(_boom)
    await asyncio.sleep(0.06)
    with pytest.raises(ConnectionError):
        await lane.call(_boom)
    assert lane.state == "open"


async def test_timeout_counts_as_failure():
    lane = Lane("agents", timeout_s=0.05, threshold=1, cooldown_s=10)

    async def slow():
        await asyncio.sleep(1)
    with pytest.raises(asyncio.TimeoutError):
        await lane.call(slow)
    assert lane.state == "open"


async def test_engine_with_abenix_unreachable():
    hub = FakeHub()
    eng = Engine({"abenix_url": "http://127.0.0.1:9", "abenix_web": "", "api_key": "x", "seed": 1}, hub)
    task = asyncio.create_task(eng.run())
    for _ in range(100):
        await asyncio.sleep(0.1)
        if eng.status != "starting":
            break
    task.cancel()
    assert not eng.ready
    assert eng.status.startswith("waiting for Abenix")
    assert any(f.get("kind") == "fault" and "unreachable" in f.get("title", "") for f in hub.frames)
    await eng.forge.close()


async def test_ai_offline_never_calls_abenix():
    hub = FakeHub()
    eng = Engine({"abenix_url": "http://127.0.0.1:9", "abenix_web": "", "api_key": "x", "seed": 1}, hub)
    eng.ai_offline = True
    t0 = time.perf_counter()
    out, res = await eng.run_agent("gw-site-superintendent", "{}")
    assert out is None and res is None
    assert time.perf_counter() - t0 < 0.05
    assert eng.lanes["agents"].calls == 0
    assert hub.frames[-1]["phase"] == "answer" and "AI offline" in hub.frames[-1]["text"]
    await eng.forge.close()


def test_unwrap_pipeline_answers():
    assert unwrap('{"response": "Done.\\n```json\\n{\\"lesson\\": \\"x\\"}\\n```", "cost": 0, "model": "m"}') == {"lesson": "x"}
    assert unwrap({"result": {"ok": True, "assignments": []}, "schema_ok": True}) == {"ok": True, "assignments": []}
    assert unwrap("prose") == {"text": "prose"}
