"""SAE J1939 encoding for the vECUs: 29-bit identifiers, SPN packing, DM1 and BAM transport."""

from __future__ import annotations

PROPRIETARY_B = 0xFF00


class Spn:
    __slots__ = ("name", "spn", "byte", "bit", "length", "scale", "offset", "unit", "shift", "mask", "maxv")

    def __init__(self, name, spn, byte, bit, length, scale=1.0, offset=0.0, unit=""):
        self.name = name
        self.spn = spn
        self.byte = byte
        self.bit = bit
        self.length = length
        self.scale = scale
        self.offset = offset
        self.unit = unit
        self.shift = byte * 8 + bit
        self.mask = (1 << length) - 1
        self.maxv = max_valid(length)


class Pgn:
    __slots__ = ("pgn", "acronym", "name", "priority", "rate_ms", "spns", "proprietary")

    def __init__(self, pgn, acronym, name, priority, rate_ms, spns=(), proprietary=False):
        self.pgn = pgn
        self.acronym = acronym
        self.name = name
        self.priority = priority
        self.rate_ms = rate_ms
        self.spns = tuple(spns)
        self.proprietary = proprietary


def max_valid(length: int) -> int:
    # J1939-71 reserves the top of each range for error and not available
    if length == 2:
        return 1
    if length == 4:
        return 0xA
    if length == 8:
        return 0xFA
    if length == 16:
        return 0xFAFF
    if length == 32:
        return 0xFAFFFFFF
    return (1 << length) - 1


PGNS: dict[int, Pgn] = {}


def _reg(p: Pgn) -> Pgn:
    PGNS[p.pgn] = p
    return p


EEC1 = _reg(Pgn(61444, "EEC1", "Electronic Engine Controller 1", 3, 20, (
    Spn("torque_mode", 899, 0, 0, 4),
    Spn("drivers_demand_torque_pct", 512, 1, 0, 8, 1, -125, "%"),
    Spn("actual_torque_pct", 513, 2, 0, 8, 1, -125, "%"),
    Spn("engine_speed_rpm", 190, 3, 0, 16, 0.125, 0, "rpm"),
    Spn("controlling_sa", 1483, 5, 0, 8),
    Spn("starter_mode", 1675, 6, 0, 4),
    Spn("engine_demand_torque_pct", 2432, 7, 0, 8, 1, -125, "%"),
)))

ETC2 = _reg(Pgn(61445, "ETC2", "Electronic Transmission Controller 2", 6, 100, (
    Spn("selected_gear", 524, 0, 0, 8, 1, -125),
    Spn("actual_gear_ratio", 526, 1, 0, 16, 0.001, 0),
    Spn("current_gear", 523, 3, 0, 8, 1, -125),
)))

ET1 = _reg(Pgn(65262, "ET1", "Engine Temperature 1", 6, 1000, (
    Spn("coolant_c", 110, 0, 0, 8, 1, -40, "C"),
    Spn("fuel_temp_c", 174, 1, 0, 8, 1, -40, "C"),
    Spn("oil_temp_c", 175, 2, 0, 16, 0.03125, -273, "C"),
    Spn("turbo_oil_temp_c", 176, 4, 0, 16, 0.03125, -273, "C"),
    Spn("intercooler_c", 52, 6, 0, 8, 1, -40, "C"),
    Spn("intercooler_thermostat_pct", 1134, 7, 0, 8, 0.4, 0, "%"),
)))

LFE1 = _reg(Pgn(65266, "LFE1", "Fuel Economy (Liquid)", 6, 100, (
    Spn("fuel_rate_lph", 183, 0, 0, 16, 0.05, 0, "L/h"),
    Spn("inst_fuel_economy_kmpl", 184, 2, 0, 16, 1 / 512, 0, "km/L"),
    Spn("avg_fuel_economy_kmpl", 185, 4, 0, 16, 1 / 512, 0, "km/L"),
    Spn("throttle_pct", 51, 6, 0, 8, 0.4, 0, "%"),
    Spn("throttle2_pct", 3673, 7, 0, 8, 0.4, 0, "%"),
)))

