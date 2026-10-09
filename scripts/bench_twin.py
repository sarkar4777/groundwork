"""Benchmark the site twin step.

    python scripts/bench_twin.py local     # the step's own compute, in this process
    python scripts/bench_twin.py abenix    # the real path: SDK code_assets.run into the warm runner

Reports per step (5 ticks of 10 ms) and per tick, p50, p99 and max.
"""

from __future__ import annotations

import asyncio
import glob
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "abenix" / "code-assets" / "gw-site-twin"))
sys.path.insert(0, str(ROOT / "bff" / "vendor"))


def rules():
    out = {}
    for p in glob.glob(str(ROOT / "abenix" / "decisions" / "*.json")):
        d = json.loads(Path(p).read_text())
        out[d["key"]] = {"key": d["key"], "version": 1, "rules": d["rules"]}
    return out


def pct(v, p):
    v = sorted(v)
    return v[min(len(v) - 1, int(p * len(v)))]


def show(name, v, ticks=5):
    print(f"{name:<34} n={len(v):<5} p50 {pct(v, .5):7.2f} ms  p99 {pct(v, .99):7.2f} ms  max {max(v):7.2f} ms  per tick p99 {pct(v, .99) / ticks:6.3f} ms")


def local(n):
    from twin.api import run
    st = run({"op": "init", "seed": 42})["state_z"]
    wall, inside, safety = [], [], []
    for k in range(n):
        inp = {"op": "step", "state_z": st, "ticks": 5}
        if k == 0:
            inp["rules"] = rules()
        raw = json.dumps(inp)
        t0 = time.perf_counter()
        out = run(json.loads(raw))
        json.dumps(out)
        wall.append((time.perf_counter() - t0) * 1000)
        inside.append(out["stats"]["run_ms"])
        safety.append(out["stats"]["safety_us_p99"] / 1000)
        st = out["state_z"]
    show("step incl. state pack and JSON", wall)
    show("step compute (twin run_ms)", inside)
    show("safety rules per tick (p99 in step)", safety, 1)


async def abenix(n):
    from abenix_sdk import Abenix
    env = dict(line.split("=", 1) for line in (ROOT / ".env").read_text().splitlines() if "=" in line)
    async with Abenix(api_key=env["ABENIX_API_KEY"].strip(), base_url=env.get("ABENIX_URL", "http://localhost:8000").strip()) as f:
        aid = next(a["id"] for a in await f.code_assets.list() if a["name"] == "gw-site-twin")
        r = await f.code_assets.run(aid, {"op": "init", "seed": 42}, timeout=300)
        st = json.loads(r["content"])["result"]["state_z"] if isinstance(r["content"], str) else r["content"]["result"]["state_z"]
        rtt, run_ms, runner = [], [], {}
        for k in range(n):
            inp = {"op": "step", "state_z": st, "ticks": 5}
            if k == 0:
                inp["rules"] = rules()
            t0 = time.perf_counter()
            r = await f.code_assets.run(aid, inp, timeout=30)
            rtt.append((time.perf_counter() - t0) * 1000)
            c = r["content"]
            c = json.loads(c) if isinstance(c, str) else c
            st = c["result"]["state_z"]
            run_ms.append(c["result"]["stats"]["run_ms"])
            m = r.get("metadata") or {}
            runner[m.get("runner")] = runner.get(m.get("runner"), 0) + 1
        print("payload in", len(json.dumps(inp)), "B, out", len(json.dumps(c)), "B, runners", runner)
        show("SDK round trip (l1)", rtt)
        show("twin compute inside the runner", run_ms)
        print(f"sustained step rate {1000 / (sum(rtt) / len(rtt)):.1f} Hz, sim speed at 5 ticks per step {5 * 10 / (sum(rtt) / len(rtt)):.2f}x")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "local"
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 1000
    if mode == "local":
        local(n)
    else:
        asyncio.run(abenix(n))
