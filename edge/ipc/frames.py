"""The J1939 dictionary the PCs speak: the twin's own encoder, plus the messages a machine's onboard network adds.

The twin's PGNs (EEC1, SWB1, SLEW1 and the rest) are imported as they are, so a frame from a PC and a frame from
the twin's virtual ECUs are byte for byte the same format. The extra messages below carry what a real machine's
controller, safety PLC and telematics gateway exchange: setpoints, safety commands, task transfer and site GNSS.
They live in proprietary B, PF 0xFF, group extensions 0x30 and up, clear of the twin's own.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# the twin's encoder ships beside this package in the image, or sits in the repo during development
_here = Path(__file__).resolve()
for cand in (_here.parent.parent / "twin_lib", _here.parents[2] / "abenix" / "code-assets" / "gw-site-twin"):
    if (cand / "twin" / "j1939.py").exists() and str(cand) not in sys.path:
        sys.path.insert(0, str(cand))
        break

from twin import j1939 as J  # noqa: E402
from twin import layout as L  # noqa: E402
from twin.j1939 import Pgn, Spn, PROPRIETARY_B  # noqa: E402

_reg = J._reg

# setpoints from the onboard controller to the actuator ECUs
XCMD1 = _reg(Pgn(PROPRIETARY_B | 0x30, "XCMD1", "Excavator joint setpoints (proprietary B)", 3, 20, (
    Spn("swing_target_rad", None, 0, 0, 16, 0.0001, -3.2, "rad"),
    Spn("boom_target_rad", None, 2, 0, 16, 0.0001, -3.2, "rad"),
    Spn("stick_target_rad", None, 4, 0, 16, 0.0001, -3.2, "rad"),
    Spn("bucket_target_rad", None, 6, 0, 16, 0.0001, -3.2, "rad"),
), True))

DRV1 = _reg(Pgn(PROPRIETARY_B | 0x31, "DRV1", "Drive setpoints (proprietary B)", 3, 20, (
    Spn("speed_target_mps", None, 0, 0, 16, 0.001, -32, "m/s"),
    Spn("heading_target_rad", None, 2, 0, 16, 0.0001, -3.2, "rad"),
    Spn("body_target_deg", None, 4, 0, 8, 0.5, 0, "deg"),
    Spn("blade_target_m", None, 5, 0, 16, 0.001, -32, "m"),
    Spn("payload_add_t", None, 7, 0, 8, 0.25, 0, "t"),
), True))

CRN1 = _reg(Pgn(PROPRIETARY_B | 0x32, "CRN1", "Crane setpoints (proprietary B)", 3, 20, (
    Spn("slew_target_rad", None, 0, 0, 16, 0.0001, -3.2, "rad"),
    Spn("radius_target_m", None, 2, 0, 16, 0.01, 0, "m"),
    Spn("hook_target_m", None, 4, 0, 16, 0.01, -100, "m"),
    Spn("load_t", None, 6, 0, 16, 0.01, 0, "t"),
), True))

# site-frame RTK position from the telematics unit, metres east and north of the site origin
GNSS1 = _reg(Pgn(PROPRIETARY_B | 0x35, "GNSS1", "Site position (proprietary B)", 3, 50, (
    Spn("x_m", None, 0, 0, 32, 0.0001, -100000, "m"),
    Spn("y_m", None, 4, 0, 32, 0.0001, -100000, "m"),
), True))

GNSS2 = _reg(Pgn(PROPRIETARY_B | 0x36, "GNSS2", "Heading and speed (proprietary B)", 3, 50, (
    Spn("heading_rad", None, 0, 0, 16, 0.0001, -3.2, "rad"),
    Spn("speed_mps", None, 2, 0, 16, 0.001, -32, "m/s"),
    Spn("z_m", None, 4, 0, 16, 0.01, -300, "m"),
    Spn("fix", None, 6, 0, 4),
    Spn("sats", None, 7, 0, 8),
), True))

TSTAT1 = _reg(Pgn(PROPRIETARY_B | 0x38, "TSTAT1", "Task state (proprietary B)", 6, 200, (
    Spn("state", None, 0, 0, 8),
    Spn("cycles", None, 1, 0, 16),
    Spn("task_seq", None, 3, 0, 16),
    Spn("progress_pct", None, 5, 0, 8, 0.4, 0, "%"),
), True))

GWHB1 = _reg(Pgn(PROPRIETARY_B | 0x39, "GWHB1", "Gateway heartbeat and uplink (proprietary B)", 6, 100, (
    Spn("uplink", None, 0, 0, 2),
    Spn("counter", None, 1, 0, 8),
), True))

# J1939-21 network management and transport, J1939-71 control
REQUEST = 59904        # 0xEA00, PDU1, data is the requested PGN
ACKM = 59392           # 0xE800, acknowledgement
ADDRESS_CLAIMED = 60928  # 0xEE00, PDU1, sent to global
PROP_A = 61184         # 0xEF00, PDU1 proprietary A, destination specific commands
CI = 65259             # component identification, on request, multi-packet
SOFT = 65242           # software identification, on request, multi-packet
TSC1 = _reg(Pgn(0, "TSC1", "Torque/Speed Control 1", 3, 10, (
    Spn("override_mode", 695, 0, 0, 2),
    Spn("speed_condition", 696, 0, 2, 2),
    Spn("override_priority", 897, 0, 4, 2),
    Spn("requested_speed_rpm", 898, 1, 0, 16, 0.125, 0, "rpm"),
    Spn("requested_torque_pct", 518, 3, 0, 8, 1, -125, "%"),
)))
J.PGNS.setdefault(REQUEST, Pgn(REQUEST, "RQST", "Request", 6, 0))
J.PGNS.setdefault(ACKM, Pgn(ACKM, "ACKM", "Acknowledgement", 6, 0))
J.PGNS.setdefault(ADDRESS_CLAIMED, Pgn(ADDRESS_CLAIMED, "AC", "Address Claimed", 6, 0))
J.PGNS.setdefault(PROP_A, Pgn(PROP_A, "PROPA", "Proprietary A", 6, 0, (), True))
J.PGNS.setdefault(CI, Pgn(CI, "CI", "Component Identification", 6, 0))
J.PGNS.setdefault(SOFT, Pgn(SOFT, "SOFT", "Software Identification", 6, 0))

# proprietary A command codes, first data byte
CMD_HOLD = 0x01        # byte 1: hold 0/1, bytes 2-3: command id
CMD_MODE = 0x02        # byte 1: mode code, bytes 2-3: command id
CMD_FAULT = 0x03       # byte 1: fault code, 0 clears
CMD_TASK = 0x10        # followed by the task JSON, sent over TP.CM when longer than 8 bytes

# preferred source addresses on each machine's bus
SA = {
    "engine": 0x00, "transmission": 0x03, "payload": 0x05, "controller": 0x27, "telematics": 0x4A,
    "hydraulics": 0x80, "swing": 0x81, "safety": 0x82, "blade": 0x83, "slew": 0x84, "hoist": 0x86, "lmi": 0x87,
    "gateway": 0xF9,
}

MODES = {0: "auto", 1: "hold", 2: "safe", 3: "manual", 4: "offline"}
MODE_CODE = {v: k for k, v in MODES.items()}

TASK_STATES = {
    0: "idle", 1: "held", 2: "dig", 3: "swing_load", 4: "dump", 5: "swing_back", 6: "to_load", 7: "queue", 8: "loading",
    9: "haul", 10: "tip", 11: "return", 12: "spread", 13: "to_pick", 14: "hoist", 15: "to_place", 16: "lower", 17: "drive",
}
TASK_CODE = {v: k for k, v in TASK_STATES.items()}


def env_site() -> str:
    return L.use(os.environ.get("GW_SITE", "northgate"))
