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

# where each excavator's bucket digs, as a direction from its base
EX1_DIG = math.atan2(-1.0, -1.0)
EX2_DIG = math.atan2(0.6, -1.0)

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
WORKER_BOUND = 96.0

DZ1_START = (52.0, -70.0)
RL1_START = (60.0, -84.0)
DOZER_LANES = [-48.0, -56.0, -64.0, -72.0, -80.0]
ROLLER_LANES = [-52.0, -60.0, -68.0, -76.0, -86.0]
SPOIL_RUN = (44.0, 86.0)

D1_START = (-50.0, -30.0)
D1_GRID = [(-50.0, -30.0), (10.0, -30.0), (10.0, -15.0), (-50.0, -15.0), (-50.0, 0.0), (10.0, 0.0), (10.0, 15.0), (-50.0, 15.0), (-50.0, 30.0), (10.0, 30.0)]
D2_START = (70.0, 0.0)
D2_ORBIT = (-10.0, 0.0, 70.0)

# node names or points, from the gate to where the telehandler unloads
TH_ROUTE = ["gate", "gate_in", (-20.0, -70.0), (-80.0, -40.0), (-84.0, 26.0)]

# truck routes as node names, the loading leg is always queue to bay
ROUTES = {
    "to_bay": {"EX1": ["ramp_top", "ramp_bot", "q1"], "EX2": ["ramp_top", "ramp_bot", "pit_mid", "q2"]},
    "haul": {
        ("EX1", "gate"): ["bay1", "ramp_bot", "ramp_top", "j1", "gate_in", "gate"],
        ("EX2", "gate"): ["bay2", "pit_mid", "ramp_bot", "ramp_top", "j1", "gate_in", "gate"],
        ("EX1", "spoil"): ["bay1", "ramp_bot", "ramp_top", "j1", "spoil_in"],
        ("EX2", "spoil"): ["bay2", "pit_mid", "ramp_bot", "ramp_top", "j1", "spoil_in"],
    },
    "return_gate": ["gate", "gate_in", "j1"],
    "return_spoil": ["spoil_in", "j1"],
}

HAUL_ROADS = [
    {"id": "ramp", "label": "Ramp", "nodes": ["ramp_top", "ramp_bot", "q1", "bay1"]},
    {"id": "pit_road", "label": "Pit floor to EX2", "nodes": ["ramp_bot", "pit_mid", "q2", "bay2"]},
    {"id": "haul_spoil", "label": "Haul road to spoil", "nodes": ["ramp_top", "j1", "spoil_in", "dump7"]},
    {"id": "haul_gate", "label": "Haul road to gate", "nodes": ["j1", "gate_in", "gate"]},
]

ZONES_EXTRA = [
    {"id": "piling", "kind": "exclusion", "label": "Piling exclusion", "rect": (12.0, -30.0, 24.0, 28.0)},
    {"id": "welfare", "kind": "welfare", "label": "Cabins and welfare", "rect": (-92.0, -92.0, -66.0, -78.0)},
]
BUILDING = (-46.0, -26.0, 6.0, 26.0)
SURROUNDINGS = {"river": "west", "rail": "east", "roads": "grid"}
IMAGERY = None
LAYOUT = "northgate"


def zone_of(x: float, y: float) -> str:
    """Truck zone for the speed rules: gate, pit or haul road."""
    if LAYOUT == "northgate":
        return "gate" if y < -85 else ("pit" if in_rect(PIT, x, y, 2.0) or x < 26 and y > -44 and x > -2 and y < -20 else "haul_road")
    gx, gy = GATE
    if math.hypot(x - gx, y - gy) < 14.0:
        return "gate"
    return "pit" if in_rect(PIT, x, y, 2.0) else "haul_road"