VP = _reg(Pgn(65267, "VP", "Vehicle Position", 6, 5000, (
    Spn("latitude_deg", 584, 0, 0, 32, 1e-7, -210, "deg"),
    Spn("longitude_deg", 585, 4, 0, 32, 1e-7, -210, "deg"),
)))

CCVS1 = _reg(Pgn(65265, "CCVS1", "Cruise Control/Vehicle Speed 1", 6, 100, (
    Spn("parking_brake", 70, 0, 2, 2),
    Spn("wheel_speed_kmh", 84, 1, 0, 16, 1 / 256, 0, "km/h"),
)))

HOURS = _reg(Pgn(65253, "HOURS", "Engine Hours, Revolutions", 6, 1000, (
    Spn("engine_hours", 247, 0, 0, 32, 0.05, 0, "h"),
    Spn("engine_revolutions", 249, 4, 0, 32, 1000, 0, "r"),
)))

VDS = _reg(Pgn(65256, "VDS", "Vehicle Direction/Speed", 6, 100, (
    Spn("compass_bearing_deg", 165, 0, 0, 16, 1 / 128, 0, "deg"),
    Spn("nav_speed_kmh", 517, 2, 0, 16, 1 / 256, 0, "km/h"),
    Spn("pitch_deg", 583, 4, 0, 16, 1 / 128, -200, "deg"),
    Spn("altitude_m", 580, 6, 0, 16, 0.125, -2500, "m"),
)))

DM1 = _reg(Pgn(65226, "DM1", "Active Diagnostic Trouble Codes", 6, 1000))
TP_CM = _reg(Pgn(60416, "TP.CM", "Transport Protocol, Connection Management", 7, 0))
TP_DT = _reg(Pgn(60160, "TP.DT", "Transport Protocol, Data Transfer", 7, 0))

# proprietary B, PF 0xFF, the group extension picks the message
HYD1 = _reg(Pgn(PROPRIETARY_B | 0x10, "HYD1", "Hydraulic pressures (proprietary B)", 4, 50, (
    Spn("pump1_bar", None, 0, 0, 16, 0.1, 0, "bar"),
    Spn("pump2_bar", None, 2, 0, 16, 0.1, 0, "bar"),
    Spn("boom_head_bar", None, 4, 0, 16, 0.1, 0, "bar"),
    Spn("oil_temp_c", None, 6, 0, 8, 1, -40, "C"),
    Spn("flow_pct", None, 7, 0, 8, 0.4, 0, "%"),
), True))

SWB1 = _reg(Pgn(PROPRIETARY_B | 0x11, "SWB1", "Swing and boom joints (proprietary B)", 3, 20, (
    Spn("swing_rad", None, 0, 0, 16, 0.0001, -3.2, "rad"),
    Spn("boom_rad", None, 2, 0, 16, 0.0001, -3.2, "rad"),
    Spn("stick_rad", None, 4, 0, 16, 0.0001, -3.2, "rad"),
    Spn("bucket_rad", None, 6, 0, 16, 0.0001, -3.2, "rad"),
), True))

SPLC1 = _reg(Pgn(PROPRIETARY_B | 0x12, "SPLC1", "Safety PLC status (proprietary B)", 2, 20, (
    Spn("mode", None, 0, 0, 4),
    Spn("rule", None, 0, 4, 4),
    Spn("heartbeat", None, 1, 0, 8),
    Spn("nearest_tag_m", None, 2, 0, 16, 0.01, 0, "m"),
    Spn("exclusion_m", None, 4, 0, 16, 0.01, 0, "m"),
    Spn("tip_speed_ms", None, 6, 0, 16, 0.001, -32, "m/s"),
), True))

