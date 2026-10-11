"""The four machines with industrial PCs, their buses and where the site layout puts them."""

from __future__ import annotations

import math

from .frames import L, SA

# J1939 NAME function codes. Engine, transmission and the cellular communications unit use the global codes,
# the rest the construction industry group's own range from 128.
FUNCTION = {
    "engine": 0, "transmission": 3, "telematics": 28, "gateway": 75, "hydraulics": 129, "safety": 130, "swing": 131,
    "payload": 132, "blade": 133, "slew": 134, "hoist": 135, "lmi": 136, "controller": 137,
}

# devices per node, per the shared contract, then the containers on that machine's bus
MACHINES = {
    "EX1": {"kind": "excavator", "node": "ipc-ex1", "devices": ["engine", "telematics", "safety", "hydraulics", "swing"]},
    "TC1": {"kind": "tower_crane", "node": "ipc-tc1", "devices": ["engine", "telematics", "safety", "slew", "hoist", "lmi"]},
    "HT1": {"kind": "haul_truck", "node": "ipc-ht1", "devices": ["engine", "telematics", "safety", "transmission", "payload"]},
    "DZ1": {"kind": "dozer", "node": "ipc-dz1", "devices": ["engine", "telematics", "safety", "transmission", "blade"]},
}
ROLES = {m: spec["devices"] + ["controller", "gateway"] for m, spec in MACHINES.items()}


def preferred_sa(machine: str, role: str) -> int:
    # HT1's payload weighing unit ships with the same default address as its transmission, so every power-up
    # shows a real address claim contest: the lower NAME keeps 0x03, the weigher moves into 128 to 247
    if machine == "HT1" and role == "payload":
        return SA["transmission"]
    return SA[role]


def identity(machine: str, role: str) -> int:
    return (sum(ord(c) for c in machine) * 977 + FUNCTION[role] * 31) & 0x1FFFFF


def initial_plant(machine: str) -> dict:
    base = {"rpm": 850, "coolant": 80, "oil_t": 86, "fuel_l": 300, "hours": 1840 + 113 * (ord(machine[0]) % 7), "fuel_rate": 6}
    if machine == "EX1":
        bx, by = L.EX1_BASE
        bay = L.NODES["bay1"]
        return {**base, "x": bx, "y": by, "heading": math.atan2(bay[1] - by, bay[0] - bx), "boom": 0.2, "stick": 0.5,
                "bucket": 0.4, "hyd_t": 55, "p1": 40, "p2": 35, "boom_head": 60}
    if machine == "HT1":
        p = L.route_to_bay("EX1")[0]
        return {**base, "x": p[0], "y": p[1], "heading": 0.0}
    if machine == "DZ1":
        x, y = L.DZ1_START
        return {**base, "x": x, "y": y, "heading": 0.0}
    x, y = L.TC1_BASE
    return {**base, "x": x, "y": y, "heading": 0.0, "slew": 0.0, "radius": 20.0, "hook_z": 30.0, "chart_t": 12.0}
