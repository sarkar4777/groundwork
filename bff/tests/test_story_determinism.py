"""The same seed and the same inputs give the same take, step for step, in any process."""

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

from twin.api import run

SCRIPT = {38: [{"kind": "worker_in_swing", "target": "EX1", "worker": "W07", "start_m": 17.5, "speed": 1.6}],
          360: [{"kind": "gust", "build_s": 5.0, "hold_s": 6.0, "peak_ms": 11.5}],
          560: [{"kind": "ai_offline", "on": True}], 692: [{"kind": "ai_offline", "on": False}]}


def take(rules, steps=1200):
    st = run({"op": "init", "seed": 2026})["state_z"]
    h = hashlib.sha256()
    events = []
    for k in range(steps):
        inp = {"op": "step", "state_z": st, "ticks": 5}
        if k == 0:
            inp["rules"] = rules
        if k in SCRIPT:
            inp["faults"] = SCRIPT[k]
        out = run(json.loads(json.dumps(inp)))
        st = out["state_z"]
        h.update(json.dumps(out["frame"], sort_keys=True).encode())
        events += [(e["t"], e["kind"], e.get("machine"), e["title"]) for e in out["events"]]
    return h.hexdigest(), events


def test_two_takes_are_identical(rules):
    a = take(rules)
    b = take(rules)
    assert a == b
    stops = [e for e in a[1] if e[1] == "safety_stop" and e[2] == "EX1"]
    assert stops and 3.5 <= stops[0][0] <= 5.0


def test_identical_in_another_process(rules):
    here = take(rules, 300)[0]
    code = ("import sys,json; sys.path.insert(0, %r); sys.path.insert(0, %r); from test_story_determinism import take; "
            "from conftest import load_rules; print(take(load_rules(), 300)[0])") % (
        str(Path(__file__).parent), str(Path(__file__).resolve().parents[2] / "abenix" / "code-assets" / "gw-site-twin"))
    env = dict(os.environ, PYTHONHASHSEED="12345")
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=env, cwd=str(Path(__file__).parent))
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip().splitlines()[-1] == here
