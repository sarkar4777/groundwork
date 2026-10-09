"""Property: across thousands of random worker paths, no worker reaches a moving swing radius without a stop first."""

import math
import os
import random

from twin import layout as L
from twin import terrain as T
from twin import vecu as V
from twin import world as W

PATHS = int(os.environ.get("GW_SAFETY_PATHS", "2000"))


def _harness(rules, seed):
    st = W.init_state(seed)
    st["rules"] = rules
    st["machines"] = {"EX1": st["machines"]["EX1"]}
    st["workers"] = {"W07": st["workers"]["W07"]}
    st["ml_payload_rows"] = []
    W._assign_tasks(st)
    return st


def _moving(m):
    return any(abs(v) > 1e-3 for v in m["joints_rate"].values())


def test_rules_table_semantics(rules):
    from twin import rules as R
    t = R.table(rules["gw.safety.exclusion"])
    assert t.evaluate({"machine": {"tip_speed_ms": 3}, "worker": {"clearance_m": 3.5}})[1]["action"] == "stop"
    assert t.evaluate({"machine": {"tip_speed_ms": 0}, "worker": {"clearance_m": 3.5}})[1]["action"] == "warn"
    assert t.evaluate({"machine": {"tip_speed_ms": 0}, "worker": {"clearance_m": 1.0}})[1]["action"] == "stop"


def test_random_paths_never_reach_a_moving_swing_radius(rules):
    rnd = random.Random(7)
    tabs = None
    violations = []
    stops = 0
    d = T.decode(W.init_state(1)["terrain"]["delta"])
    for i in range(PATHS):
        st = _harness(rules, 1000 + i)
        tabs = tabs or W._tables(st)
        m = st["machines"]["EX1"]
        w = st["workers"]["W07"]
        # warm the excavator up into its swinging cycle
        for _ in range(rnd.randint(50, 400)):
            st["tick"] += 1
            st["t"] = st["tick"] * W.DT
            W.tick_excavator(st, m, d, [])
            V.TYPES["SWB"].tick(m, W.DT, {"t": st["t"], "ai_code": {}})
        a0 = rnd.random() * 2 * math.pi
        r0 = rnd.uniform(16, 30)
        w["x"], w["y"] = m["x"] + r0 * math.cos(a0), m["y"] + r0 * math.sin(a0)
        a1 = a0 + rnd.uniform(-0.6, 0.6)
        r1 = rnd.uniform(0.5, L.EX_SWING_RADIUS - 1)
        w["script"] = {"pts": [(m["x"] + r1 * math.cos(a1), m["y"] + r1 * math.sin(a1), 1.0)], "speed": rnd.uniform(0.8, 3.0)}
        w["tag_next"] = st["t"]
        stopped_at = None
        for _ in range(1500):
            st["tick"] += 1
            st["t"] = round(st["tick"] * W.DT, 6)
            W.tick_workers(st, [])
            W.safety_tick(st, tabs, [], [])
            W.tick_excavator(st, m, d, [])
            V.TYPES["SWB"].tick(m, W.DT, {"t": st["t"], "ai_code": {}})
            if m["mode"] == "hold" and stopped_at is None:
                stopped_at = st["t"]
            dist = math.hypot(w["x"] - m["x"], w["y"] - m["y"])
            if dist < L.EX_SWING_RADIUS:
                if _moving(m) or stopped_at is None:
                    violations.append((i, round(st["t"], 2), round(dist, 2), stopped_at, {k: round(v, 3) for k, v in m["joints_rate"].items()}))
                break
            if w.get("script") is None:
                break
        if stopped_at is not None:
            stops += 1
    assert not violations, violations[:5]
    assert stops > PATHS * 0.9


def test_truck_capped_near_worker(rules):
    st = W.init_state(3)
    st["rules"] = rules
    W._assign_tasks(st)
    tabs = W._tables(st)
    tr = st["machines"]["HT4"]
    w = st["workers"]["W09"]
    w["tag_x"], w["tag_y"] = tr["x"] + 8, tr["y"]
    W.safety_tick(st, tabs, [], [])
    assert tr["safety"]["cap_kmh"] == 10


def test_crane_wind_stop_and_gnss_hold(rules):
    st = W.init_state(3)
    st["rules"] = rules
    W._assign_tasks(st)
    tabs = W._tables(st)
    st["machines"]["TC1"]["wind_ms"] = 21.0
    st["machines"]["HT2"]["gnss"]["lost_s"] = 1.2
    W.safety_tick(st, tabs, [], [])
    assert st["machines"]["TC1"]["mode"] == "hold"
    assert st["machines"]["HT2"]["mode"] == "hold"


def test_no_rules_means_no_motion():
    st = W.init_state(3)
    W._assign_tasks(st)
    W.safety_tick(st, W._tables(st), [], [])
    assert all(m["mode"] == "hold" for m in st["machines"].values() if m["kind"] != "drone")


def test_safety_tick_is_fast(rules):
    import time
    st = W.init_state(5)
    st["rules"] = rules
    W._assign_tasks(st)
    tabs = W._tables(st)
    times = []
    for _ in range(2000):
        t0 = time.perf_counter()
        W.safety_tick(st, tabs, [], [])
        times.append(time.perf_counter() - t0)
    times.sort()
    assert times[int(0.99 * len(times))] < 0.001
