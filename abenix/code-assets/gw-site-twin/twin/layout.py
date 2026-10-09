"""Northgate Yard: the static layout. Site frame in metres, origin at the centre, x east, y north."""

from __future__ import annotations

import math

SIZE = 200.0
# arbitrary datum for J1939 vehicle position, it points at no real site
ORIGIN_LAT = 45.0
ORIGIN_LON = 7.0
M_PER_DEG_LAT = 111_132.0
M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(ORIGIN_LAT))

GROUND_Z = 0.0
DESIGN_Z = -8.0
PIT = (-50.0, -30.0, 10.0, 30.0)
SPOIL = (40.0, -90.0, 90.0, -40.0)
LAYDOWN = (-75.0, 45.0, -55.0, 70.0)
GATE = (0.0, -98.0)

TC1_BASE = (-20.0, 38.0)
TC1_TOWER_H = 48.0
TC1_JIB = 55.0
MC1_BASE = (30.0, 30.0)
MC1_BOOM = 32.0
MC1_PIVOT_H = 3.0

EX1_BASE = (-6.0, -14.0)
EX2_BASE = (-38.0, 16.0)
EX_SWING_RADIUS = 10.5
PILE_RADIUS = 8.0
TH_RADIUS = 7.0

NODES = {
    "gate": (0.0, -98.0),
    "gate_in": (6.0, -80.0),
    "j1": (28.0, -58.0),
    "ramp_top": (26.0, -42.0),
    "ramp_bot": (8.0, -26.0),
    "q1": (14.0, -26.0),
    "bay1": (2.0, -19.0),
    "pit_mid": (-12.0, -4.0),
    "q2": (-4.0, 0.0),
    "bay2": (-30.0, 9.0),
    "spoil_in": (46.0, -58.0),
}

DUMP_POINTS = [(52.0 + 7.0 * (i % 5), -50.0 - 9.0 * (i // 5)) for i in range(20)]

LOCATIONS = {
    "laydown": (-62.0, 58.0),
    "laydown_b": (-68.0, 50.0),
    "core": (-25.0, 5.0),
    "deck_west": (-40.0, -5.0),
    "deck_east": (0.0, 18.0),
    "rebar_yard": (-58.0, 66.0),
    "pile_cage_store": (45.0, 20.0),
    "east_wall": (15.0, 5.0),
    "east_wall_n": (14.0, 22.0),
}

PILES = [(18.0, -24.0 + 4.0 * i) for i in range(13)]


def latlon(x: float, y: float) -> tuple[float, float]:
    return ORIGIN_LAT + y / M_PER_DEG_LAT, ORIGIN_LON + x / M_PER_DEG_LON


def rect(r):
    x0, y0, x1, y1 = r
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def in_rect(r, x, y, pad=0.0) -> bool:
    return r[0] - pad <= x <= r[2] + pad and r[1] - pad <= y <= r[3] + pad


def path(*names):
    return [list(NODES[n]) if isinstance(n, str) else list(n) for n in names]


def route_to_bay(ex: str):
    if ex == "EX1":
        return path("ramp_top", "ramp_bot", "q1")
    return path("ramp_top", "ramp_bot", "pit_mid", "q2")


def route_haul(ex: str, dest: str, dump_idx: int):
    start = ["bay1"] if ex == "EX1" else ["bay2", "pit_mid"]
    if dest == "gate":
        return path(*start, "ramp_bot", "ramp_top", "j1", "gate_in", "gate")
    return path(*start, "ramp_bot", "ramp_top", "j1", "spoil_in") + [list(DUMP_POINTS[dump_idx % len(DUMP_POINTS)])]


def route_return(dest: str, dump_idx: int):
    if dest == "gate":
        return path("gate", "gate_in", "j1")
    return [list(DUMP_POINTS[dump_idx % len(DUMP_POINTS)])] + path("spoil_in", "j1")


def site() -> dict:
    """What GET /site serves."""
    return {
        "name": "Northgate Yard",
        "size": SIZE,
        "origin": {"lat": ORIGIN_LAT, "lon": ORIGIN_LON, "note": "arbitrary datum, not a real place"},
        "zones": [
            {"id": "pit", "kind": "excavation", "label": "Basement excavation", "polygon": rect(PIT)},
            {"id": "spoil", "kind": "spoil", "label": "Spoil area", "polygon": rect(SPOIL)},
            {"id": "laydown", "kind": "laydown", "label": "Laydown", "polygon": rect(LAYDOWN)},
            {"id": "piling", "kind": "exclusion", "label": "Piling exclusion", "polygon": rect((12.0, -30.0, 24.0, 28.0))},
            {"id": "welfare", "kind": "welfare", "label": "Cabins and welfare", "polygon": rect((-92.0, -92.0, -66.0, -78.0))},
            {"id": "ex1_swing", "kind": "swing", "label": "EX1 swing radius", "x": EX1_BASE[0], "y": EX1_BASE[1], "r": EX_SWING_RADIUS},
            {"id": "ex2_swing", "kind": "swing", "label": "EX2 swing radius", "x": EX2_BASE[0], "y": EX2_BASE[1], "r": EX_SWING_RADIUS},
        ],
        "haul_roads": [
            {"id": "ramp", "label": "Ramp", "points": path("ramp_top", "ramp_bot", "q1", "bay1")},
            {"id": "pit_road", "label": "Pit floor to EX2", "points": path("ramp_bot", "pit_mid", "q2", "bay2")},
            {"id": "haul_spoil", "label": "Haul road to spoil", "points": path("ramp_top", "j1", "spoil_in") + [list(DUMP_POINTS[7])]},
            {"id": "haul_gate", "label": "Haul road to gate", "points": path("j1", "gate_in", "gate")},
        ],
        "spoil_area": rect(SPOIL),
        "pit": rect(PIT),
        "building_footprint": rect((-46.0, -26.0, 6.0, 26.0)),
        "design_surface": {"depth": DESIGN_Z, "formation_z": DESIGN_Z, "polygon": rect(PIT)},
        "crane_bases": [
            {"id": "TC1", "kind": "tower", "x": TC1_BASE[0], "y": TC1_BASE[1], "radius": TC1_JIB + 2.0, "height": TC1_TOWER_H},
            {"id": "MC1", "kind": "mobile", "x": MC1_BASE[0], "y": MC1_BASE[1], "radius": MC1_BOOM},
        ],
        "gate": list(GATE),
        "locations": {k: list(v) for k, v in LOCATIONS.items()},
        "piles": [list(p) for p in PILES],
        "surroundings": {"river": "west", "rail": "east", "roads": "grid"},
    }