CAS1 = _reg(Pgn(PROPRIETARY_B | 0x13, "CAS1", "Collision avoidance (proprietary B)", 3, 50, (
    Spn("nearest_tag_m", None, 0, 0, 16, 0.01, 0, "m"),
    Spn("speed_cap_kmh", None, 2, 0, 8, 1, 0, "km/h"),
    Spn("cap_active", None, 3, 0, 2),
), True))

TRK1 = _reg(Pgn(PROPRIETARY_B | 0x14, "TRK1", "Track and blade (proprietary B)", 4, 50, (
    Spn("left_track_mps", None, 0, 0, 16, 0.001, -32, "m/s"),
    Spn("right_track_mps", None, 2, 0, 16, 0.001, -32, "m/s"),
    Spn("blade_height_m", None, 4, 0, 16, 0.001, -32, "m"),
    Spn("blade_load_pct", None, 6, 0, 8, 0.4, 0, "%"),
), True))

BODY1 = _reg(Pgn(PROPRIETARY_B | 0x15, "BODY1", "Body hoist (proprietary B)", 5, 100, (
    Spn("body_angle_deg", None, 0, 0, 8, 0.5, 0, "deg"),
    Spn("payload_t", None, 1, 0, 16, 0.01, 0, "t"),
), True))

SLEW1 = _reg(Pgn(PROPRIETARY_B | 0x20, "SLEW1", "Slew drive (proprietary B)", 3, 20, (
    Spn("slew_rad", None, 0, 0, 16, 0.0001, -3.2, "rad"),
    Spn("slew_rate_rads", None, 2, 0, 16, 0.0001, -3.2, "rad/s"),
    Spn("brake", None, 4, 0, 2),
), True))

LUFF1 = _reg(Pgn(PROPRIETARY_B | 0x21, "LUFF1", "Luff drive (proprietary B)", 3, 20, (
    Spn("luff_rad", None, 0, 0, 16, 0.0001, -3.2, "rad"),
    Spn("luff_rate_rads", None, 2, 0, 16, 0.0001, -3.2, "rad/s"),
    Spn("radius_m", None, 4, 0, 16, 0.01, 0, "m"),
), True))

HOIST1 = _reg(Pgn(PROPRIETARY_B | 0x22, "HOIST1", "Hoist drive (proprietary B)", 3, 20, (
    Spn("hook_height_m", None, 0, 0, 16, 0.01, -100, "m"),
    Spn("rope_speed_mps", None, 2, 0, 16, 0.001, -32, "m/s"),
    Spn("load_t", None, 4, 0, 16, 0.01, 0, "t"),
), True))

LMI1 = _reg(Pgn(PROPRIETARY_B | 0x23, "LMI1", "Load moment indicator (proprietary B)", 2, 100, (
    Spn("radius_m", None, 0, 0, 16, 0.01, 0, "m"),
    Spn("load_t", None, 2, 0, 16, 0.01, 0, "t"),
    Spn("lmi_pct", None, 4, 0, 8, 0.5, 0, "%"),
    Spn("wind_ms", None, 5, 0, 8, 0.25, 0, "m/s"),
    Spn("chart_t", None, 6, 0, 16, 0.01, 0, "t"),
), True))

ACU1 = _reg(Pgn(PROPRIETARY_B | 0x24, "ACU1", "Crane anti-collision (proprietary B)", 2, 50, (
    Spn("min_separation_m", None, 0, 0, 16, 0.01, 0, "m"),
    Spn("overlap", None, 2, 0, 2),
    Spn("slow_active", None, 2, 2, 2),
), True))

PILE1 = _reg(Pgn(PROPRIETARY_B | 0x25, "PILE1", "Piling rig (proprietary B)", 5, 100, (
    Spn("pile_depth_m", None, 0, 0, 16, 0.01, 0, "m"),
    Spn("hammer_bpm", None, 2, 0, 8, 1, 0, "bpm"),
    Spn("vibration_mms", None, 3, 0, 16, 0.01, 0, "mm/s"),
), True))

