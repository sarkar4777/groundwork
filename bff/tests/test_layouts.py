"""The real-site layout: switching is clean, the rendered site is untouched, trucks stay on the photographed tracks."""

import json
import math

from twin import layout as L
from twin.api import run, unpack

# What the NH108 orthophoto shows that no machine may drive over, metres east and north of the photo anchor.
OBSTACLES = {
    "slab": (-92.0, 15.0, -55.0, 36.0),
    "slab annex": (-88.0, 7.0, -82.0, 15.0),
    "pond": (-78.0, -20.0, -40.0, -5.0),
    "trench": (-60.0, -4.4, -33.0, -0.4),
    "scrub with pond": (-42.0, 27.0, -20.0, 42.0),
    "scrub island": (-15.0, 6.0, 4.0, 22.0),
    "east heaps": (8.0, 6.0, 25.0, 28.0),
    "sandy mound": (-40.0, 14.0, -31.0, 25.0),
    "gravel pile": (-75.0, 6.0, -62.0, 14.0),
    "pipe store": (-60.0, 9.0, -50.0, 15.0),
    "woods south": (-100.0, -45.0, 10.0, -30.0),
}
TRUCK_HALF_WIDTH = 1.8


def _hit(x, y, pad=0.0):
    return [k for k, (x0, y0, x1, y1) in OBSTACLES.items() if x0 - pad <= x <= x1 + pad and y0 - pad <= y <= y1 + pad]


def _sample(pts, step=0.5):
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        n = max(1, int(math.dist((ax, ay), (bx, by)) / step))
        for i in range(n + 1):
            yield ax + (bx - ax) * i / n, ay + (by - ay) * i / n


def _site(**kw):
    out = run({"op": "site", **kw})
    out.pop("run_ms", None)
    return json.dumps(out, sort_keys=True)


def test_northgate_unchanged_by_switching():
    a = _site()
    _site(layout="nh108")
    b = _site()
    assert a == b
    assert "imagery" not in json.loads(a)


def test_layout_rides_in_the_state():
    out = run({"op": "init", "seed": 2026, "layout": "nh108"})
    assert out["site"]["imagery"]["site"] == "nh108"
    st = unpack(out["state_z"])
    assert st["layout"] == "nh108"
    # a northgate call in between must not leak into the next nh108 step
    run({"op": "init", "seed": 2026})
    o = run({"op": "step", "state_z": out["state_z"], "ticks": 5})
    assert unpack(o["state_z"])["layout"] == "nh108"
    assert L.LAYOUT == "nh108"


def test_every_route_misses_the_photographed_obstacles():
    L.use("nh108")
    try:
        routes = [L.route_to_bay("EX1"), L.route_to_bay("EX2"), L.route_return("gate", 0), L.path(*L.TH_ROUTE)]
        for ex in ("EX1", "EX2"):
            for i in range(len(L.DUMP_POINTS)):
                routes.append(L.route_haul(ex, "spoil", i))
                routes.append(L.route_return("spoil", i))
            routes.append(L.route_haul(ex, "gate", 0))
            routes.append(L.path("j1") + L.route_to_bay(ex))
        for r in routes:
            for x, y in _sample(r):
                assert not _hit(x, y, TRUCK_HALF_WIDTH), (r, x, y, _hit(x, y, TRUCK_HALF_WIDTH))
        for x0, y0, x1, y1 in [L.SPOIL]:
            for x in (x0, x1):
                for y in (y0, y1):
                    assert not _hit(x, y), ("spoil corner", x, y)
    finally:
        L.use("northgate")


def test_a_full_story_keeps_every_truck_on_the_tracks(rules):
    out = run({"op": "init", "seed": 2026, "layout": "nh108"})
    z = out["state_z"]
    worst = []
    for k in range(1200):
        inp = {"op": "step", "state_z": z, "ticks": 5}
        if k == 0:
            inp["rules"] = rules
        if k == 80:
            inp["faults"] = [{"kind": "worker_in_swing", "target": "EX1", "worker": "W07", "start_m": 17.5, "speed": 1.6}]
        o = run(inp)
        z = o["state_z"]
        for m in (o.get("frame") or {}).get("machines", []):
            if m["kind"] in ("haul_truck", "dozer", "roller", "telehandler"):
                h = _hit(m["x"], m["y"])
                if h:
                    worst.append((k, m["id"], m["x"], m["y"], h))
    assert not worst, worst[:5]