# The real site: the same Northgate Yard work laid on a real drone orthophoto of an excavation.
# Metres east and north of the photo anchor, so the web lays the photo down unmoved.
# Every road follows tracks the photo shows and none crosses a heap, the pond or the slab.
NH108 = {
    "PIT": (-35.0, -8.0, 25.0, 28.0),
    "SPOIL": (-94.0, -3.0, -76.0, 6.0),
    "LAYDOWN": (-62.0, 8.0, -48.0, 16.0),
    "GATE": (38.0, -18.0),
    "TC1_BASE": (-50.0, 30.0),
    "MC1_BASE": (-14.0, 47.0),
    "MC1_BOOM": 26.0,
    "EX1_BASE": (4.0, 4.0),
    "EX2_BASE": (-36.0, 10.0),
    "EX1_DIG": math.atan2(1.0, 0.8),
    "EX2_DIG": math.atan2(1.0, -0.15),
    "NODES": {
        "gate": (38.0, -18.0),
        "gate_in": (12.0, -20.0),
        "j1": (-18.0, -1.0),
        "ramp_top": (-18.0, -1.0),
        "ramp_bot": (-8.0, -11.0),
        "q1": (-8.0, -11.0),
        "bay1": (-3.0, -3.0),
        "pit_mid": (-28.0, 4.5),
        "q2": (-28.0, 4.5),
        "e1_in": (-16.0, -14.0),
        "bay2": (-43.0, 4.0),
        "w_mid": (-45.0, 4.0),
        "spoil_in": (-70.0, 1.5),
    },
    "DUMP_POINTS": [(-91.0 + 3.5 * (i % 5), 3.5 - 1.5 * (i // 5)) for i in range(20)],
    "LOCATIONS": {
        "laydown": (-55.0, 11.0),
        "laydown_b": (-50.0, 10.0),
        "core": (-72.0, 27.0),
        "deck_west": (-84.0, 22.0),
        "deck_east": (-62.0, 20.0),
        "rebar_yard": (-58.0, 13.0),
        "pile_cage_store": (-2.0, 43.0),
        "east_wall": (-34.0, 44.0),
        "east_wall_n": (-26.0, 44.0),
    },
    "PILES": [(-46.0 + 3.5 * i, 46.0) for i in range(13)],
    # every worker stands clear of both swing radii and the haul roads, W07 walks in on cue
    "WORKER_SPECS": [
        ("W01", "banksman", [(22.0, -8.0), (26.0, -9.0)], 0.0),
        ("W02", "banksman", [(-66.0, 24.0), (-62.0, 22.0)], 0.0),
        ("W03", "slinger", [(-56.0, 15.0), (-52.0, 14.0), (-58.0, 13.0)], 0.0),
        ("W04", "slinger", [(-70.0, 28.0), (-74.0, 24.0)], 0.0),
        ("W05", "surveyor", [(-88.0, 28.0), (-60.0, 28.0), (-60.0, 18.0), (-88.0, 18.0)], 0.0),
        ("W06", "labourer", [(-86.0, 20.0), (-88.0, 26.0)], 0.0),
        ("W07", "labourer", [(18.0, -6.0), (20.0, -2.0), (16.0, -8.0)], 0.0),
        ("W08", "labourer", [(-70.0, 33.0), (-82.0, 33.0)], 0.0),
        ("W09", "labourer", [(16.0, -31.0), (22.0, -30.0)], 0.0),
        ("W10", "labourer", [(-46.0, 24.0), (-48.0, 20.0)], 0.0),
        ("W11", "piling helper", [(-56.0, 38.0), (-58.0, 36.0)], 0.0),
        ("W12", "site engineer", [(-60.0, 20.0), (-56.0, 15.0), (-88.0, 26.0), (-62.0, 34.0)], 0.0),
        ("W13", "visitor", [(20.0, -32.0)], 0.0),
        ("W14", "labourer", [(-20.0, -14.0), (-26.0, -12.0)], 0.0),
    ],
    "WORKER_BOUND": 96.0,
    "DZ1_START": (-90.0, 3.0),
    "RL1_START": (-84.0, -1.0),
    "DOZER_LANES": [4.0, 2.0, 0.0, -2.0],
    "ROLLER_LANES": [-1.0, 1.0, 3.0, 5.0],
    "SPOIL_RUN": (-92.0, -78.0),
    "D1_START": (-30.0, -6.0),
    "D1_GRID": [(-30.0, -6.0), (20.0, -6.0), (20.0, 4.0), (-30.0, 4.0), (-30.0, 14.0), (20.0, 14.0), (20.0, 24.0), (-30.0, 24.0)],
    "D2_START": (25.0, 10.0),
    "D2_ORBIT": (-35.0, 10.0, 60.0),
    "TH_ROUTE": ["gate", "gate_in", "j1", "w_mid", (-52.0, 6.0)],
    "ROUTES": {
        "to_bay": {"EX1": ["e1_in", "q1"], "EX2": ["q2"]},
        "haul": {
            ("EX1", "gate"): ["bay1", "q1", "gate_in", "gate"],
            ("EX2", "gate"): ["bay2", "q2", "j1", "gate_in", "gate"],
            ("EX1", "spoil"): ["bay1", "q1", "j1", "w_mid", "spoil_in"],
            ("EX2", "spoil"): ["bay2", "spoil_in"],
        },
        "return_gate": ["gate", "gate_in", "j1"],
        "return_spoil": ["spoil_in", "w_mid", "j1"],
    },
    "HAUL_ROADS": [
        {"id": "ex1_bay", "label": "Queue to EX1", "nodes": ["j1", "e1_in", "q1", "bay1"]},
        {"id": "ex2_bay", "label": "Floor to EX2", "nodes": ["j1", "q2", "bay2"]},
        {"id": "haul_spoil", "label": "Haul road to spoil", "nodes": ["j1", "w_mid", "spoil_in", "dump7"]},
        {"id": "haul_gate", "label": "Haul road to gate", "nodes": ["q1", "gate_in", "gate"]},
    ],
    "ZONES_EXTRA": [
        {"id": "piling", "kind": "exclusion", "label": "Piling exclusion", "rect": (-49.0, 42.0, -1.0, 50.0)},
        {"id": "welfare", "kind": "welfare", "label": "Cabins and welfare", "rect": (10.0, -34.0, 26.0, -27.0)},
    ],
    "BUILDING": (-92.0, 15.0, -55.0, 36.0),
    "SURROUNDINGS": {"woods": "south", "road": "east", "fields": "north"},
    "IMAGERY": {"site": "nh108", "frame": "metres east and north of the photo anchor", "kind": "orthophoto"},
}

_NAMES = list(NH108)
_DEFAULT = {k: globals()[k] for k in _NAMES}
LAYOUTS = ("northgate", "nh108")


def use(name: str | None) -> str:
    """Switch the layout the twin reads. Every op calls this before it touches the world."""
    global LAYOUT
    name = name or "northgate"
    if name not in LAYOUTS:
        raise ValueError(f"unknown layout {name}, one of {', '.join(LAYOUTS)}")
    if name == LAYOUT:
        return name
    src = NH108 if name == "nh108" else _DEFAULT
    g = globals()
    for k in _NAMES:
        g[k] = src[k]
    LAYOUT = name
    return name


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
    return path(*ROUTES["to_bay"]["EX1" if ex == "EX1" else "EX2"])


def route_haul(ex: str, dest: str, dump_idx: int):
    ex = "EX1" if ex == "EX1" else "EX2"
    if dest == "gate":
        return path(*ROUTES["haul"][(ex, "gate")])
    return path(*ROUTES["haul"][(ex, "spoil")]) + [list(DUMP_POINTS[dump_idx % len(DUMP_POINTS)])]


def route_return(dest: str, dump_idx: int):
    if dest == "gate":
        return path(*ROUTES["return_gate"])
    return [list(DUMP_POINTS[dump_idx % len(DUMP_POINTS)])] + path(*ROUTES["return_spoil"])


def _road(nodes):
    return [list(DUMP_POINTS[int(n[4:])]) if isinstance(n, str) and n.startswith("dump") else list(NODES[n]) for n in nodes]


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
            *[{"id": z["id"], "kind": z["kind"], "label": z["label"], "polygon": rect(z["rect"])} for z in ZONES_EXTRA],
            {"id": "ex1_swing", "kind": "swing", "label": "EX1 swing radius", "x": EX1_BASE[0], "y": EX1_BASE[1], "r": EX_SWING_RADIUS},
            {"id": "ex2_swing", "kind": "swing", "label": "EX2 swing radius", "x": EX2_BASE[0], "y": EX2_BASE[1], "r": EX_SWING_RADIUS},
        ],
        "haul_roads": [{"id": r["id"], "label": r["label"], "points": _road(r["nodes"])} for r in HAUL_ROADS],
        "spoil_area": rect(SPOIL),
        "pit": rect(PIT),
        "building_footprint": rect(BUILDING),
        "design_surface": {"depth": DESIGN_Z, "formation_z": DESIGN_Z, "polygon": rect(PIT)},
        "crane_bases": [
            {"id": "TC1", "kind": "tower", "x": TC1_BASE[0], "y": TC1_BASE[1], "radius": TC1_JIB + 2.0, "height": TC1_TOWER_H},
            {"id": "MC1", "kind": "mobile", "x": MC1_BASE[0], "y": MC1_BASE[1], "radius": MC1_BOOM},
        ],
        "gate": list(GATE),
        "locations": {k: list(v) for k, v in LOCATIONS.items()},
        "piles": [list(p) for p in PILES],
        "surroundings": dict(SURROUNDINGS),
        **({"layout": LAYOUT, "imagery": dict(IMAGERY)} if IMAGERY else {}),
    }
