"""Truck dispatch: assign each free truck to the excavator that gets it loaded and back soonest.

A small assignment search instead of OR-Tools, so the asset needs nothing installed. With at most
six trucks and two excavators every assignment of the free trucks is tried (2^6 = 64 at most).
"""

from __future__ import annotations

import itertools
import json

FREE = ("return", "to_queue", "dump", "offsite")
LOAD_MIN = {"EX1": 1.8, "EX2": 2.2}


def _numbers(x):
    """The cycle-time predictions in whatever envelope the ml_model step returned."""
    if isinstance(x, str):
        try:
            x = json.loads(x)
        except ValueError:
            return []
    if isinstance(x, dict):
        for k in ("predictions", "result", "output", "data"):
            if k in x:
                got = _numbers(x[k])
                if got:
                    return got
        return []
    if isinstance(x, list):
        if x and all(isinstance(v, (int, float)) for v in x):
            return [float(v) for v in x]
        if x and all(isinstance(v, list) and len(v) == 1 and isinstance(v[0], (int, float)) for v in x):
            return [float(v[0]) for v in x]
        if len(x) == 1:
            return _numbers(x[0])
    return []


def run(inp: dict) -> dict:
    facts = inp.get("facts") or {}
    if isinstance(facts, str):
        facts = json.loads(facts)
    trucks = facts.get("trucks") or []
    pred = _numbers(inp.get("predicted"))
    rows = facts.get("cycle_rows") or []
    if len(pred) != len(rows) or len(rows) != 2 * len(trucks):
        return {"ok": False, "error": f"expected {2 * len(trucks)} predictions, got {len(pred)}", "assignments": []}
    minutes = {t["id"]: {"EX1": pred[2 * i], "EX2": pred[2 * i + 1]} for i, t in enumerate(trucks)}
    queues = dict(facts.get("queues") or {"EX1": 0, "EX2": 0})
    free = [t for t in trucks if t.get("phase") in FREE]
    for t in trucks:
        if t.get("phase") in FREE and t.get("assigned") in queues:
            queues[t["assigned"]] = max(0, queues[t["assigned"]] - 1)
    best, best_cost = None, None
    for combo in itertools.product(("EX1", "EX2"), repeat=len(free)):
        q = dict(queues)
        cost = 0.0
        worst = 0.0
        for t, ex in zip(free, combo):
            wait = q[ex] * LOAD_MIN[ex] * 6 / 6
            c = minutes[t["id"]][ex] + wait
            q[ex] += 1
            cost += c
            worst = max(worst, c)
        total = cost + 0.5 * worst
        if best_cost is None or total < best_cost:
            best, best_cost = combo, total
    out = []
    for t, ex in zip(free, best or ()):
        out.append({"truck": t["id"], "ex": ex, "dest": "spoil", "minutes": round(minutes[t["id"]][ex], 2),
                    "changed": ex != t.get("assigned"), "from": t.get("assigned")})
    return {"ok": True, "assignments": out, "objective_min": round(best_cost or 0.0, 2), "free_trucks": len(free),
            "searched": 2 ** len(free), "method": "exhaustive assignment over free trucks"}
