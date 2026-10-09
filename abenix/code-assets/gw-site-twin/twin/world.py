"""Northgate Yard site twin. One step advances the site by n controller ticks of 10 ms.

step(state, inputs) -> outputs is a pure function: the whole site state comes in and goes out,
so any runner can serve any step and a take with the same seed and inputs is identical.
"""

from __future__ import annotations

import math
import time
import zlib

from . import j1939 as J
from . import layout as L
from . import rules as R
from . import sparkplug as SP
from . import terrain as T
from . import vecu as V

DT = 0.01
TWO_PI = 2 * math.pi
SOIL_T_PER_M3 = 1.8
BUCKET_M3 = 2.0
TRUCK_BUCKETS = 6
SHIFT_S = 8 * 3600

RULE_KEYS = ("gw.safety.exclusion", "gw.crane.limits", "gw.truck.speed", "gw.simplex.switch")

_initial_delta = None


def initial_delta():
    global _initial_delta
    if _initial_delta is None:
        _initial_delta = T.initial_delta()
    return _initial_delta


# deterministic randomness carried in the state, splitmix64

def sh(x) -> int:
    return zlib.crc32(str(x).encode())


def rnd(st) -> float:
    z = (st["rng"] + 0x9E3779B97F4A7C15) & 0xFFFFFFFFFFFFFFFF
    st["rng"] = z
    z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & 0xFFFFFFFFFFFFFFFF
    z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & 0xFFFFFFFFFFFFFFFF
    z ^= z >> 31
    return (z >> 11) / float(1 << 53)


def gauss(st) -> float:
    u1 = max(1e-12, rnd(st))
    u2 = rnd(st)
    return math.sqrt(-2.0 * math.log(u1)) * math.cos(TWO_PI * u2)


def wrap(a: float) -> float:
    return math.atan2(math.sin(a), math.cos(a))


def dist(ax, ay, bx, by) -> float:
    return math.hypot(ax - bx, ay - by)


def seg_dist(px, py, ax, ay, bx, by) -> float:
    vx, vy = bx - ax, by - ay
    ln2 = vx * vx + vy * vy
    u = 0.0 if ln2 == 0 else max(0.0, min(1.0, ((px - ax) * vx + (py - ay) * vy) / ln2))
    return math.hypot(px - (ax + u * vx), py - (ay + u * vy))


def seg_seg(a, b, c, d) -> float:
    return min(seg_dist(a[0], a[1], c[0], c[1], d[0], d[1]), seg_dist(b[0], b[1], c[0], c[1], d[0], d[1]),
               seg_dist(c[0], c[1], a[0], a[1], b[0], b[1]), seg_dist(d[0], d[1], a[0], a[1], b[0], b[1]))


# construction of the site

def _machine(mid, kind, x, y, heading=0.0, **kw):
    m = {
        "id": mid, "kind": kind, "x": x, "y": y, "z": 0.0, "heading": heading, "speed": 0.0,
        "mode": "auto", "load_t": 0.0, "fuel_pct": 80.0, "health": "ok", "task": "",
        "sig": {"fuel_l": 260.0 + 30 * (sh(mid) % 5), "tank_l": 400.0, "hours": 1200.0 + 37 * (sh(mid) % 50), "revs": 0.0,
                "rpm": 850.0, "coolant": 82.0, "oil_t": 88.0, "torque": 20.0, "fuel_rate": 6.0, "load": 0.2, "hb": 0,
                "idle_rpm": 850.0, "max_rpm": 1900.0},
        "safety": {"rule": "", "nearest_m": 600.0},
        "gnss": {"fix": 4, "lost_s": 0.0},
        "can": {"cut": False, "silent_s": 0.0},
        "simplex": {"latched": False, "rule": "", "since": None, "hold_since": None},
        "dtcs": [],
        "ecus": list(V.LAYOUT_BY_KIND.get(kind, ())),
        "idle_s": 0.0,
    }
    m.update(kw)
    return m