RLR1 = _reg(Pgn(PROPRIETARY_B | 0x26, "RLR1", "Roller compaction (proprietary B)", 5, 100, (
    Spn("drum_freq_hz", None, 0, 0, 8, 0.25, 0, "Hz"),
    Spn("amplitude_mm", None, 1, 0, 8, 0.01, 0, "mm"),
    Spn("cmv", None, 2, 0, 16, 0.1, 0, ""),
), True))

BOOM1 = _reg(Pgn(PROPRIETARY_B | 0x27, "BOOM1", "Telescopic boom (proprietary B)", 3, 20, (
    Spn("boom_angle_rad", None, 0, 0, 16, 0.0001, -3.2, "rad"),
    Spn("extension_m", None, 2, 0, 16, 0.001, 0, "m"),
    Spn("fork_load_t", None, 4, 0, 16, 0.01, 0, "t"),
    Spn("stability_pct", None, 6, 0, 8, 0.5, 0, "%"),
), True))


def can_id(priority: int, pgn: int, sa: int, da: int = 0xFF) -> int:
    """29-bit identifier. For PDU1 (PF below 240) the PS byte carries the destination."""
    pf = (pgn >> 8) & 0xFF
    dp = (pgn >> 16) & 0x3
    ps = (da & 0xFF) if pf < 240 else (pgn & 0xFF)
    return ((priority & 0x7) << 26) | (dp << 24) | (pf << 16) | (ps << 8) | (sa & 0xFF)


def parse_can_id(cid: int) -> tuple[int, int, int, int]:
    """Priority, PGN, source address, destination address."""
    priority = (cid >> 26) & 0x7
    dp = (cid >> 24) & 0x3
    pf = (cid >> 16) & 0xFF
    ps = (cid >> 8) & 0xFF
    sa = cid & 0xFF
    if pf < 240:
        return priority, (dp << 16) | (pf << 8), sa, ps
    return priority, (dp << 16) | (pf << 8) | ps, sa, 0xFF


_ALL_ONES = (1 << 64) - 1


def encode(pgn: int, values: dict) -> bytes:
    """Pack values into 8 bytes. Missing SPNs go out as not available, all ones."""
    raw = _ALL_ONES
    for s in PGNS[pgn].spns:
        v = values.get(s.name)
        if v is None:
            continue
        r = int(round((v - s.offset) / s.scale))
        if r < 0:
            r = 0
        elif r > s.maxv:
            r = s.maxv
        raw = (raw & ~(s.mask << s.shift)) | (r << s.shift)
    return raw.to_bytes(8, "little")


def decode(pgn: int, data: bytes) -> dict:
    raw = int.from_bytes(bytes(data[:8]).ljust(8, b"\xff"), "little")
    out = {}
    for s in PGNS[pgn].spns:
        r = (raw >> s.shift) & s.mask
        out[s.name] = None if r > s.maxv else round(r * s.scale + s.offset, 6)
    return out


class Dtc:
    __slots__ = ("spn", "fmi", "oc")

    def __init__(self, spn: int, fmi: int, oc: int = 1):
        self.spn = spn
        self.fmi = fmi
        self.oc = oc

    def pack(self) -> bytes:
        # SPN conversion method 4: low 16 bits little-endian, top 3 bits above the FMI
        return bytes((
            self.spn & 0xFF,
            (self.spn >> 8) & 0xFF,
            (((self.spn >> 16) & 0x7) << 5) | (self.fmi & 0x1F),
            self.oc & 0x7F,
        ))

    @staticmethod
    def unpack(b: bytes) -> "Dtc":
        return Dtc(b[0] | (b[1] << 8) | (((b[2] >> 5) & 0x7) << 16), b[2] & 0x1F, b[3] & 0x7F)

    def __eq__(self, other):
        return isinstance(other, Dtc) and (self.spn, self.fmi, self.oc) == (other.spn, other.fmi, other.oc)

    def __repr__(self):
        return f"Dtc(spn={self.spn}, fmi={self.fmi}, oc={self.oc})"


