"""The physical machine. Every ECU container maps the same file from a shared in-memory volume, the way real ECUs
share one steel body: the swing motor moves the boom, the hydraulic pressure transducer reads the result.

Each field has exactly one writer, the ECU that owns that actuator or sensor. Controllers and the gateway never
touch the plant, they only see the bus.
"""

from __future__ import annotations

import mmap
import os
import struct
import time
from pathlib import Path

FIELDS = (
    "magic", "x", "y", "z", "heading", "speed", "gear",
    "swing", "boom", "stick", "bucket", "r_swing", "r_boom", "r_stick", "r_bucket",
    "p1", "p2", "boom_head", "hyd_t", "flow",
    "body_deg", "load_t", "blade_m", "blade_load",
    "slew", "slew_rate", "radius", "radius_rate", "hook_z", "rope_speed", "crane_load_t", "lmi_pct", "chart_t", "wind",
    "rpm", "torque", "coolant", "oil_t", "fuel_rate", "fuel_l", "hours", "revs", "eng_load",
    "wear",
)
IDX = {f: i for i, f in enumerate(FIELDS)}
SIZE = 8 * len(FIELDS)
MAGIC = 0x4757504C  # GWPL


class Plant:
    def __init__(self, machine: str, init: dict):
        root = Path(os.environ.get("GW_PLANT_DIR", "/plant"))
        root.mkdir(parents=True, exist_ok=True)
        path = root / f"{machine.lower()}.bin"
        lock = root / f"{machine.lower()}.lock"
        # whoever starts first lays the machine down where the site layout puts it
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            buf = bytearray(SIZE)
            for k, v in {**init, "magic": MAGIC}.items():
                struct.pack_into("<d", buf, 8 * IDX[k], float(v))
            path.write_bytes(bytes(buf))
            os.close(fd)
        except FileExistsError:
            for _ in range(100):
                if path.exists() and path.stat().st_size == SIZE:
                    break
                time.sleep(0.05)
        self._f = open(path, "r+b")
        self._m = mmap.mmap(self._f.fileno(), SIZE)

    def __getitem__(self, k: str) -> float:
        return struct.unpack_from("<d", self._m, 8 * IDX[k])[0]

    def __setitem__(self, k: str, v: float) -> None:
        struct.pack_into("<d", self._m, 8 * IDX[k], float(v))