def _excavator(mid, base, heading, bay, dig_centre):
    m = _machine(mid, "excavator", base[0], base[1], heading, bay=bay, dig_centre=dig_centre, dig_cursor=0,
                 joints={"swing": 0.0, "boom": 0.2, "stick": 0.5, "bucket": 0.4},
                 joints_target={"swing": 0.0, "boom": 0.2, "stick": 0.5, "bucket": 0.4},
                 joints_rate={"swing": 0.0, "boom": 0.0, "stick": 0.0, "bucket": 0.0},
                 phase="dig", phase_t=0.0, bucket_m3=0.0, buckets=0, serving=None, radius=L.EX_SWING_RADIUS, hyd_win=[0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
    m["sig"].update({"idle_rpm": 900.0, "max_rpm": 1800.0, "p1": 40.0, "p2": 35.0, "boom_head": 60.0, "hyd_t": 55.0, "flow": 0.0})
    return m


def _truck(mid, ex, phase, route, s):
    return _machine(mid, "haul_truck", route[0][0], route[0][1], 0.0, phase=phase, route=route, s=s, assign={"ex": ex, "dest": "spoil"},
                    dump_idx=0, body_deg=0.0, phase_t=0.0, trip_start=0.0, cycle_s=0.0, queue_s=0.0)


def _crane(mid, kind, base, jib, tower_h, slew, luff, cap_max, cap_moment, vmax):
    m = _machine(mid, kind, base[0], base[1], 0.0, base=list(base), jib=jib, tower_h=tower_h, slew=slew, slew_target=slew, slew_rate=0.0,
                 slew_vmax=vmax, luff=luff, luff_target=luff, luff_rate=0.0, radius=2.0 + jib * math.cos(luff),
                 hook_z=12.0, hook_target=12.0, rope_speed=0.0, hook_block_t=0.4, cap_max_t=cap_max, cap_moment=cap_moment,
                 lmi_pct=0.0, chart_t=cap_max, wind_ms=0.0, phase="idle", phase_t=0.0, lift=None, lifts_done=0)
    return m


WORKER_SPECS = [
    ("W01", "banksman", [(5.0, -33.0), (2.0, -35.0)], 0.0),
    ("W02", "banksman", [(-22.0, 27.0), (-20.0, 24.0)], 0.0),
    ("W03", "slinger", [(-62.0, 54.0), (-58.0, 61.0), (-66.0, 50.0)], 0.0),
    ("W04", "slinger", [(-27.0, 3.0), (-24.0, 8.0)], 0.0),
    ("W05", "surveyor", [(-50.0, 34.0), (-20.0, 34.0), (8.0, 34.0), (14.0, 12.0), (-54.0, -34.0)], 0.0),
    ("W06", "labourer", [(-60.0, 66.0), (-52.0, 60.0)], 0.0),
    ("W07", "labourer", [(-2.0, -36.0), (-16.0, -38.0), (4.0, -40.0)], 0.0),
    ("W08", "labourer", [(-44.0, -6.0), (-36.0, -20.0)], 0.0),
    ("W09", "labourer", [(-80.0, -84.0), (-40.0, -40.0)], 0.0),
    ("W10", "labourer", [(30.0, 8.0), (34.0, 16.0)], 0.0),
    ("W11", "piling helper", [(30.0, -10.0), (29.0, 0.0)], 0.0),
    ("W12", "site engineer", [(-78.0, -80.0), (-30.0, -36.0), (20.0, -40.0), (-55.0, 36.0)], 0.0),
    ("W13", "visitor", [(-76.0, -82.0)], 0.5),
    ("W14", "labourer", [(24.0, -40.0), (-4.0, -42.0)], 0.35),
]


def _workers(st):
    ws = {}
    for i, (wid, role, wps, wander) in enumerate(WORKER_SPECS):
        x, y = wps[0]
        ws[wid] = {"id": wid, "role": role, "x": x, "y": y, "heading": 0.0, "tx": x, "ty": y, "tag_x": x, "tag_y": y,
                   "tag_phase": round((i * 0.0137 + 0.0031) % 0.1, 4), "tag_next": 0.0, "wps": [list(p) for p in wps], "wp": 0,
                   "dwell": 5.0 + 3.0 * i, "speed": 1.2 + 0.03 * i, "wander": wander, "zone": "ok", "hist": [], "script": None}
    return ws


SENSORS = [
    ("WS-TC1", "anemometer", "wind_ms", 1.0), ("WS-MC1", "anemometer", "wind_ms", 1.0), ("WX-1", "weather", "temp_c", 5.0),
    ("DU-1", "dust", "pm10_ugm3", 2.0), ("DU-2", "dust", "pm10_ugm3", 2.0), ("DU-3", "dust", "pm10_ugm3", 2.0), ("DU-4", "dust", "pm10_ugm3", 2.0),
    ("NO-1", "noise", "laeq_db", 1.0), ("NO-2", "noise", "laeq_db", 1.0), ("NO-3", "noise", "laeq_db", 1.0), ("NO-4", "noise", "laeq_db", 1.0),
    ("VB-1", "vibration", "ppv_mms", 1.0), ("VB-2", "vibration", "ppv_mms", 1.0), ("VB-3", "vibration", "ppv_mms", 1.0),
    ("TL-1", "wall tilt", "tilt_mm", 5.0), ("TL-2", "wall tilt", "tilt_mm", 5.0), ("TL-3", "wall tilt", "tilt_mm", 5.0), ("TL-4", "wall tilt", "tilt_mm", 5.0),
    ("PZ-1", "piezometer", "head_m", 10.0), ("PZ-2", "piezometer", "head_m", 10.0), ("PZ-3", "piezometer", "head_m", 10.0),
    ("GC-1", "gate camera", "trucks_out", 5.0), ("RG-1", "rain gauge", "rain_mm", 10.0), ("LX-1", "light", "lux", 10.0),
    ("AQ-1", "air quality", "no2_ugm3", 5.0), ("AQ-2", "air quality", "no2_ugm3", 5.0),
    ("UA-1", "uwb anchor", "tags_seen", 2.0), ("UA-2", "uwb anchor", "tags_seen", 2.0), ("UA-3", "uwb anchor", "tags_seen", 2.0),
    ("UA-4", "uwb anchor", "tags_seen", 2.0),
]


def default_plan() -> dict:
    """The fallback plan: the shift as it runs with no AI at all, conservative everywhere."""
    lifts = [
        ("L1", "Rebar cage RC-1 to the core", 4.2, "rebar_yard", "core"),
        ("L2", "Formwork panel FP-4 to deck west", 2.8, "laydown", "deck_west"),
        ("L3", "Rebar cage RC-2 to the core", 4.2, "rebar_yard", "core"),
        ("L4", "Formwork panel FP-5 to deck east", 2.8, "laydown_b", "deck_east"),
        ("L5", "Precast stair PS-1 to the core", 4.6, "laydown", "core"),
        ("L6", "Rebar cage RC-3 to deck east", 4.0, "rebar_yard", "deck_east"),
    ]
    mlifts = [
        ("M1", "Pile cage PC-7 to the east wall", 3.4, "pile_cage_store", "east_wall"),
        ("M2", "Pile cage PC-8 to the east wall", 3.4, "pile_cage_store", "east_wall_n"),
        ("M3", "Pile cage PC-9 to the east wall", 3.4, "pile_cage_store", "east_wall"),
    ]
    return {
        "id": "root", "label": "Shift plan, Northgate Yard", "type": "parallel", "children": [
            {"id": "earth", "label": "Bulk excavation", "type": "parallel", "children": [
                {"id": "ex1", "label": "EX1 loads trucks", "type": "action", "machine": "EX1", "do": "load_trucks", "params": {}},
                {"id": "ex2", "label": "EX2 trims the batter and loads", "type": "action", "machine": "EX2", "do": "load_trucks", "params": {}},
                {"id": "haul", "label": "Six trucks haul to spoil and the gate", "type": "action", "machine": "HT*", "do": "haul", "params": {}},
            ]},
            {"id": "spoil", "label": "Spoil area", "type": "parallel", "children": [
                {"id": "dz", "label": "DZ1 spreads spoil", "type": "action", "machine": "DZ1", "do": "spread", "params": {}},
                {"id": "rl", "label": "RL1 compacts", "type": "action", "machine": "RL1", "do": "compact", "params": {}},
            ]},
            {"id": "tc", "label": "Tower crane lifts", "type": "sequence", "children": [
                {"id": lid, "label": lab, "type": "action", "machine": "TC1", "do": "lift",
                 "params": {"item": lab.split(" to ")[0], "tonnes": t, "from": a, "to": b}} for lid, lab, t, a, b in lifts]},
            {"id": "mc", "label": "Mobile crane lifts", "type": "sequence", "children": [
                {"id": lid, "label": lab, "type": "action", "machine": "MC1", "do": "lift",
                 "params": {"item": lab.split(" to ")[0], "tonnes": t, "from": a, "to": b}} for lid, lab, t, a, b in mlifts]},
            {"id": "pile", "label": "Secant piles, east wall", "type": "action", "machine": "PR1", "do": "pile", "params": {"count": 13}},
            {"id": "survey", "label": "Drone survey and overhead camera", "type": "parallel", "children": [
                {"id": "d1", "label": "D1 survey grid at 60 m", "type": "action", "machine": "D1", "do": "survey", "params": {}},
                {"id": "d2", "label": "D2 overhead orbit at 80 m", "type": "action", "machine": "D2", "do": "orbit", "params": {}},
            ]},
        ]}


def init_state(seed: int = 42) -> dict:
    st = {"v": 1, "seed": int(seed), "rng": int(seed) * 2654435761 % (1 << 64), "t": 0.0, "tick": 0, "seq": 0,
          "terrain": {"rev": 1, "delta": T.encode(initial_delta())}, "m3_moved": 0.0, "cycles": 0, "trucks_out": 0}
    ms = {}
    ex1_heading = math.atan2(L.NODES["bay1"][1] - L.EX1_BASE[1], L.NODES["bay1"][0] - L.EX1_BASE[0])
    ex2_heading = math.atan2(L.NODES["bay2"][1] - L.EX2_BASE[1], L.NODES["bay2"][0] - L.EX2_BASE[0])
    ms["EX1"] = _excavator("EX1", L.EX1_BASE, ex1_heading, "bay1", math.atan2(-1.0, -1.0))
    ms["EX2"] = _excavator("EX2", L.EX2_BASE, ex2_heading, "bay2", math.atan2(0.6, -1.0))
    ms["EX2"]["joints"]["swing"] = 0.8
    starts = [("HT1", "EX1", "loading", L.path("q1", "bay1"), 1.0), ("HT2", "EX1", "to_queue", L.route_to_bay("EX1"), 0.0),
              ("HT3", "EX2", "loading", L.path("q2", "bay2"), 1.0), ("HT4", "EX1", "haul", L.route_haul("EX1", "spoil", 3), 60.0),
              ("HT5", "EX2", "return", L.route_return("spoil", 5), 10.0), ("HT6", "EX2", "to_queue", L.path("j1") + L.route_to_bay("EX2"), 0.0)]
    for i, (tid, ex, phase, route, s) in enumerate(starts):
        tr = _truck(tid, ex, phase, route, s)
        tr["dump_idx"] = i * 3
        if phase == "loading":
            tr["s"] = 1e9
        if tid == "HT4":
            tr["load_t"] = 21.6
        ms[tid] = tr
    ms["DZ1"] = _machine("DZ1", "dozer", 52.0, -70.0, 0.0, lane=0, dir=1, blade_m=0.0)
    ms["RL1"] = _machine("RL1", "roller", 60.0, -84.0, 0.0, lane=0, dir=1, cmv=18.0)
    ms["TC1"] = _crane("TC1", "tower_crane", L.TC1_BASE, L.TC1_JIB, L.TC1_TOWER_H, 2.6, 0.75, 12.0, 300.0, 0.12)
    ms["MC1"] = _crane("MC1", "mobile_crane", L.MC1_BASE, L.MC1_BOOM, L.MC1_PIVOT_H, 3.6, 0.9, 20.0, 260.0, 0.15)
    ms["PR1"] = _machine("PR1", "piling_rig", L.PILES[2][0], L.PILES[2][1], math.pi / 2, pile=2, phase="drive", pile_depth=3.0, bpm=0, vib=0.0,
                         radius=L.PILE_RADIUS)
    ms["D1"] = _machine("D1", "drone", -50.0, -30.0, 0.0, z=60.0, leg=0)
    ms["D2"] = _machine("D2", "drone", 70.0, 0.0, math.pi / 2, z=80.0, ang=0.0)
    for m in ms.values():
        m["fuel_pct"] = round(100 * m["sig"]["fuel_l"] / m["sig"]["tank_l"], 1)
    st["machines"] = ms
    st["workers"] = _workers(st)
    st["weather"] = {"wind": 7.0, "dir": 0.6, "gust": 0.0, "gust_t": -1.0, "gust_len": 0.0, "gust_peak": 0.0, "gust_build": 0.0,
                     "next_gust": 150.0, "hist": [7.0] * 30, "peak3": 7.0, "forced": False}
    st["sensors"] = {sid: {"seq": 0, "born": False, "dead": False, "next": 0.5 + 0.13 * i} for i, (sid, *_r) in enumerate(SENSORS)}
    st["sp_seq"] = 0
    st["plan"] = {"source": "fallback", "version": 0, "tree": default_plan(), "summary": "Fallback plan"}
    st["fallback_tree"] = None
    st["dispatch"] = {}
    st["rules"] = {}
    st["ml"] = {"worker_path": {}, "collision_prob": None, "gust_forecast_ms": None, "anomaly": {}, "payload_t": None}
    st["ai_available"] = True
    st["faults"] = {"cut_can": [], "drop_gnss": [], "ai_offline": False, "killed": False}
    st["kpi"] = {"m3_moved": 0.0, "cycles": 0}
    st["recent"] = []
    st["near_miss_t"] = {}
    st["last_plan_emit"] = -10.0
    st["last_frame_bus"] = 0
    st["telehandler_code"] = None
    st["lift_progress"] = {}
    st["pile_progress"] = 0
    st["outcomes"] = []
    st["audit_mismatch"] = 0
    return st


# behaviour tree

def _iter_actions(node):
    if node.get("type") == "action" or "do" in node:
        yield node
    for c in node.get("children") or []:
        yield from _iter_actions(c)


VERBS = {
    "excavator": {"load_trucks", "trim_batter", "hold"},
    "haul_truck": {"haul", "hold"},
    "dozer": {"spread", "hold"},
    "roller": {"compact", "hold"},
    "tower_crane": {"lift", "hold"},
    "mobile_crane": {"lift", "hold"},
    "piling_rig": {"pile", "hold"},
    "drone": {"survey", "orbit", "hold"},
    "telehandler": {"deliver", "hold"},
}


def check_plan(st, tree) -> dict:
    """Problems with a proposed tree, plus the crane facts the Abenix crane limits check needs."""
    problems = []
    facts = []
    ms = st["machines"]
    if not isinstance(tree, dict) or "children" not in tree:
        return {"ok": False, "problems": ["The plan is not a behaviour tree with children"], "lift_facts": []}
    wind = st["weather"]["wind"] * 1.25
    for a in _iter_actions(tree):
        mid = str(a.get("machine", ""))
        targets = [k for k in ms if k.startswith(mid[:-1])] if mid.endswith("*") else [mid]
        for t in targets:
            m = ms.get(t)
            if m is None:
                problems.append(f"{a.get('id')}: no machine {t} on site")
                continue
            if a.get("do") not in VERBS.get(m["kind"], set()):
                problems.append(f"{a.get('id')}: {t} cannot {a.get('do')}")
            if a.get("do") == "lift":
                p = a.get("params") or {}
                to = L.LOCATIONS.get(p.get("to")) or (p.get("to") if isinstance(p.get("to"), list) else None)
                fr = L.LOCATIONS.get(p.get("from")) or (p.get("from") if isinstance(p.get("from"), list) else None)
                if not to or not fr:
                    problems.append(f"{a.get('id')}: unknown lift location")
                    continue
                r = max(dist(m["base"][0], m["base"][1], *fr), dist(m["base"][0], m["base"][1], *to))
                if r > m["jib"] + 1.5:
                    problems.append(f"{a.get('id')}: {t} cannot reach {r:.0f} m")
                    continue
                cap = min(m["cap_max_t"], m["cap_moment"] / max(1.0, r))
                lmi = 100.0 * (float(p.get("tonnes", 0)) + m["hook_block_t"]) / cap
                facts.append({"id": a.get("id"), "machine": t, "facts": {"crane": {"wind_ms": round(wind, 2), "lmi_pct": round(lmi, 1),
                                                                                    "min_separation_m": 30.0}}})
    return {"ok": not problems, "problems": problems, "lift_facts": facts}


def _assign_tasks(st):
    """Turn the active plan into per-machine tasks. Called when the plan changes."""
    tree = st["plan"]["tree"] if st["ai_available"] or st["plan"]["source"] == "fallback" else default_plan()
    tasks = {}
    lifts = {"TC1": [], "MC1": []}
    for a in _iter_actions(tree):
        mid = str(a.get("machine", ""))
        targets = [k for k in st["machines"] if k.startswith(mid[:-1])] if mid.endswith("*") else [mid]
        for t in targets:
            if a.get("do") == "lift" and t in lifts:
                lifts[t].append(a)
            else:
                tasks[t] = {"do": a.get("do"), "params": a.get("params") or {}, "node": a.get("id"), "label": a.get("label", "")}
    st["tasks"] = tasks
    st["lift_queue"] = {k: [x for x in v if st["lift_progress"].get(x.get("id")) != "success"] for k, v in lifts.items()}


def _tree_status(st, node):
    n = {k: v for k, v in node.items() if k != "children"}
    if node.get("children"):
        kids = [_tree_status(st, c) for c in node["children"]]
        n["children"] = kids
        sts = [k["status"] for k in kids]
        if node.get("type") == "sequence":
            n["status"] = "success" if all(s == "success" for s in sts) else ("failure" if "failure" in sts else
                                                                            ("running" if any(s in ("running", "success") for s in sts) else "pending"))
            done = False
            for k in kids:
                if k["status"] == "pending" and not done:
                    done = True
        else:
            n["status"] = "failure" if "failure" in sts else ("running" if any(s == "running" for s in sts) else
                                                             ("success" if sts and all(s == "success" for s in sts) else "pending"))
        return n
    nid = node.get("id")
    mid = str(node.get("machine", ""))
    if node.get("do") == "lift":
        n["status"] = st["lift_progress"].get(nid, "pending")
    elif node.get("do") == "pile":
        n["status"] = "success" if st["pile_progress"] >= int((node.get("params") or {}).get("count", 13)) else "running"
    else:
        targets = [m for k, m in st["machines"].items() if (k.startswith(mid[:-1]) if mid.endswith("*") else k == mid)]
        if not targets:
            n["status"] = "pending"
        elif any(m["mode"] in ("hold", "offline") for m in targets):
            n["status"] = "failure" if any(m["mode"] == "offline" for m in targets) else "idle"
        else:
            n["status"] = "running"
    if mid and not mid.endswith("*") and mid in st["machines"]:
        n["mode"] = st["machines"][mid]["mode"]
    return n


def plan_frame(st) -> dict:
    tree = _tree_status(st, st["plan"]["tree"] if st["ai_available"] else default_plan())
    tree["source"] = st["plan"]["source"] if st["ai_available"] else "fallback"
    tree["version"] = st["plan"]["version"]
    tree["summary"] = st["plan"].get("summary", "")
    return {"type": "plan", "t": round(st["t"], 3), "tree": tree}


# the machines

def _set_ex_targets(m, swing_abs, boom, stick, bucket):
    m["joints_target"] = {"swing": wrap(swing_abs - m["heading"]), "boom": boom, "stick": stick, "bucket": bucket}


def _ex_at_target(m, tol=0.06):
    j, jt = m["joints"], m["joints_target"]
    return all(abs(wrap(jt[k] - j[k])) < tol for k in ("swing", "boom", "stick", "bucket"))


def _ex_reach(m):
    j = m["joints"]
    return 1.6 + 5.7 * math.cos(j["boom"]) + 2.9 * math.cos(j["boom"] - 1.1 + j["stick"])


def _ex_tip_speed(m):
    r = _ex_reach(m)
    jr = m["joints_rate"]
    return abs(jr["swing"]) * r + 5.7 * abs(jr["boom"]) + 2.9 * abs(jr["stick"])


def _truck_at_bay(st, m):
    for tid in ("HT1", "HT2", "HT3", "HT4", "HT5", "HT6"):
        tr = st["machines"].get(tid)
        if tr and tr["phase"] == "loading" and tr["assign"]["ex"] == m["id"]:
            return tr
    return None


def tick_excavator(st, m, d, ev):
    t = st["t"]
    m["phase_t"] += DT
    task = st["tasks"].get(m["id"], {})
    if m["mode"] in ("hold", "offline") or task.get("do") == "hold":
        m["task"] = "held" if task.get("do") == "hold" else ("stopped, " + m["safety"].get("rule", "") if m["mode"] == "hold" else "bus offline")
        return
    truck = _truck_at_bay(st, m)
    bay = L.NODES[m["bay"]]
    truck_abs = math.atan2(bay[1] - m["y"], bay[0] - m["x"])
    ph = m["phase"]
    if ph == "dig":
        cands = [m["dig_centre"] + da for da in (-0.5, -0.35, -0.2, -0.05, 0.1, 0.25, 0.4)]
        ang = cands[m["dig_cursor"] % len(cands)]
        _set_ex_targets(m, ang, -0.35, 1.05, 1.35)
        m["task"] = f"dig, {'load ' + truck['id'] if truck else 'trim the batter'}"
        if _ex_at_target(m, 0.08) and m["phase_t"] > 2.5:
            radii = (6.5, 7.8, 9.0)
            got = 0.0
            for k in range(21):
                c = m["dig_cursor"] + k
                a = cands[c % len(cands)]
                r = radii[(c // len(cands)) % 3]
                got = T.cut(d, m["x"] + r * math.cos(a), m["y"] + r * math.sin(a), BUCKET_M3)
                if got > 0.2:
                    m["dig_cursor"] = c + 1
                    break
            m["bucket_m3"] = got
            m["dig_point"] = [m["x"] + 8.0 * math.cos(ang), m["y"] + 8.0 * math.sin(ang)]
            st["terrain_dirty"] = True
            m["phase"], m["phase_t"] = ("swing_load", 0.0) if truck else ("swing_cast", 0.0)
            st["ml_payload_rows"].append({"machine": m["id"], "row": [round(m["sig"]["boom_head"], 2), round(m["joints"]["boom"], 4),
                                                                      round(m["joints"]["stick"], 4), round(m["joints"]["bucket"], 4)]})
    elif ph == "swing_load":
        if truck is None:
            m["phase"], m["phase_t"] = "swing_cast", 0.0
            return
        _set_ex_targets(m, truck_abs, 0.45, 0.35, 1.35)
        m["task"] = f"swing to {truck['id']}"
        if _ex_at_target(m, 0.06):
            m["phase"], m["phase_t"] = "dump", 0.0
    elif ph == "swing_cast":
        # no truck: the bucket is cast back onto the face it came from
        _set_ex_targets(m, m["dig_centre"] + 0.7, 0.3, 0.5, 1.35)
        m["task"] = "waiting for a truck, trimming"
        if _ex_at_target(m, 0.08):
            if truck is not None:
                m["phase"], m["phase_t"] = "swing_load", 0.0
            elif m["phase_t"] > 2.0:
                T.fill(d, m["x"] + 7 * math.cos(m["dig_centre"] + 0.7), m["y"] + 7 * math.sin(m["dig_centre"] + 0.7), m["bucket_m3"], 0)
                m["bucket_m3"] = 0.0
                m["phase"], m["phase_t"] = "swing_back", 0.0
    elif ph == "dump":
        m["joints_target"]["bucket"] = -0.55
        m["task"] = f"load {truck['id'] if truck else ''}"
        if m["phase_t"] > 1.6 and truck is not None:
            tonnes = m["bucket_m3"] * SOIL_T_PER_M3
            truck["load_t"] = round(truck["load_t"] + tonnes, 2)
            truck["buckets"] = truck.get("buckets", 0) + 1
            st["m3_moved"] += m["bucket_m3"]
            m["load_t"] = round(st["ml"].get("payload_t") or tonnes, 2)
            m["bucket_m3"] = 0.0
            m["phase"], m["phase_t"] = "swing_back", 0.0
        elif truck is None and m["phase_t"] > 1.0:
            m["phase"], m["phase_t"] = "swing_cast", 0.0
    elif ph == "swing_back":
        _set_ex_targets(m, m["dig_centre"], 0.1, 0.7, 0.4)
        m["task"] = "swing back to the face"
        if _ex_at_target(m, 0.1):
            m["phase"], m["phase_t"] = "dig", 0.0


def _follow(st, m, vmax, accel=1.0):
    route = m["route"]
    s = m["s"]
    total = 0.0
    seg = None
    for i in range(len(route) - 1):
        a, b = route[i], route[i + 1]
        ln = dist(a[0], a[1], b[0], b[1])
        if s <= total + ln:
            seg = (a, b, ln, s - total)
            break
        total += ln
    if seg is None:
        m["x"], m["y"] = route[-1]
        m["speed"] = 0.0
        return True
    remaining = total + seg[2] - s
    for j in range(len(route) - 1):
        pass
    left = sum(dist(route[k][0], route[k][1], route[k + 1][0], route[k + 1][1]) for k in range(len(route) - 1)) - s
    target = min(vmax, math.sqrt(max(0.0, 2 * 1.5 * max(0.0, left - 0.5))))
    if m["mode"] in ("hold", "offline"):
        target = 0.0
    brake = 4.0 if m["mode"] in ("hold", "offline") else 2.5
    v = m["speed"]
    v = min(target, v + accel * DT) if v < target else max(target, v - brake * DT)
    m["speed"] = v
    m["s"] = s + v * DT
    a, b, ln, u = seg
    f = min(1.0, (m["s"] - (s - u)) / ln) if ln > 0 else 1.0
    m["x"] = a[0] + (b[0] - a[0]) * f
    m["y"] = a[1] + (b[1] - a[1]) * f
    h = math.atan2(b[1] - a[1], b[0] - a[0])
    m["heading"] = m["heading"] + wrap(h - m["heading"]) * min(1.0, 3.0 * DT)
    return left <= 0.3 and v < 0.05


def _route_len(route):
    return sum(dist(route[k][0], route[k][1], route[k + 1][0], route[k + 1][1]) for k in range(len(route) - 1))


def _truck_assign(st, tr):
    a = st["dispatch"].get(tr["id"])
    if a and a.get("ex") in ("EX1", "EX2") and st["ai_available"] and tr["mode"] != "fallback":
        tr["assign"] = {"ex": a["ex"], "dest": a.get("dest", "spoil") if a.get("dest") in ("spoil", "gate") else "spoil",
                        "action_id": a.get("action_id")}
        return
    q = {"EX1": 0, "EX2": 0}
    for o in st["machines"].values():
        if o["kind"] == "haul_truck" and o is not tr and o["phase"] in ("to_queue", "queue", "spot", "loading"):
            q[o["assign"]["ex"]] += 1
    ex = "EX1" if q["EX1"] <= q["EX2"] else "EX2"
    st["trips"] = st.get("trips", 0) + 1
    tr["assign"] = {"ex": ex, "dest": "gate" if st["trips"] % 5 == 0 else "spoil"}


def _ahead_blocked(st, tr):
    hx, hy = math.cos(tr["heading"]), math.sin(tr["heading"])
    for o in st["machines"].values():
        if o is tr or o["kind"] not in ("haul_truck", "telehandler") or o.get("phase") == "offsite":
            continue
        dx, dy = o["x"] - tr["x"], o["y"] - tr["y"]
        fwd = dx * hx + dy * hy
        if 0 < fwd < 11.0 and abs(-dx * hy + dy * hx) < 3.0:
            return True
    return False


def tick_truck(st, m, d, ev):
    t = st["t"]
    m["phase_t"] += DT
    task = st["tasks"].get(m["id"], {})
    cap = m["safety"].get("cap_kmh", 30) / 3.6
    scale = m.get("speed_scale", 1.0)
    vmax = min(8.3, cap) * scale
    if task.get("do") == "hold":
        vmax = 0.0
    ph = m["phase"]
    ex = m["assign"]["ex"]
    if ph in ("to_queue", "haul", "return", "spot"):
        if _ahead_blocked(st, m):
            vmax = 0.0
        arrived = _follow(st, m, vmax)
        m["task"] = {"to_queue": f"to {ex}", "haul": f"haul to {m['assign']['dest']}", "return": "return", "spot": f"spot under {ex}"}[ph]
        if arrived:
            if ph == "to_queue":
                m["phase"], m["phase_t"] = "queue", 0.0
            elif ph == "spot":
                m["phase"], m["phase_t"], m["buckets"] = "loading", 0.0, 0
            elif ph == "haul":
                if m["assign"]["dest"] == "gate":
                    m["phase"], m["phase_t"] = "offsite", 0.0
                    st["trucks_out"] += 1
                else:
                    m["phase"], m["phase_t"] = "dump", 0.0
            elif ph == "return":
                _truck_assign(st, m)
                m["route"] = L.path("j1") + L.route_to_bay(m["assign"]["ex"])
                m["s"] = 0.0
                m["phase"], m["phase_t"] = "to_queue", 0.0
    elif ph == "queue":
        m["speed"] = 0.0
        m["task"] = f"queue at {ex}"
        m["queue_s"] += DT
        busy = any(o["kind"] == "haul_truck" and o is not m and o["assign"]["ex"] == ex and o["phase"] in ("spot", "loading")
                   for o in st["machines"].values())
        if not busy and m["mode"] not in ("hold", "offline"):
            bay = L.NODES["bay1" if ex == "EX1" else "bay2"]
            m["route"] = [[m["x"], m["y"]], list(bay)]
            m["s"] = 0.0
            m["phase"], m["phase_t"] = "spot", 0.0
    elif ph == "loading":
        m["speed"] = 0.0
        m["task"] = f"loading under {ex}, {m.get('buckets', 0)} of {TRUCK_BUCKETS}"
        if m.get("buckets", 0) >= TRUCK_BUCKETS and m["mode"] not in ("hold", "offline"):
            m["route"] = L.route_haul(ex, m["assign"]["dest"], m["dump_idx"])
            m["s"] = 0.0
            m["phase"], m["phase_t"] = "haul", 0.0
    elif ph == "dump":
        m["speed"] = 0.0
        m["task"] = "tip at the spoil area"
        if m["phase_t"] < 6:
            m["body_deg"] = min(55.0, m["body_deg"] + 12 * DT)
        elif m["phase_t"] < 12:
            if m["load_t"] > 0:
                p = L.DUMP_POINTS[m["dump_idx"] % len(L.DUMP_POINTS)]
                T.fill(d, p[0], p[1], m["load_t"] / SOIL_T_PER_M3 * 1.2, 1)
                st["terrain_dirty"] = True
                m["load_t"] = 0.0
            m["body_deg"] = max(0.0, m["body_deg"] - 12 * DT)
        else:
            _cycle_done(st, m, ev)
            m["route"] = L.route_return("spoil", m["dump_idx"])
            m["dump_idx"] += 1
            m["s"] = 0.0
            m["phase"], m["phase_t"] = "return", 0.0
    elif ph == "offsite":
        m["speed"] = 0.0
        m["task"] = "off-site load"
        m["load_t"] = 0.0
        if m["phase_t"] > 40:
            _cycle_done(st, m, ev)
            m["route"] = L.route_return("gate", 0)
            m["s"] = 0.0
            m["phase"], m["phase_t"] = "return", 0.0


def _cycle_done(st, m, ev):
    st["cycles"] += 1
    cyc = st["t"] - m.get("trip_start", 0.0)
    m["trip_start"] = st["t"]
    aid = (m.get("assign") or {}).get("action_id")
    if aid:
        st["outcomes"].append({"action_id": aid, "truck": m["id"], "cycle_min": round(cyc / 60.0, 2)})
        m["assign"]["action_id"] = None


def tick_dozer(st, m, d, ev):
    task = st["tasks"].get(m["id"], {})
    if m["mode"] in ("hold", "offline") or task.get("do") == "hold":
        m["speed"] = max(0.0, m["speed"] - 3 * DT) if m["speed"] > 0 else min(0.0, m["speed"] + 3 * DT)
        m["task"] = "held"
        return
    lanes = [-48.0, -56.0, -64.0, -72.0, -80.0] if m["kind"] == "dozer" else [-52.0, -60.0, -68.0, -76.0, -86.0]
    y = lanes[m["lane"] % len(lanes)]
    v = (1.4 if m["kind"] == "dozer" else 1.1) * m.get("speed_scale", 1.0)
    m["speed"] = v * m["dir"]
    m["x"] += m["speed"] * DT
    m["y"] += (y - m["y"]) * min(1.0, 0.8 * DT)
    m["heading"] = 0.0 if m["dir"] > 0 else math.pi
    if m["x"] > 86 or m["x"] < 44:
        m["dir"] *= -1
        m["x"] = max(44.0, min(86.0, m["x"]))
        m["lane"] += 1
    if m["kind"] == "dozer":
        m["task"] = "spread spoil"
        if st["tick"] % 50 == 0:
            moved = T.level(d, m["x"] + 3 * m["dir"], m["y"], 2.0, 0.08)
            m["sig"]["blade_load"] = 0.6 if moved else 0.1
            m["blade_m"] = -0.05 if moved else 0.2
            if moved:
                st["terrain_dirty"] = True
    else:
        m["task"] = "compact the spoil"
        m["cmv"] = min(60.0, m.get("cmv", 18.0) + 0.002)


def _crane_tip(m):
    b = m["base"]
    return (b[0] + m["radius"] * math.cos(m["slew"]), b[1] + m["radius"] * math.sin(m["slew"]))


def _aim(m, loc, hook_z):
    b = m["base"]
    m["slew_target"] = math.atan2(loc[1] - b[1], loc[0] - b[0])
    r = max(4.0, min(m["jib"], dist(b[0], b[1], loc[0], loc[1])))
    m["luff_target"] = math.acos(max(-1.0, min(1.0, (r - 2.0) / m["jib"])))
    m["hook_target"] = hook_z


def _aimed(m):
    return abs(wrap(m["slew_target"] - m["slew"])) < 0.02 and abs(m["luff_target"] - m["luff"]) < 0.02 and abs(m["slew_rate"]) < 0.01


def tick_crane(st, m, d, ev):
    m["phase_t"] += DT
    m["wind_ms"] = round(st["weather"]["wind"] * 1.25 + st["weather"]["gust"] * 1.3, 2)
    ph = m["phase"]
    q = st["lift_queue"].get(m["id"]) or []
    task = st["tasks"].get(m["id"], {})
    hold_new = m["safety"].get("crane_action") == "hold_lifts" or task.get("do") == "hold"
    clear_z = 30.0 if m["kind"] == "tower_crane" else 18.0
    lift = m.get("lift")
    if ph == "idle":
        m["task"] = "waiting" if not q else ("lift held, " + m["safety"].get("reason", "") if hold_new else "next lift")
        m["hook_target"] = clear_z
        if q and not hold_new and m["mode"] not in ("hold", "offline"):
            nb = float((q[0].get("params") or {}).get("not_before_s", 0) or 0)
            if st["t"] >= nb:
                m["lift"] = lift = dict(q[0])
                st["lift_progress"][lift["id"]] = "running"
                m["phase"], m["phase_t"] = "to_pick", 0.0
            else:
                m["task"] = f"next lift at {nb:.0f} s"
        return
    p = lift.get("params") or {}
    fr = L.LOCATIONS.get(p.get("from"), m["base"])
    to = L.LOCATIONS.get(p.get("to"), m["base"])
    item = p.get("item", lift.get("label", "load"))
    if ph == "to_pick":
        _aim(m, fr, clear_z)
        m["task"] = f"to pick, {item}"
        if _aimed(m):
            m["phase"], m["phase_t"] = "lower_pick", 0.0
    elif ph == "lower_pick":
        m["hook_target"] = 2.5
        m["task"] = f"lower to {item}"
        if abs(m["hook_z"] - 2.5) < 0.2:
            m["phase"], m["phase_t"] = "attach", 0.0
    elif ph == "attach":
        m["task"] = f"slinging {item}"
        if m["phase_t"] > 8:
            m["load_t"] = float(p.get("tonnes", 2.0))
            m["phase"], m["phase_t"] = "hoist", 0.0
    elif ph == "hoist":
        m["hook_target"] = clear_z
        m["task"] = f"hoist {item}"
        if abs(m["hook_z"] - clear_z) < 0.3:
            m["phase"], m["phase_t"] = "to_drop", 0.0
    elif ph == "to_drop":
        _aim(m, to, clear_z)
        m["task"] = f"slew {item} to {p.get('to')}"
        if _aimed(m):
            m["phase"], m["phase_t"] = "lower_drop", 0.0
    elif ph == "lower_drop":
        m["hook_target"] = 4.0
        m["task"] = f"land {item}"
        if abs(m["hook_z"] - 4.0) < 0.2:
            m["phase"], m["phase_t"] = "detach", 0.0
    elif ph == "detach":
        m["task"] = f"unhook {item}"
        if m["phase_t"] > 6:
            m["load_t"] = 0.0
            st["lift_progress"][lift["id"]] = "success"
            m["lifts_done"] += 1
            ev.append({"kind": "plan_change", "machine": m["id"], "title": f"Lift done, {item}", "detail": f"{lift['id']} landed at {p.get('to')}"})
            st["lift_queue"][m["id"]] = [x for x in q if x.get("id") != lift["id"]]
            m["lift"] = None
            m["phase"], m["phase_t"] = "idle", 0.0
    if m["kind"] == "mobile_crane":
        V.TYPES["LUFF"].tick(m, DT, None)
        V.TYPES["HOIST"].tick(m, DT, None)


def tick_piling(st, m, d, ev):
    task = st["tasks"].get(m["id"], {})
    if m["mode"] in ("hold", "offline") or task.get("do") == "hold":
        m["bpm"], m["vib"] = 0, 0.0
        m["task"] = "held"
        return
    count = int((task.get("params") or {}).get("count", 13))
    if st["pile_progress"] >= count:
        m["task"] = "piles complete"
        m["bpm"], m["vib"] = 0, 0.0
        return
    if m["phase"] == "drive":
        m["bpm"] = 42
        m["pile_depth"] += 0.08 * DT * m.get("speed_scale", 1.0)
        m["vib"] = 6.0 + 2.0 * math.sin(st["t"] * 3.0)
        m["task"] = f"drive pile P{m['pile'] + 1}, {m['pile_depth']:.1f} m"
        if m["pile_depth"] >= 12.0:
            st["pile_progress"] += 1
            ev.append({"kind": "plan_change", "machine": m["id"], "title": f"Pile P{m['pile'] + 1} done", "detail": "12 m, east wall"})
            m["pile"] = (m["pile"] + 1) % len(L.PILES)
            m["phase"], m["pile_depth"] = "move", 0.0
    else:
        m["bpm"], m["vib"] = 0, 0.4
        tx, ty = L.PILES[m["pile"]]
        dd = dist(m["x"], m["y"], tx, ty)
        m["task"] = f"move to pile P{m['pile'] + 1}"
        if dd < 0.05:
            m["phase"] = "drive"
            m["speed"] = 0.0
        else:
            v = min(0.4, dd)
            m["speed"] = v
            m["x"] += (tx - m["x"]) / dd * v * DT
            m["y"] += (ty - m["y"]) / dd * v * DT


def tick_drone(st, m, d, ev):
    if m["id"] == "D1":
        pts = [(-50.0, -30.0), (10.0, -30.0), (10.0, -15.0), (-50.0, -15.0), (-50.0, 0.0), (10.0, 0.0), (10.0, 15.0), (-50.0, 15.0), (-50.0, 30.0), (10.0, 30.0)]
        tx, ty = pts[m["leg"] % len(pts)]
        dd = dist(m["x"], m["y"], tx, ty)
        if dd < 0.5:
            m["leg"] += 1
        else:
            m["x"] += (tx - m["x"]) / dd * 5.0 * DT
            m["y"] += (ty - m["y"]) / dd * 5.0 * DT
            m["heading"] = math.atan2(ty - m["y"], tx - m["x"])
        m["speed"] = 5.0
        m["task"] = "survey grid, 60 m"
    else:
        m["ang"] = (m["ang"] + 4.0 / 70.0 * DT) % TWO_PI
        m["x"], m["y"] = -10 + 70 * math.cos(m["ang"]), 70 * math.sin(m["ang"])
        m["heading"] = m["ang"] + math.pi / 2
        m["speed"] = 4.0
        m["task"] = "overhead orbit, 80 m"


def tick_telehandler(st, m, d, ev):
    if m["mode"] in ("hold", "offline") or m.get("ai_error"):
        m["speed"] = 0.0
        m["task"] = "held" if not m.get("ai_error") else "controller error, held"
        return
    vmax = min(5.0, m["safety"].get("cap_kmh", 30) / 3.6) * m.get("speed_scale", 1.0)
    if _ahead_blocked(st, m):
        vmax = 0.0
    if m["phase"] == "drive":
        arrived = _follow(st, m, vmax, 0.8)
        m["task"] = "deliver formwork to the laydown" if m.get("loaded") else "return to the gate"
        if arrived:
            m["phase"], m["phase_t"] = "boom", 0.0
    else:
        m["phase_t"] += DT
        m["speed"] = 0.0
        m["boom_target"] = 0.9 if m["phase_t"] < 8 else 0.15
        m["ext_target"] = 4.0 if m["phase_t"] < 8 else 0.0
        m["task"] = "boom up, place the load" if m.get("loaded") else "boom up, pick a load"
        if m["phase_t"] > 14:
            m["loaded"] = not m.get("loaded")
            m["load_t"] = 2.2 if m["loaded"] else 0.0
            m["route"] = list(reversed(m["route"]))
            m["s"] = 0.0
            m["phase"] = "drive"


TICKERS = {"excavator": tick_excavator, "haul_truck": tick_truck, "dozer": tick_dozer, "roller": tick_dozer,
           "tower_crane": tick_crane, "mobile_crane": tick_crane, "piling_rig": tick_piling, "drone": tick_drone,
           "telehandler": tick_telehandler}


# people and weather

def tick_workers(st, ev):
    t = st["t"]
    for w in st["workers"].values():
        sc = w.get("script")
        if sc:
            pts = sc["pts"]
            k = sc.get("k", 0)
            if k < len(pts):
                tx, ty, wait = pts[k]
                dd = dist(w["x"], w["y"], tx, ty)
                if dd < 0.05:
                    sc["wait"] = sc.get("wait", 0.0) + DT
                    if sc["wait"] >= wait:
                        sc["k"], sc["wait"] = k + 1, 0.0
                else:
                    v = min(sc.get("speed", 1.5), dd / DT)
                    w["x"] += (tx - w["x"]) / dd * v * DT
                    w["y"] += (ty - w["y"]) / dd * v * DT
                    w["heading"] = math.atan2(ty - w["y"], tx - w["x"])
            else:
                w["script"] = None
                w["tx"], w["ty"] = w["x"], w["y"]
        else:
            dd = dist(w["x"], w["y"], w["tx"], w["ty"])
            if dd < 0.1:
                w["dwell"] -= DT
                if w["dwell"] <= 0:
                    if w["wander"] and rnd(st) < w["wander"]:
                        base = w["wps"][0]
                        w["tx"] = base[0] + (rnd(st) - 0.5) * 50
                        w["ty"] = base[1] + (rnd(st) - 0.5) * 50
                    else:
                        w["wp"] = (w["wp"] + 1) % len(w["wps"])
                        w["tx"], w["ty"] = w["wps"][w["wp"]]
                        w["tx"] += (rnd(st) - 0.5) * 3
                        w["ty"] += (rnd(st) - 0.5) * 3
                    w["tx"] = max(-96.0, min(96.0, w["tx"]))
                    w["ty"] = max(-96.0, min(96.0, w["ty"]))
                    w["dwell"] = 10.0 + 30.0 * rnd(st)
            else:
                v = min(w["speed"], dd / DT)
                w["x"] += (w["tx"] - w["x"]) / dd * v * DT
                w["y"] += (w["ty"] - w["y"]) / dd * v * DT
                w["heading"] = math.atan2(w["ty"] - w["y"], w["tx"] - w["x"])
        # UWB tag, 10 Hz with its own clock and some jitter
        if t + 1e-9 >= w["tag_next"]:
            w["tag_x"] = w["x"] + 0.08 * gauss(st)
            w["tag_y"] = w["y"] + 0.08 * gauss(st)
            w["tag_at"] = w["tag_next"]
            w["tag_next"] = (math.floor((t - w["tag_phase"]) / 0.1) + 1) * 0.1 + w["tag_phase"]
            if w["tag_next"] <= t:
                w["tag_next"] += 0.1


def tick_weather(st, ev):
    wx = st["weather"]
    t = st["t"]
    mean = 7.0
    wx["wind"] += -(wx["wind"] - mean) * DT / 40.0 + 0.35 * math.sqrt(DT) * gauss(st) * 0.5
    wx["wind"] = max(0.5, wx["wind"])
    if wx["gust_t"] < 0 and t >= wx["next_gust"] and not wx.get("forced"):
        wx["gust_t"] = 0.0
        wx["gust_len"] = 6.0 + 4.0 * rnd(st)
        wx["gust_peak"] = 3.0 + 4.0 * rnd(st)
        wx["gust_build"] = 2.0
        wx["next_gust"] = t + 120.0 + 240.0 * rnd(st)
    if wx["gust_t"] >= 0:
        g = wx["gust_t"]
        b, ln, pk = wx["gust_build"], wx["gust_len"], wx["gust_peak"]
        if g < b:
            wx["gust"] = pk * g / b
        elif g < b + ln:
            wx["gust"] = pk * (0.9 + 0.1 * math.sin(g * 5))
        elif g < b + ln + 4:
            wx["gust"] = pk * (1 - (g - b - ln) / 4)
        else:
            wx["gust"], wx["gust_t"], wx["forced"] = 0.0, -1.0, False
        if wx["gust_t"] >= 0:
            wx["gust_t"] += DT


# safety: the Abenix decision tables run every tick

def _tables(st):
    out = {}
    for k in RULE_KEYS:
        e = st["rules"].get(k)
        out[k] = R.table(e) if e and e.get("rules") else None
    return out


def safety_tick(st, tabs, ev, stats):
    t0 = time.perf_counter()
    t = st["t"]
    ms = st["machines"]
    workers = list(st["workers"].values())
    ml = st["ml"]
    excl, crane_t, truck_t, simplex_t = tabs["gw.safety.exclusion"], tabs["gw.crane.limits"], tabs["gw.truck.speed"], tabs["gw.simplex.switch"]
    for w in workers:
        w["zone"] = "ok"
    # cranes share airspace, the anti-collision unit measures the gap
    tc, mc = ms.get("TC1"), ms.get("MC1")
    sep = 99.0
    if tc and mc:
        tc_tip = _crane_tip(tc)
        mc_tip = _crane_tip(mc)
        sep = seg_seg(tc["base"], tc_tip, mc["base"], mc_tip)
    for m in ms.values():
        kind = m["kind"]
        sf = m["safety"]
        rule_stop = False
        rule = ""
        reason = ""
        sf["slow"] = False
        speed_scale = 1.0
        if kind in ("excavator", "piling_rig", "telehandler"):
            radius = m.get("radius", L.EX_SWING_RADIUS) if kind != "telehandler" else L.TH_RADIUS
            tip = _ex_tip_speed(m) if kind == "excavator" else (abs(m.get("speed", 0.0)) if kind == "telehandler" else (0.6 if m.get("bpm") else 0.0))
            near, nw = 600.0, None
            for w in workers:
                dd = dist(w["tag_x"], w["tag_y"], m["x"], m["y"])
                if dd < near:
                    near, nw = dd, w
            clearance = near - radius
            sf["nearest_m"], sf["tip_speed"], sf["exclusion_m"] = near, tip, radius
            if excl is None:
                rule_stop, rule, reason = True, "no_rules", "Safety rules not loaded from Abenix"
            else:
                key, out = excl.evaluate({"machine": {"tip_speed_ms": tip}, "worker": {"clearance_m": clearance}})
                act = (out or {}).get("action", "stop")
                sf["exclusion_m"] = radius + float((out or {}).get("margin_m", 0))
                # a stopped machine has no tip speed, so keep the margin that stopped it until the worker is 1 m past it
                if act == "stop":
                    sf["hold_margin"] = float((out or {}).get("margin_m", 2))
                elif sf.get("hold_margin") is not None:
                    if clearance < sf["hold_margin"] + 1.0 and m["mode"] in ("hold", "offline"):
                        act = "stop"
                        out = dict(out or {}, action="stop", reason="Worker still inside the margin that stopped the machine")
                    else:
                        sf["hold_margin"] = None
                if act == "stop":
                    rule_stop, rule, reason = True, "worker_in_swing", (out or {}).get("reason", "")
                    if nw is not None:
                        nw["zone"] = "danger"
                        sf["worker"] = nw["id"]
                        sf["arrival"] = nw.get("tag_at", t)
                elif act == "warn" and nw is not None and nw["zone"] == "ok":
                    nw["zone"] = "warn"
                sf["rule_key"] = key
                sf["facts"] = {"machine": {"tip_speed_ms": round(tip, 3)}, "worker": {"clearance_m": round(clearance, 3)}}
                sf["outcome"] = out
        elif kind == "haul_truck":
            near = 600.0
            for w in workers:
                dd = dist(w["tag_x"], w["tag_y"], m["x"], m["y"])
                if dd < near:
                    near = dd
            zone = "gate" if m["y"] < -85 else ("pit" if L.in_rect(L.PIT, m["x"], m["y"], 2.0) or m["x"] < 26 and m["y"] > -44 and m["x"] > -2 and m["y"] < -20 else "haul_road")
            sf["nearest_m"] = near
            if truck_t is None:
                sf["cap_kmh"] = 0
                rule_stop, rule, reason = True, "no_rules", "Safety rules not loaded from Abenix"
            else:
                key, out = truck_t.evaluate({"truck": {"nearest_worker_m": near, "zone": zone}})
                sf["cap_kmh"] = (out or {}).get("speed_cap_kmh", 10)
                if sf["cap_kmh"] <= 10 and key == "cap.near_worker" and m["speed"] > 10 / 3.6 + 0.05:
                    sf["capping"] = True
                    rule = "truck_near_worker"
                else:
                    sf["capping"] = False
                sf["rule_key"] = key
        elif kind in ("tower_crane", "mobile_crane"):
            sf["separation_m"] = sep
            facts = {"crane": {"wind_ms": m["wind_ms"], "lmi_pct": round(m["lmi_pct"], 2), "min_separation_m": round(sep, 2)}}
            if ml.get("collision_prob") is not None and st["ai_available"]:
                facts["crane"]["collision_prob"] = ml["collision_prob"]
            if ml.get("gust_forecast_ms") is not None and st["ai_available"]:
                facts["crane"]["gust_forecast_ms"] = ml["gust_forecast_ms"]
            if crane_t is None:
                rule_stop, rule, reason = True, "no_rules", "Safety rules not loaded from Abenix"
                act = "stop_slew"
            else:
                key, out = crane_t.evaluate(facts)
                act = (out or {}).get("action", "stop_slew")
                reason = (out or {}).get("reason", "")
                speed_scale = float((out or {}).get("speed_pct", 0)) / 100.0
                sf["rule_key"] = key
            sf["crane_action"] = act
            sf["reason"] = reason
            m["slew_stop"] = act == "stop_slew"
            m["hoist_stop"] = act == "stop_hoist"
            if act == "stop_slew":
                rule_stop = True
                rule = "crane_wind" if facts["crane"]["wind_ms"] > 20 else ("crane_envelope" if sep < 5 else "crane_limit")
            elif act == "stop_hoist":
                rule = "crane_lmi"
            elif act == "slow":
                sf["slow"] = True
            sf["facts"] = facts
        # a stop holds for 2 s after the hazard clears, so the machine does not chatter
        if rule_stop:
            sf["hold_until"] = t + 2.0
            sf["hold_rule"] = rule
        elif t < sf.get("hold_until", -1.0):
            rule_stop, rule = True, sf.get("hold_rule", rule)
        # the Simplex switch decides who drives
        lost = m["gnss"]["lost_s"]
        silent = m["can"]["silent_s"]
        crit = any((d0, d1) in V.CRITICAL_DTCS for d0, d1, *_ in m["dtcs"])
        sx = m["simplex"]
        if rule_stop and not sx["latched"] and kind not in ("drone",):
            sx["latched"], sx["rule"], sx["since"] = True, rule, t
        mfacts = {"machine": {"gnss_lost_s": round(lost, 3), "can_silent_s": round(silent, 3), "rule_stop": rule_stop,
                              "dtc_critical": crit, "hit_latched": sx["latched"], "ai_available": st["ai_available"]}}
        if simplex_t is None:
            mode, why = "hold", "Simplex rules not loaded from Abenix"
        else:
            _k, out = simplex_t.evaluate(mfacts)
            mode, why = (out or {}).get("mode", "hold"), (out or {}).get("reason", "")
        if kind == "drone":
            mode = "auto" if mode in ("fallback", "auto") else mode
        if kind in ("tower_crane", "mobile_crane") and rule_stop and mode == "hold":
            # a crane stop is the slew brake: hoist and luff in stay available to land the load
            mode = "hold"
        prev = m["mode"]
        if mode == "auto" and st["plan"]["source"] == "fallback" and kind != "drone":
            mode = "fallback" if not st["ai_available"] else "auto"
        if mode != prev:
            if mode in ("hold", "offline"):
                if rule_stop and rule == "worker_in_swing":
                    arrival = sf.get("arrival", t)
                    eval_ms = (time.perf_counter() - t0) * 1000.0
                    react = max(0.0, (t - arrival) * 1000.0) + eval_ms
                    m["simplex"]["hold_since"] = t
                    ev.append({"kind": "safety_stop", "machine": m["id"], "rule": rule, "title": f"Safety stop {react:.1f} ms",
                               "detail": f"Worker {sf.get('worker', '')} inside the {m['id']} swing radius plus margin. {reason}",
                               "ms": round(react, 2), "worker": sf.get("worker"), "route": "near_miss", "facts": sf.get("facts"),
                               "rule_key": sf.get("rule_key")})
                elif rule_stop:
                    ev.append({"kind": "safety_stop", "machine": m["id"], "rule": rule, "title": f"{m['id']} stopped",
                               "detail": reason or why, "ms": round((time.perf_counter() - t0) * 1000.0, 3), "rule_key": sf.get("rule_key"),
                               "route": "weather_hold" if rule == "crane_wind" else None})
                else:
                    ev.append({"kind": "fault", "machine": m["id"], "title": f"{m['id']} {mode}", "detail": why})
            elif prev in ("hold", "offline") and mode in ("fallback", "auto"):
                ev.append({"kind": "plan_change", "machine": m["id"], "title": f"{m['id']} moving again, {mode}", "detail": why})
        m["mode"] = mode
        if rule_stop:
            sf["rule"] = rule
        elif sf.get("rule") and mode not in ("hold", "offline"):
            sf["rule"] = ""
        base = {"auto": 1.0, "fallback": 0.7, "hold": 0.0, "offline": 0.0, "manual": 0.5}[mode]
        task = st["tasks"].get(m["id"]) or {}
        pct = (task.get("params") or {}).get("speed_pct")
        if mode == "auto" and isinstance(pct, (int, float)):
            base = max(0.1, min(1.0, pct / 100.0))
        if kind in ("tower_crane", "mobile_crane"):
            base = min(base if mode != "hold" else 1.0, speed_scale if speed_scale > 0 else 1.0)
            if sf.get("slow"):
                base = min(base, 0.4)
        m["speed_scale"] = base
    stats.append(time.perf_counter() - t0)


# faults

def apply_faults(st, faults, ev):
    t = st["t"]
    ms = st["machines"]
    for f in faults or []:
        kind = f.get("kind")
        target = f.get("target")
        if kind == "cut_can":
            mid = target if target in ms and ms[target]["ecus"] else "EX2"
            if mid not in st["faults"]["cut_can"]:
                st["faults"]["cut_can"].append(mid)
            ms[mid]["can"]["cut"] = True
            ev.append({"kind": "fault", "machine": mid, "title": f"CAN bus cut on {mid}", "detail": "Controller frames stop, the safety PLC watchdog takes over"})
        elif kind == "drop_gnss":
            mid = target if target in ms else "HT3"
            if mid not in st["faults"]["drop_gnss"]:
                st["faults"]["drop_gnss"].append(mid)
            ms[mid]["gnss"]["fix"] = 0
            ev.append({"kind": "fault", "machine": mid, "title": f"GNSS lost on {mid}", "detail": "RTK fix dropped, hold after 1 s"})
        elif kind == "gust":
            wx = st["weather"]
            wx.update({"gust_t": 0.0, "gust_build": float(f.get("build_s", 8.0)), "gust_len": float(f.get("hold_s", 9.0)),
                       "gust_peak": float(f.get("peak_ms", 11.5)), "forced": True})
            ev.append({"kind": "gust", "machine": "TC1", "title": "Gust front arriving", "detail": "Anemometers rising on the tower crane"})
        elif kind == "worker_in_swing":
            mid = target if target in ms and ms[target]["kind"] == "excavator" else "EX1"
            m = ms[mid]
            wid = f.get("worker") or "W07"
            w = st["workers"][wid]
            ang = m["heading"] + m["joints"]["swing"] + 0.6
            inside = (m["x"] + 6.0 * math.cos(ang), m["y"] + 6.0 * math.sin(ang))
            far = float(f.get("start_m", 22.0))
            start = (m["x"] + far * math.cos(ang), m["y"] + far * math.sin(ang))
            w["x"], w["y"] = start
            w["script"] = {"pts": [(inside[0], inside[1], 3.0), (start[0], start[1], 0.5)], "speed": float(f.get("speed", 1.6))}
            ev.append({"kind": "story", "machine": mid, "title": f"{wid} walks toward {mid}", "detail": "Fault deck: worker into the swing zone"})
        elif kind == "ai_offline":
            st["faults"]["ai_offline"] = bool(f.get("on", True))
            st["ai_available"] = not (st["faults"]["ai_offline"] or st["faults"]["killed"])
            st["fallback_changed"] = True
        elif kind == "kill_switch":
            st["faults"]["killed"] = bool(f.get("on", True))
            st["ai_available"] = not (st["faults"]["ai_offline"] or st["faults"]["killed"])
            st["fallback_changed"] = True
        elif kind == "hydraulic_wear":
            mid = target if target in ms else "EX2"
            ms[mid]["sig"]["hyd_heat"] = float(f.get("heat", 45.0))
            ms[mid]["sig"]["hyd_ripple"] = float(f.get("ripple", 25.0))
        elif kind == "clear":
            for mid in st["faults"]["cut_can"]:
                ms[mid]["can"]["cut"] = False
            for mid in st["faults"]["drop_gnss"]:
                ms[mid]["gnss"]["fix"] = 4
            for m in ms.values():
                m["dtcs"] = [x for x in m["dtcs"] if x[0] not in (639, 584)]
                m["sig"]["hyd_heat"] = 0.0
                m["sig"]["hyd_ripple"] = 0.0
            st["faults"]["cut_can"], st["faults"]["drop_gnss"] = [], []
            st["faults"]["ai_offline"] = False
            st["faults"]["killed"] = False
            st["ai_available"] = True
            st["fallback_changed"] = True
            clear_simplex(st, "all", ev, "Fault deck clear")


def clear_simplex(st, which, ev, who):
    for m in st["machines"].values():
        if (which == "all" or m["id"] in which) and m["simplex"]["latched"]:
            m["simplex"]["latched"] = False
            m["simplex"]["rule"] = ""
            ev.append({"kind": "approval", "machine": m["id"], "title": f"{m['id']} cleared by a person", "detail": who})


# the step

def _due(tick, rate_ms, offset):
    if rate_ms <= 0:
        return False
    period = max(1, rate_ms // 10)
    return (tick + offset) % period == 0


def _bus_frame(st, m, ecu_code, vec, pgn_def, data, extra=None):
    cid = J.can_id(pgn_def.priority, pgn_def.pgn, vec.sa)
    f = {"type": "bus", "t": round(st["t"], 3), "machine": m["id"], "ecu": ecu_code, "pgn": pgn_def.pgn, "sa": vec.sa,
         "can_id": f"{cid:08X}", "data": data.hex(), "name": pgn_def.name, "acronym": pgn_def.acronym, "proto": "j1939"}
    if extra is not None:
        f["decoded"] = extra
    return f


def tick_bus(st, m, frames, counts, want):
    """Every vECU runs its controller and puts its PGNs on the bus when they fall due."""
    tick = st["tick"]
    ctx = {"t": st["t"], "ai_code": st.get("_ai_code", {})}
    for i, code in enumerate(m["ecus"]):
        vec = V.TYPES[code]
        vec.tick(m, DT, ctx)
        if m["can"]["cut"] and code != "SPLC":
            continue
        ecu = "ENG" if code == "RENG" else code
        off = (sh(m["id"]) + 7 * i) % 100
        for pdef in vec.pgns:
            if _due(tick, pdef.rate_ms, off):
                vals = vec.values(m, pdef.pgn)
                if not vals:
                    continue
                data = J.encode(pdef.pgn, vals)
                counts[0] += 1
                if want(m["id"], code):
                    frames.append(_bus_frame(st, m, ecu, vec, pdef, data, J.decode(pdef.pgn, data)))
        if _due(tick, 1000, off + 3):
            dtcs = [J.Dtc(d0, d1, d2) for d0, d1, d2 in m["dtcs"] if (d0 != 639 or code != "SPLC")]
            for pgn, data in J.dm1_frames(V.dtc_lamps(m["dtcs"]), dtcs):
                counts[0] += 1
                if dtcs or want(m["id"], code):
                    lamps, decoded = (J.decode_dm1(data) if pgn == J.DM1.pgn else ({}, []))
                    pdef = J.PGNS[pgn]
                    frames.append(_bus_frame(st, m, ecu, vec, pdef, data, {
                        "lamps": lamps, "dtcs": [{"spn": d.spn, "fmi": d.fmi, "oc": d.oc, "spn_text": J.SPN_TEXT.get(d.spn, ""),
                                                  "fmi_text": J.FMI_TEXT.get(d.fmi, "")} for d in (decoded if pgn == J.DM1.pgn else dtcs)]}))


def tick_faults(st, m, ev):
    can = m["can"]
    if can["cut"]:
        can["silent_s"] += DT
        if can["silent_s"] > 0.3 and not any(d[0] == 639 for d in m["dtcs"]):
            m["dtcs"].append([639, 9, 1])
            ev.append({"kind": "fault", "machine": m["id"], "title": f"DM1 on {m['id']}: SPN 639 FMI 9", "detail": "J1939 network #1, abnormal update rate",
                       "spn": 639, "fmi": 9, "route": "fault_triage"})
    else:
        can["silent_s"] = 0.0
    g = m["gnss"]
    if g["fix"] == 0:
        g["lost_s"] += DT
        if g["lost_s"] > 1.0 and not any(d[0] == 584 for d in m["dtcs"]):
            m["dtcs"].append([584, 2, 1])
            ev.append({"kind": "fault", "machine": m["id"], "title": f"DM1 on {m['id']}: SPN 584 FMI 2", "detail": "GNSS position erratic, fix lost",
                       "spn": 584, "fmi": 2})
    else:
        g["lost_s"] = 0.0
    if m["kind"] == "excavator":
        ht = m["sig"].get("hyd_t", 55)
        has = any(d[0] == 1638 for d in m["dtcs"])
        if ht > 92 and not has:
            m["dtcs"].append([1638, 16, 1])
            ev.append({"kind": "fault", "machine": m["id"], "title": f"DM1 on {m['id']}: SPN 1638 FMI 16", "detail": f"Hydraulic temperature {ht:.0f} C, above normal",
                       "spn": 1638, "fmi": 16, "route": "fault_triage"})
        elif ht > 100 and not any(d[0] == 1638 and d[1] == 0 for d in m["dtcs"]):
            m["dtcs"] = [d for d in m["dtcs"] if d[0] != 1638] + [[1638, 0, 1]]
            ev.append({"kind": "fault", "machine": m["id"], "title": f"DM1 on {m['id']}: SPN 1638 FMI 0", "detail": f"Hydraulic temperature {ht:.0f} C, most severe",
                       "spn": 1638, "fmi": 0, "route": "fault_triage"})
    m["health"] = "fault" if any((d[0], d[1]) in V.CRITICAL_DTCS for d in m["dtcs"]) else ("warn" if m["dtcs"] else "ok")
    an = st["ml"]["anomaly"].get(m["id"])
    if m["health"] == "ok" and an is not None and an < -0.05:
        m["health"] = "warn"


def tick_sensors(st, frames, counts, want_sensors):
    t = st["t"]
    wx = st["weather"]
    ms = st["machines"]
    ts_ms = int(1_790_000_000_000 + t * 1000)
    for sid, kind, metric, rate in SENSORS:
        s = st["sensors"][sid]
        if t + 1e-9 < s["next"]:
            continue
        s["next"] = t + rate
        if not s["born"]:
            s["born"] = True
            payload = SP.encode_payload(ts_ms, [("bdSeq", 0, SP.UINT64), ("Properties/kind", kind, SP.STRING)], st["sp_seq"])
            msg = "DBIRTH"
        else:
            val = sensor_value(st, sid, kind)
            payload = SP.encode_payload(ts_ms, [(metric, val, SP.FLOAT)], st["sp_seq"])
            msg = "DDATA"
            s["last"] = val
        st["sp_seq"] = (st["sp_seq"] + 1) % 256
        counts[0] += 1
        if want_sensors(sid):
            dec = SP.decode_payload(payload)
            frames.append({"type": "bus", "t": round(t, 3), "machine": "SITE", "ecu": sid, "pgn": 0, "sa": 0, "proto": "sparkplug_b",
                           "topic": SP.topic(msg, sid), "data": payload.hex(), "name": f"Sparkplug B {msg} {kind}",
                           "decoded": {m["name"]: (round(m["value"], 3) if isinstance(m["value"], float) else m["value"]) for m in dec["metrics"]}})


def sensor_value(st, sid, kind):
    wx = st["weather"]
    ms = st["machines"]
    t = st["t"]
    if sid == "WS-TC1":
        return ms["TC1"]["wind_ms"]
    if sid == "WS-MC1":
        return round(wx["wind"] * 1.1 + wx["gust"], 2)
    if kind == "weather":
        return round(17.5 + 2 * math.sin(t / 3000), 2)
    if kind == "dust":
        busy = sum(abs(m["speed"]) for m in ms.values() if m["kind"] == "haul_truck")
        return round(22 + 3.5 * busy + 4 * wx["wind"] / 7, 1)
    if kind == "noise":
        return round(62 + 0.5 * sum(1 for m in ms.values() if abs(m.get("speed", 0)) > 0.5) + (6 if ms["PR1"].get("bpm") else 0), 1)
    if kind == "vibration":
        return round(ms["PR1"].get("vib", 0.0) * (1.0 if sid == "VB-1" else 0.4), 2)
    if kind == "wall tilt":
        return round(1.0 + 0.002 * st["m3_moved"] / 10 + 0.1 * math.sin(t / 600 + int(sid[-1])), 3)
    if kind == "piezometer":
        return round(-4.2 - 0.1 * int(sid[-1]), 2)
    if kind == "gate camera":
        return st["trucks_out"]
    if kind == "rain gauge":
        return 0.0
    if kind == "light":
        return round(42000 - t * 0.5, 0)
    if kind == "air quality":
        return round(28 + 2 * math.sin(t / 900), 1)
    if kind == "uwb anchor":
        return len(st["workers"])
    return 0.0


def _ml_requests(st, out):
    t = st["t"]
    ms = st["machines"]
    req = {}
    tick = st["tick"]
    # worker path, 2 Hz, only workers near a slewing machine
    if tick % 50 == 0:
        rows, ids = [], []
        for w in st["workers"].values():
            h = w["hist"]
            if len(h) < 10:
                continue
            near = min(dist(w["x"], w["y"], m["x"], m["y"]) for m in ms.values() if m["kind"] in ("excavator", "piling_rig"))
            if near > 35:
                continue
            x0, y0 = h[-1]
            rows.append([round(v, 3) for p in h for v in (p[0] - x0, p[1] - y0)])
            ids.append(w["id"])
        if rows:
            req["gw-worker-path"] = {"ids": ids, "rows": rows}
    if tick % 100 == 25:
        tc, mc = ms["TC1"], ms["MC1"]
        req["gw-crane-collision"] = {"ids": ["TC1-MC1"], "rows": [[
            round(math.cos(tc["slew"]), 4), round(math.sin(tc["slew"]), 4), round(tc["slew_rate"], 4), round(tc["radius"], 2),
            round(math.cos(mc["slew"]), 4), round(math.sin(mc["slew"]), 4), round(mc["slew_rate"], 4), round(mc["radius"], 2),
            round(tc["load_t"], 2), round(mc["load_t"], 2), round(tc["wind_ms"], 2),
            round(seg_seg(tc["base"], _crane_tip(tc), mc["base"], _crane_tip(mc)), 2)]]}
        h = st["weather"]["hist"]
        req["gw-gust-nowcast"] = {"ids": ["TC1"], "rows": [gust_features(h)]}
        rows, ids = [], []
        for mid in ("EX1", "EX2"):
            m = ms[mid]
            hw = m["hyd_win"]
            n = max(1, hw[0])
            rows.append([round(hw[1] / n, 2), round(math.sqrt(max(0.0, hw[2] / n - (hw[1] / n) ** 2)), 3), round(hw[3] / n, 2),
                         round(hw[4] / n, 2), round(hw[5] / n, 2), round(hw[6] / n, 4)])
            ids.append(mid)
            m["hyd_win"] = [0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
        req["gw-hydraulic-anomaly"] = {"ids": ids, "rows": rows}
    if st["ml_payload_rows"]:
        req["gw-payload"] = {"ids": [r["machine"] for r in st["ml_payload_rows"]], "rows": [r["row"] for r in st["ml_payload_rows"]]}
        st["ml_payload_rows"] = []
    for k, v in req.items():
        out["ml"][k] = v


def gust_features(h):
    last = h[-30:]
    n = len(last)
    mean = sum(last) / n
    sd = math.sqrt(sum((x - mean) ** 2 for x in last) / n)
    slope10 = (last[-1] - last[-10]) / 9.0
    slope3 = (last[-1] - last[-3]) / 2.0
    return [round(x, 3) for x in (mean, sd, max(last), last[-1], slope10, slope3, last[-2], last[-5])]


def _col(preds, out_index, col=0):
    """Abenix returns ONNX outputs as a list, one entry per graph output, each a list of rows."""
    if not isinstance(preds, list) or not preds:
        return []
    out = preds[out_index] if len(preds) > out_index and isinstance(preds[out_index], list) else preds[0]
    vals = []
    for r in out:
        if isinstance(r, list):
            vals.append(r if col is None else r[min(col, len(r) - 1)])
        else:
            vals.append(r)
    return vals


def apply_ml(st, results, ev):
    ml = st["ml"]
    for name, r in (results or {}).items():
        ids = r.get("ids") or []
        preds = r.get("predictions")
        if preds is None:
            continue
        if name == "gw-worker-path":
            for wid, p in zip(ids, _col(preds, 0, None)):
                if isinstance(p, list) and len(p) >= 6 and wid in st["workers"]:
                    w = st["workers"][wid]
                    ml["worker_path"][wid] = [[round(w["x"] + p[0], 2), round(w["y"] + p[1], 2)], [round(w["x"] + p[2], 2), round(w["y"] + p[3], 2)],
                                              [round(w["x"] + p[4], 2), round(w["y"] + p[5], 2)]]
        elif name == "gw-crane-collision":
            v = _col(preds, 1, 1)
            if v:
                ml["collision_prob"] = round(float(v[0]), 3)
        elif name == "gw-gust-nowcast":
            v = _col(preds, 0, 0)
            if v:
                prev = ml.get("gust_forecast_ms")
                ml["gust_forecast_ms"] = round(float(v[0]), 2)
                if ml["gust_forecast_ms"] > 18 and (prev is None or prev <= 18):
                    ev.append({"kind": "gust", "machine": "TC1", "title": f"Gust forecast {ml['gust_forecast_ms']:.0f} m/s",
                               "detail": "Nowcast over the 18 m/s hold line in the next 60 s", "route": "weather_hold",
                               "forecast_ms": ml["gust_forecast_ms"]})
        elif name == "gw-hydraulic-anomaly":
            for mid, v in zip(ids, _col(preds, 1, 0)):
                ml["anomaly"][mid] = round(float(v), 4)
        elif name == "gw-payload":
            v = _col(preds, 0, 0)
            if v:
                ml["payload_t"] = round(float(v[-1]), 2)


def _record(st):
    if st["tick"] % 20 == 0:
        for w in st["workers"].values():
            w["hist"].append((round(w["x"], 2), round(w["y"], 2)))
            if len(w["hist"]) > 10:
                del w["hist"][0]
    if st["tick"] % 100 == 0:
        wx = st["weather"]
        h = wx["hist"]
        h.append(round(st["machines"]["TC1"]["wind_ms"], 2))
        if len(h) > 30:
            del h[0]
    if st["tick"] % 50 == 0:
        snap = {"t": round(st["t"], 1), "w": {w["id"]: [round(w["x"], 1), round(w["y"], 1)] for w in st["workers"].values()},
                "m": {m["id"]: [round(m["x"], 1), round(m["y"], 1), m["mode"]] for m in st["machines"].values() if m["kind"] in ("excavator", "haul_truck")}}
        st["recent"].append(snap)
        if len(st["recent"]) > 20:
            del st["recent"][0]
    for mid in ("EX1", "EX2"):
        m = st["machines"][mid]
        s = m["sig"]
        hw = m["hyd_win"]
        hw[0] += 1
        hw[1] += s.get("p1", 0)
        hw[2] += s.get("p1", 0) ** 2
        hw[3] += s.get("p2", 0)
        hw[4] += s.get("boom_head", 0)
        hw[5] += s.get("hyd_t", 0)
        hw[6] += s.get("flow", 0)


def _compile_ai(st):
    code = st.get("telehandler_code")
    st["_ai_code"] = {}
    if not code:
        return
    import builtins
    safe = {k: getattr(builtins, k) for k in ("abs", "min", "max", "float", "int", "round", "range", "len", "dict", "list", "bool")}
    ns = {"__builtins__": safe, "math": math}
    try:
        exec(compile(code, "telehandler_boom.py", "exec"), ns)  # noqa: S102
        st["_ai_code"]["TH1"] = ns["tick"]
    except Exception as e:  # noqa: BLE001
        st["machines"].get("TH1", {})["ai_error"] = str(e)[:200]


def add_telehandler(st, code, ev):
    st["telehandler_code"] = code
    if "TH1" not in st["machines"]:
        route = L.path("gate", "gate_in", (-20.0, -70.0), (-80.0, -40.0), (-82.0, 20.0), (-70.0, 44.0))
        st["machines"]["TH1"] = _machine("TH1", "telehandler", route[0][0], route[0][1], math.pi / 2, route=route, s=0.0, phase="drive",
                                          phase_t=0.0, boom_angle=0.1, ext=0.0, boom_target=0.1, ext_target=0.0, loaded=True, load_t=2.2)
        ev.append({"kind": "plan_change", "machine": "TH1", "title": "TH1 telehandler on site", "detail": "Boom controller written and tested by AI, published at Asks first"})


def frame(st, tabs) -> dict:
    ms = st["machines"]
    out_m = []
    cranes = []
    for m in ms.values():
        k = m["kind"]
        joints = {}
        z = m.get("z", 0.0)
        if k == "excavator":
            joints = {n: round(v, 4) for n, v in m["joints"].items()}
        elif k in ("tower_crane", "mobile_crane"):
            joints = {"slew": round(m["slew"], 4), "luff": round(m["luff"], 4)}
            tip = _crane_tip(m)
            cranes.append({"id": m["id"], "slew": round(m["slew"], 4), "luff": round(m["luff"], 4),
                           "hook": [round(tip[0], 2), round(tip[1], 2), round(m["hook_z"], 2)], "load_t": round(m["load_t"], 2),
                           "lmi_pct": round(m["lmi_pct"], 1), "wind_ms": round(m["wind_ms"], 2), "radius": round(m["radius"], 2),
                           "chart_t": round(m["chart_t"], 2), "kind": k})
        elif k == "haul_truck":
            joints = {"body": round(math.radians(m["body_deg"]), 4)}
        elif k == "telehandler":
            joints = {"boom": round(m.get("boom_angle", 0.0), 4), "extension": round(m.get("ext", 0.0), 3)}
        elif k == "piling_rig":
            joints = {"hammer": round(m.get("pile_depth", 0.0), 2)}
        out_m.append({"id": m["id"], "kind": k, "x": round(m["x"], 3), "y": round(m["y"], 3), "z": round(z, 2), "heading": round(m["heading"], 4),
                      "joints": joints, "speed": round(m.get("speed", 0.0), 3), "mode": m["mode"], "load_t": round(m.get("load_t", 0.0), 2),
                      "fuel_pct": m.get("fuel_pct", 0), "health": m["health"], "task": m.get("task", ""), "ecus": len(m["ecus"])})
    workers = [{"id": w["id"], "role": w["role"], "x": round(w["tag_x"], 2), "y": round(w["tag_y"], 2), "heading": round(w["heading"], 3),
                "zone": w["zone"], **({"predicted": st["ml"]["worker_path"][w["id"]]} if w["id"] in st["ml"]["worker_path"] else {})}
               for w in st["workers"].values()]
    wx = st["weather"]
    stops = [{"machine": m["id"], "rule": m["simplex"]["rule"] or m["safety"].get("rule", ""), "since": round(m["simplex"]["since"] or st["t"], 2)}
             for m in ms.values() if m["mode"] in ("hold", "offline")]
    warn = any(w["zone"] != "ok" for w in st["workers"].values()) or any(m["mode"] == "fallback" for m in ms.values())
    sens = {sid: s.get("last") for sid, s in st["sensors"].items()}
    return {
        "type": "state", "t": round(st["t"], 3), "seq": st["seq"], "machines": out_m, "workers": workers, "cranes": cranes,
        "terrain": {"rev": st["terrain"]["rev"]},
        "sensors": {"wind_ms": round(wx["wind"], 2), "gust_ms": round(wx["peak3"], 2), "dust_ugm3": sens.get("DU-1") or 30,
                    "noise_db": sens.get("NO-1") or 65, "wall_tilt_mm": sens.get("TL-1") or 1.0},
        "safety": {"envelope": "stop" if stops else ("warn" if warn else "ok"), "active_stops": stops},
        "kpi": {"m3_moved": round(st["m3_moved"], 1), "cycles": st["cycles"],
                "trucks_waiting": sum(1 for m in ms.values() if m["kind"] == "haul_truck" and m["phase"] == "queue")},
        "plan": {"source": st["plan"]["source"] if st["ai_available"] else "fallback", "version": st["plan"]["version"]},
        "ai_available": st["ai_available"],
        "rules": {k: (st["rules"].get(k) or {}).get("version") for k in RULE_KEYS},
        "vecus": sum(len(m["ecus"]) for m in ms.values()),
    }


def brief(st) -> dict:
    """A compact picture of the site for the agents."""
    ms = st["machines"]
    return {
        "t": round(st["t"], 1),
        "machines": {m["id"]: {"kind": m["kind"], "mode": m["mode"], "task": m.get("task", ""), "health": m["health"],
                               "dtcs": m["dtcs"], **({"assigned": m["assign"]} if m["kind"] == "haul_truck" else {}),
                               **({"queue": [x.get("id") for x in st["lift_queue"].get(m["id"], [])], "lmi_pct": round(m["lmi_pct"], 1),
                                   "wind_ms": m["wind_ms"]} if m["kind"] in ("tower_crane", "mobile_crane") else {})}
                     for m in ms.values()},
        "weather": {"wind_ms": round(st["weather"]["wind"], 1), "gust_forecast_ms": st["ml"].get("gust_forecast_ms")},
        "kpi": {"m3_moved": round(st["m3_moved"], 1), "cycles": st["cycles"]},
        "active_stops": [{"machine": m["id"], "rule": m["simplex"]["rule"]} for m in ms.values() if m["mode"] in ("hold", "offline")],
        "latched": [m["id"] for m in ms.values() if m["simplex"]["latched"]],
        "plan": {"source": st["plan"]["source"], "version": st["plan"]["version"], "summary": st["plan"].get("summary", "")},
        "lifts_pending": {k: [{"id": x.get("id"), "label": x.get("label"), "params": x.get("params")} for x in v] for k, v in st["lift_queue"].items()},
        "vocabulary": {k: sorted(v) for k, v in VERBS.items()},
        "locations": list(L.LOCATIONS),
        "recent": st["recent"][-20:],
    }


def dispatch_facts(st) -> dict:
    ms = st["machines"]
    q = {"EX1": 0, "EX2": 0}
    for m in ms.values():
        if m["kind"] == "haul_truck" and m["phase"] in ("queue", "spot", "loading", "to_queue"):
            q[m["assign"]["ex"]] += 1
    trucks = []
    rows = []
    for m in ms.values():
        if m["kind"] != "haul_truck":
            continue
        for ex in ("EX1", "EX2"):
            bay = L.NODES["bay1" if ex == "EX1" else "bay2"]
            haul = _route_len(L.route_haul(ex, "spoil", m["dump_idx"])) + dist(m["x"], m["y"], bay[0], bay[1])
            rows.append([round(haul, 1), q[ex], 1 if m["mode"] == "fallback" else 0, 1 if ex == "EX1" else 0])
        trucks.append({"id": m["id"], "phase": m["phase"], "assigned": m["assign"]["ex"], "x": round(m["x"], 1), "y": round(m["y"], 1),
                       "load_t": m["load_t"], "mode": m["mode"]})
    return {"trucks": trucks, "queues": q, "excavators": {ex: {"mode": ms[ex]["mode"], "task": ms[ex]["task"]} for ex in ("EX1", "EX2")},
            "cycle_rows": rows, "row_order": "for each truck, EX1 then EX2: haul_m, queue_len, fallback, is_ex1"}


def aemp(st) -> dict:
    now = int(1_790_000_000 + st["t"])
    eq = []
    for m in st["machines"].values():
        if not m["ecus"]:
            continue
        lat, lon = L.latlon(m["x"], m["y"])
        s = m["sig"]
        eq.append({
            "EquipmentHeader": {"OEMName": "Groundwork twin", "Model": m["kind"], "EquipmentID": m["id"], "SerialNumber": f"NGY-{m['id']}"},
            "Location": {"datetime": now, "Latitude": round(lat, 7), "Longitude": round(lon, 7), "AltitudeUnits": "metre", "Altitude": round(120 + m.get("z", 0), 1)},
            "CumulativeOperatingHours": {"datetime": now, "Hour": round(s.get("hours", 0), 2)},
            "CumulativeIdleHours": {"datetime": now, "Hour": round(m.get("idle_s", 0) / 3600, 3)},
            "FuelUsed": {"datetime": now, "FuelUnits": "litre", "FuelConsumed": round(s.get("tank_l", 400) - s.get("fuel_l", 0), 1)},
            "FuelRemaining": {"datetime": now, "Percent": m.get("fuel_pct", 0)},
            "FaultCode": [{"CodeIdentifier": f"SPN {d[0]} FMI {d[1]}", "CodeDescription": J.SPN_TEXT.get(d[0], ""), "CodeSeverity": "high" if (d[0], d[1]) in V.CRITICAL_DTCS else "medium",
                           "CodeSource": "J1939 DM1", "SPN": d[0], "FMI": d[1], "OccurrenceCount": d[2]} for d in m["dtcs"]],
        })
    return {"Fleet": {"version": "2", "snapshotTime": now, "standard": "ISO 15143-3 (AEMP 2.0)", "Equipment": eq}}


def step(st: dict, inp: dict) -> dict:
    t_start = time.perf_counter()
    n = max(1, min(50, int(inp.get("ticks", 5))))
    ev: list = []
    out = {"bus": [], "events": [], "ml": {}}
    st["ml_payload_rows"] = st.get("ml_payload_rows") or []
    # inputs that arrive with this step
    for k, e in (inp.get("rules") or {}).items():
        if k in RULE_KEYS and e and e.get("rules"):
            old = st["rules"].get(k) or {}
            if old.get("version") != e.get("version") or old.get("hash") != e.get("hash"):
                try:
                    R.table(e)
                    st["rules"][k] = {"key": k, "version": e.get("version"), "hash": e.get("hash"), "rules": e["rules"]}
                    ev.append({"kind": "plan_change", "title": f"Rules {k} v{e.get('version')} in force", "detail": "Fetched from Abenix Decisions"})
                except ValueError as x:
                    ev.append({"kind": "fault", "title": f"Rules {k} refused", "detail": str(x)})
    if inp.get("ml_results"):
        apply_ml(st, inp["ml_results"], ev)
    apply_faults(st, inp.get("faults"), ev)
    for d in inp.get("dispatch") or []:
        if d.get("truck") in st["machines"]:
            st["dispatch"][d["truck"]] = {"ex": d.get("ex"), "dest": d.get("dest", "spoil"), "action_id": d.get("action_id")}
    if inp.get("plan"):
        p = inp["plan"]
        chk = check_plan(st, p.get("tree"))
        if chk["ok"]:
            st["plan"] = {"source": "ai", "version": st["plan"]["version"] + 1, "tree": p["tree"], "summary": p.get("summary", ""),
                          "approved_by": p.get("approved_by"), "execution_id": p.get("execution_id")}
            st["fallback_changed"] = True
            ev.append({"kind": "plan_change", "title": f"Plan v{st['plan']['version']} in force", "detail": p.get("summary", "")})
        else:
            ev.append({"kind": "plan_change", "title": "Plan refused by the twin", "detail": "; ".join(chk["problems"])[:400]})
    if inp.get("clear_simplex"):
        clear_simplex(st, inp["clear_simplex"], ev, inp.get("cleared_by", "Approved in Abenix"))
    if inp.get("telehandler_code"):
        add_telehandler(st, inp["telehandler_code"], ev)
    if "ai_available" in inp:
        st["ai_available"] = bool(inp["ai_available"]) and not (st["faults"]["ai_offline"] or st["faults"]["killed"])
    if "tasks" not in st or st.pop("fallback_changed", False):
        _assign_tasks(st)
    if inp.get("audit"):
        for a in inp["audit"]:
            if a.get("twin") != a.get("abenix"):
                st["audit_mismatch"] += 1
                ev.append({"kind": "fault", "title": "Rule mismatch between the twin and Abenix", "detail": str(a)[:300]})
    _compile_ai(st)
    tabs = _tables(st)
    d = T.decode(st["terrain"]["delta"])
    st["terrain_dirty"] = False
    budget = int(inp.get("bus_budget", 12))
    frames: list = []
    counts = [0]
    seen: dict = {}

    def want(mid, code):
        k = (mid, code)
        if len(frames) >= budget * 3:
            return False
        c = seen.get(k, 0)
        seen[k] = c + 1
        return c == 0 and (sh(k) + st["tick"]) % 7 == 0

    def want_sensor(sid):
        return len(frames) < budget * 3 and (sh(sid) + st["tick"]) % 3 == 0

    safety_times: list = []
    for _ in range(n):
        st["tick"] += 1
        st["t"] = round(st["tick"] * DT, 6)
        tick_weather(st, ev)
        tick_workers(st, ev)
        for m in st["machines"].values():
            tick_faults(st, m, ev)
        safety_tick(st, tabs, ev, safety_times)
        for m in st["machines"].values():
            TICKERS[m["kind"]](st, m, d, ev)
            if m["kind"] == "haul_truck":
                m["z"] = round(T.height(d, m["x"], m["y"]), 2) if st["tick"] % 10 == 0 else m["z"]
            if abs(m.get("speed", 0.0)) < 0.05 and m["kind"] not in ("drone",):
                m["idle_s"] = m.get("idle_s", 0.0) + DT
            tick_bus(st, m, frames, counts, want)
        tick_sensors(st, frames, counts, want_sensor)
        _record(st)
        wx = st["weather"]
        wx["peak3"] = max(wx["wind"] + wx["gust"], wx["peak3"] - 0.6 * DT)
        if st["tick"] % 10 == 0:
            _ml_requests(st, out)
        if st["tick"] % 6000 == 0:
            out["aemp"] = aemp(st)
    if st["terrain_dirty"]:
        st["terrain"]["delta"] = T.encode(d)
        st["terrain"]["rev"] += 1
    st["seq"] += 1
    # keep the bus sample inside the budget, DM1 with faults first
    frames.sort(key=lambda f: 0 if f.get("pgn") in (J.DM1.pgn, J.TP_CM.pgn, J.TP_DT.pgn) and f.get("decoded", {}).get("dtcs") else 1)
    out["bus"] = frames[:budget]
    for e in ev:
        e.setdefault("t", round(st["t"], 3))
        e["type"] = "event"
        e.setdefault("machine", None)
    out["events"] = ev
    out["frame"] = frame(st, tabs)
    if st["t"] - st["last_plan_emit"] >= 1.0 or any(e["kind"] in ("plan_change", "safety_stop") for e in ev):
        out["plan"] = plan_frame(st)
        st["last_plan_emit"] = st["t"]
    if st["outcomes"]:
        out["outcomes"] = st["outcomes"]
        st["outcomes"] = []
    if inp.get("want_brief"):
        out["brief"] = brief(st)
    if inp.get("want_dispatch"):
        out["dispatch_facts"] = dispatch_facts(st)
    audit = []
    for m in st["machines"].values():
        if m["kind"] == "excavator" and m["safety"].get("facts"):
            audit.append({"machine": m["id"], "key": "gw.safety.exclusion", "facts": m["safety"]["facts"], "twin": (m["safety"].get("outcome") or {}).get("action")})
    out["audit_facts"] = audit
    st.pop("_ai_code", None)
    safety_times.sort()
    out["stats"] = {
        "ticks": n, "t": st["t"], "frames_encoded": counts[0], "vecus": sum(len(m["ecus"]) for m in st["machines"].values()),
        "safety_us_p99": round(1e6 * safety_times[min(len(safety_times) - 1, int(0.99 * len(safety_times)))], 1) if safety_times else 0,
        "run_ms": round((time.perf_counter() - t_start) * 1000, 2),
    }
    out["state"] = st
    return out