def lamp_byte(mil=0, red_stop=0, amber=0, protect=0) -> int:
    return ((mil & 3) << 6) | ((red_stop & 3) << 4) | ((amber & 3) << 2) | (protect & 3)


def encode_dm1(lamps: int, dtcs: list) -> bytes:
    """DM1 payload. No active fault goes out as one all-zero DTC, per J1939-73."""
    body = bytes((lamps & 0xFF, 0xFF))
    if not dtcs:
        body += b"\x00\x00\x00\x00"
    for d in dtcs:
        body += d.pack()
    if len(body) < 8:
        body += b"\xff" * (8 - len(body))
    return body


def decode_dm1(data: bytes) -> tuple[dict, list]:
    b = data[0]
    lamps = {"mil": (b >> 6) & 3, "red_stop": (b >> 4) & 3, "amber_warning": (b >> 2) & 3, "protect": b & 3}
    dtcs = []
    for i in range(2, len(data) - 3, 4):
        chunk = data[i:i + 4]
        if chunk == b"\xff\xff\xff\xff":
            break
        d = Dtc.unpack(chunk)
        if d.spn == 0 and d.fmi == 0:
            continue
        dtcs.append(d)
    return lamps, dtcs


def bam_frames(pgn: int, payload: bytes) -> list:
    """Broadcast announce message and data transfer packets for payloads over 8 bytes."""
    n = len(payload)
    packets = (n + 6) // 7
    cm = bytes((32, n & 0xFF, (n >> 8) & 0xFF, packets, 0xFF, pgn & 0xFF, (pgn >> 8) & 0xFF, (pgn >> 16) & 0xFF))
    frames = [(TP_CM.pgn, cm)]
    for i in range(packets):
        frames.append((TP_DT.pgn, bytes((i + 1,)) + payload[i * 7:(i + 1) * 7].ljust(7, b"\xff")))
    return frames


def bam_reassemble(frames: list) -> tuple[int, bytes]:
    cm = frames[0][1]
    size = cm[1] | (cm[2] << 8)
    pgn = cm[5] | (cm[6] << 8) | (cm[7] << 16)
    return pgn, b"".join(f[1][1:8] for f in frames[1:])[:size]


def dm1_frames(lamps: int, dtcs: list) -> list:
    payload = encode_dm1(lamps, dtcs)
    if len(payload) <= 8:
        return [(DM1.pgn, payload)]
    return bam_frames(DM1.pgn, payload)


FMI_TEXT = {
    0: "Above normal operating range, most severe",
    1: "Below normal operating range, most severe",
    2: "Data erratic, intermittent or incorrect",
    3: "Voltage above normal or shorted high",
    4: "Voltage below normal or shorted low",
    5: "Current below normal or open circuit",
    7: "Mechanical system not responding",
    9: "Abnormal update rate",
    12: "Bad intelligent device",
    14: "Special instructions",
    15: "Above normal operating range, least severe",
    16: "Above normal operating range, moderately severe",
    17: "Below normal operating range, least severe",
    18: "Below normal operating range, moderately severe",
    19: "Received network data in error",
    31: "Condition exists",
}

SPN_TEXT = {
    84: "Wheel-based vehicle speed",
    100: "Engine oil pressure",
    110: "Engine coolant temperature",
    177: "Transmission oil temperature",
    190: "Engine speed",
    584: "Latitude (GNSS)",
    639: "J1939 network #1",
    1638: "Hydraulic temperature",
    1762: "Hydraulic pressure",
    2602: "Hydraulic oil level",
    520200: "LMI overload (proprietary)",
    520201: "Slew brake response (proprietary)",
}
