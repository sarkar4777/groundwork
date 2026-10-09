"""The ops the twin answers. One JSON object in, one out."""

from __future__ import annotations

import base64
import json
import time
import zlib

from . import layout as L
from . import terrain as T
from . import world as W


def pack(st: dict) -> str:
    return base64.b64encode(zlib.compress(json.dumps(st, separators=(",", ":")).encode(), 1)).decode()


def unpack(s: str) -> dict:
    return json.loads(zlib.decompress(base64.b64decode(s)))


def run(inp: dict) -> dict:
    """The site state travels as state_z, compressed JSON, so a step stays small on the wire."""
    op = inp.get("op", "step")
    if inp.get("state_z"):
        inp["state"] = unpack(inp.pop("state_z"))
    t0 = time.perf_counter()
    if op == "init":
        st = W.init_state(int(inp.get("seed", 42)))
        out = {"state": st, "frame": None, "site": L.site()}
    elif op == "step":
        st = inp.get("state") or W.init_state(int(inp.get("seed", 42)))
        out = W.step(st, inp)
    elif op == "site":
        out = L.site()
    elif op == "terrain":
        st = inp["state"]
        out = T.export(T.decode(st["terrain"]["delta"]), W.initial_delta())
        out["rev"] = st["terrain"]["rev"]
    elif op == "check_plan":
        out = W.check_plan(inp["state"], inp.get("tree"))
    elif op == "brief":
        out = W.brief(inp["state"])
    elif op == "aemp":
        out = W.aemp(inp["state"])
    elif op == "dataset":
        from . import dataset
        out = dataset.build(inp)
    else:
        raise ValueError(f"unknown op {op}")
    if isinstance(out, dict):
        if op in ("init", "step") and not inp.get("raw_state"):
            out["state_z"] = pack(out.pop("state"))
        out.setdefault("op", op)
        out["run_ms"] = round((time.perf_counter() - t0) * 1000, 2)
    return out
