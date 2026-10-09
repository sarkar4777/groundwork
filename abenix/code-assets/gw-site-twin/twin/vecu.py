"""Virtual controllers. Each vECU ticks at 100 Hz on its machine's signals and puts J1939 frames on that machine's bus.

Interface: tick(m, dt, ctx) updates the machine's signals, values(m, pgn) gives the SPN values
for a frame. Controller state lives in the machine dict, so a step is a pure function of its input.
"""

from __future__ import annotations

import math

from . import j1939 as J
from . import layout as L

MODE_CODE = {"auto": 0, "hold": 1, "fallback": 2, "manual": 3, "offline": 4}
RULE_CODE = {"": 0, "worker_in_swing": 1, "truck_near_worker": 2, "crane_wind": 3, "crane_lmi": 4,
             "crane_envelope": 5, "gnss_lost": 6, "can_timeout": 7, "critical_fault": 8, "kill": 9}


def _approach(v, target, rate, dt):
    d = target - v
    step = rate * dt
    if d > step:
        return v + step
    if d < -step:
        return v - step
    return target


class Vecu:
    ecu = "?"
    sa = 0xFE
    label = ""
    pgns: tuple = ()

    def tick(self, m, dt, ctx):
        pass

    def values(self, m, pgn):
        return {}


class Engine(Vecu):
    ecu = "ENG"
    sa = 0x00
    label = "Engine ECU"
    pgns = (J.EEC1, J.LFE1, J.ET1, J.HOURS)

    def tick(self, m, dt, ctx):
        s = m["sig"]
        load = min(1.0, max(0.0, s.get("load", 0.2)))
        running = m["mode"] not in ("offline",) and s.get("fuel_l", 1) > 0
        target = (s.get("idle_rpm", 850) + load * (s.get("max_rpm", 1900) - s.get("idle_rpm", 850))) if running else 0
        s["rpm"] = _approach(s.get("rpm", 850), target, 900, dt)
        s["torque"] = 15 + 80 * load if running else 0
        heat = 70 + 22 * load + s.get("cool_fault", 0.0)
        s["coolant"] = _approach(s.get("coolant", 80), heat, 0.08, dt)
        s["oil_t"] = _approach(s.get("oil_t", 85), heat + 8, 0.05, dt)
        rate = (4 + 38 * load) if running else 0
        s["fuel_rate"] = rate
        s["fuel_l"] = max(0.0, s.get("fuel_l", 300) - rate * dt / 3600)
        if running:
            s["hours"] = s.get("hours", 0) + dt / 3600
            s["revs"] = s.get("revs", 0) + s["rpm"] * dt / 60
        m["fuel_pct"] = round(100 * s["fuel_l"] / s.get("tank_l", 400), 1)

    def values(self, m, pgn):
        s = m["sig"]
        if pgn == J.EEC1.pgn:
            return {"torque_mode": 1, "drivers_demand_torque_pct": s["torque"], "actual_torque_pct": s["torque"],
                    "engine_speed_rpm": s["rpm"], "controlling_sa": 0, "starter_mode": 0, "engine_demand_torque_pct": s["torque"]}
        if pgn == J.LFE1.pgn:
            spd = abs(m.get("speed", 0.0)) * 3.6
            inst = spd / s["fuel_rate"] if s["fuel_rate"] > 0.5 and spd > 0.5 else 0
            return {"fuel_rate_lph": s["fuel_rate"], "inst_fuel_economy_kmpl": inst, "avg_fuel_economy_kmpl": inst,
                    "throttle_pct": 100 * s.get("load", 0)}
        if pgn == J.ET1.pgn:
            return {"coolant_c": s["coolant"], "fuel_temp_c": 38, "oil_temp_c": s["oil_t"], "turbo_oil_temp_c": s["oil_t"] + 6,
                    "intercooler_c": 45, "intercooler_thermostat_pct": 40}
        if pgn == J.HOURS.pgn:
            return {"engine_hours": s.get("hours", 0), "engine_revolutions": s.get("revs", 0) / 1000}
        return {}


class Hydraulic(Vecu):
    ecu = "HYD"
    sa = 0x80
    label = "Hydraulic controller"
    pgns = (J.HYD1,)

    def tick(self, m, dt, ctx):
        s = m["sig"]
        j = m["joints_rate"]
        flow = min(1.0, (abs(j.get("swing", 0)) + abs(j.get("boom", 0)) + abs(j.get("stick", 0)) + abs(j.get("bucket", 0))) / 1.6)
        digging = 1.0 if m.get("phase") == "dig" else 0.0
        ripple = s.get("hyd_ripple", 0.0) * math.sin(ctx["t"] * 17.0)
        s["flow"] = flow
        s["p1"] = 35 + 230 * flow + 90 * digging + ripple
        s["p2"] = 30 + 200 * flow + 60 * digging + 0.6 * ripple
        s["boom_head"] = 60 + 120 * max(0.0, -m["joints"].get("boom", 0)) + 25 * m.get("bucket_m3", 0) + ripple
        target_t = 52 + 14 * flow + s.get("hyd_heat", 0.0)
        s["hyd_t"] = _approach(s.get("hyd_t", 55), target_t, 0.05 + 0.02 * s.get("hyd_heat", 0.0), dt)
        s["load"] = max(s.get("load", 0.2), 0.25 + 0.6 * flow + 0.2 * digging)

    def values(self, m, pgn):
        s = m["sig"]
        return {"pump1_bar": s["p1"], "pump2_bar": s["p2"], "boom_head_bar": s["boom_head"], "oil_temp_c": s["hyd_t"],
                "flow_pct": 100 * s["flow"]}


class SwingBoom(Vecu):
    ecu = "SWB"
    sa = 0x81
    label = "Swing and boom controller"
    pgns = (J.SWB1,)
    limits = {"swing": (0.75, 2.2), "boom": (0.5, 2.0), "stick": (0.6, 2.0), "bucket": (1.1, 4.0)}

    def tick(self, m, dt, ctx):
        jt = m["joints_target"]
        jr = m["joints_rate"]
        jj = m["joints"]
        scale = m.get("speed_scale", 1.0)
        stop = m["mode"] in ("hold", "offline") or m.get("estop")
        for name, (vmax, amax) in self.limits.items():
            # the safety PLC brakes harder than the normal profile
            accel = amax * (2.0 if stop else 1.0)
            if stop:
                want = 0.0
            else:
                err = jt.get(name, jj[name]) - jj[name]
                if name == "swing":
                    err = math.atan2(math.sin(err), math.cos(err))
                want = max(-vmax * scale, min(vmax * scale, 2.2 * err))
            jr[name] = _approach(jr.get(name, 0.0), want, accel, dt)
            jj[name] += jr[name] * dt
        jj["swing"] = math.atan2(math.sin(jj["swing"]), math.cos(jj["swing"]))

    def values(self, m, pgn):
        j = m["joints"]
        return {"swing_rad": j["swing"], "boom_rad": j["boom"], "stick_rad": j["stick"], "bucket_rad": j["bucket"]}


class Telematics(Vecu):
    ecu = "TEL"
    sa = 0x4A
    label = "Telematics unit"
    pgns = (J.VP, J.VDS)

    def values(self, m, pgn):
        if m["gnss"]["fix"] == 0:
            return {}
        if pgn == J.VP.pgn:
            lat, lon = L.latlon(m["x"], m["y"])
            return {"latitude_deg": lat, "longitude_deg": lon}
        bearing = (90 - math.degrees(m["heading"])) % 360
        return {"compass_bearing_deg": bearing, "nav_speed_kmh": abs(m.get("speed", 0)) * 3.6, "pitch_deg": 0,
                "altitude_m": 120 + m.get("z", 0)}


class SafetyPlc(Vecu):
    ecu = "SPLC"
    sa = 0x82
    label = "Safety PLC"
    pgns = (J.SPLC1,)

    def tick(self, m, dt, ctx):
        s = m["sig"]
        s["hb"] = (s.get("hb", 0) + 1) % 250

    def values(self, m, pgn):
        sf = m["safety"]
        return {"mode": MODE_CODE.get(m["mode"], 0), "rule": RULE_CODE.get(sf.get("rule", ""), 0), "heartbeat": m["sig"]["hb"],
                "nearest_tag_m": min(600.0, sf.get("nearest_m", 600.0)), "exclusion_m": sf.get("exclusion_m", 0.0),
                "tip_speed_ms": sf.get("tip_speed", 0.0)}


class Transmission(Vecu):
    ecu = "TRN"
    sa = 0x03
    label = "Transmission and body hoist"
    pgns = (J.ETC2, J.CCVS1, J.BODY1)
    ratios = (0, 4.84, 2.81, 1.84, 1.36, 1.0, 0.74)

    def tick(self, m, dt, ctx):
        s = m["sig"]
        v = abs(m.get("speed", 0.0))
        gear = 0 if v < 0.2 else min(6, 1 + int(v / 1.6))
        s["gear"] = gear if m.get("speed", 0) >= 0 else -1
        s["load"] = 0.2 + min(0.8, v / 9.0 + m.get("load_t", 0) / 60.0)

    def values(self, m, pgn):
        s = m["sig"]
        if pgn == J.ETC2.pgn:
            g = s.get("gear", 0)
            return {"selected_gear": g, "current_gear": g, "actual_gear_ratio": self.ratios[max(0, g)] if g >= 0 else 4.84}
        if pgn == J.CCVS1.pgn:
            return {"parking_brake": 1 if abs(m.get("speed", 0)) < 0.05 else 0, "wheel_speed_kmh": abs(m.get("speed", 0)) * 3.6}
        return {"body_angle_deg": m.get("body_deg", 0.0), "payload_t": m.get("load_t", 0.0)}


class CollisionAvoid(Vecu):
    ecu = "CAS"
    sa = 0x2A
    label = "Collision avoidance"
    pgns = (J.CAS1,)

    def values(self, m, pgn):
        sf = m["safety"]
        cap = sf.get("cap_kmh", 30)
        return {"nearest_tag_m": min(600.0, sf.get("nearest_m", 600.0)), "speed_cap_kmh": cap, "cap_active": 1 if cap < 30 else 0}


class TrackBlade(Vecu):
    ecu = "TRK"
    sa = 0x83
    label = "Track and blade controller"
    pgns = (J.TRK1,)

    def tick(self, m, dt, ctx):
        m["sig"]["load"] = 0.3 + 0.6 * min(1.0, abs(m.get("speed", 0)) / 2.0)

    def values(self, m, pgn):
        v = m.get("speed", 0.0)
        return {"left_track_mps": v, "right_track_mps": v, "blade_height_m": m.get("blade_m", 0.0),
                "blade_load_pct": 100 * m["sig"].get("blade_load", 0.0)}


class Slew(Vecu):
    ecu = "SLEW"
    sa = 0x84
    label = "Slew drive"
    pgns = (J.SLEW1,)

    def tick(self, m, dt, ctx):
        stop = m["mode"] in ("hold", "offline") or m.get("slew_stop")
        vmax = m.get("slew_vmax", 0.1) * m.get("speed_scale", 1.0)
        if stop:
            want = 0.0
        else:
            err = math.atan2(math.sin(m["slew_target"] - m["slew"]), math.cos(m["slew_target"] - m["slew"]))
            want = max(-vmax, min(vmax, 0.6 * err))
        m["slew_rate"] = _approach(m.get("slew_rate", 0.0), want, 0.08 if not stop else 0.12, dt)
        m["slew"] = math.atan2(math.sin(m["slew"] + m["slew_rate"] * dt), math.cos(m["slew"] + m["slew_rate"] * dt))

    def values(self, m, pgn):
        return {"slew_rad": m["slew"], "slew_rate_rads": m["slew_rate"], "brake": 1 if abs(m["slew_rate"]) < 1e-3 else 0}


class Luff(Vecu):
    ecu = "LUFF"
    sa = 0x85
    label = "Luff drive"
    pgns = (J.LUFF1,)

    def tick(self, m, dt, ctx):
        target = m["luff_target"]
        # a load moment stop blocks luffing out, luffing in is always allowed
        if m["mode"] in ("hold", "offline") or (m.get("hoist_stop") and target < m["luff"]):
            target = m["luff"]
        m["luff_rate"] = max(-0.04, min(0.04, 0.5 * (target - m["luff"])))
        m["luff"] += m["luff_rate"] * dt
        m["radius"] = 2.0 + m["jib"] * math.cos(m["luff"])

    def values(self, m, pgn):
        return {"luff_rad": m["luff"], "luff_rate_rads": m["luff_rate"], "radius_m": m["radius"]}


class Hoist(Vecu):
    ecu = "HOIST"
    sa = 0x86
    label = "Hoist drive"
    pgns = (J.HOIST1,)

    def tick(self, m, dt, ctx):
        target = m["hook_target"]
        if m["mode"] in ("hold", "offline") or (m.get("hoist_stop") and target > m["hook_z"]):
            target = m["hook_z"]
        m["rope_speed"] = max(-1.2, min(1.2, 0.8 * (target - m["hook_z"])))
        m["hook_z"] += m["rope_speed"] * dt

    def values(self, m, pgn):
        return {"hook_height_m": m["hook_z"], "rope_speed_mps": m["rope_speed"], "load_t": m["load_t"]}


class Lmi(Vecu):
    ecu = "LMI"
    sa = 0x87
    label = "Load moment indicator"
    pgns = (J.LMI1,)

    def tick(self, m, dt, ctx):
        cap = min(m["cap_max_t"], m["cap_moment"] / max(1.0, m["radius"]))
        m["chart_t"] = cap
        m["lmi_pct"] = 100.0 * (m["load_t"] + m["hook_block_t"]) / cap

    def values(self, m, pgn):
        return {"radius_m": m["radius"], "load_t": m["load_t"], "lmi_pct": m["lmi_pct"], "wind_ms": m["wind_ms"],
                "chart_t": m["chart_t"]}


class AntiCollision(Vecu):
    ecu = "ACU"
    sa = 0x88
    label = "Anti-collision unit"
    pgns = (J.ACU1,)

    def values(self, m, pgn):
        sep = m["safety"].get("separation_m", 99.0)
        return {"min_separation_m": min(600.0, sep), "overlap": 1 if sep < 5 else 0,
                "slow_active": 1 if m["safety"].get("slow") else 0}


class Pile(Vecu):
    ecu = "PILE"
    sa = 0x89
    label = "Piling rig controller"
    pgns = (J.PILE1,)

    def tick(self, m, dt, ctx):
        m["sig"]["load"] = 0.4 + (0.5 if m.get("phase") == "drive" else 0.0)

    def values(self, m, pgn):
        return {"pile_depth_m": m.get("pile_depth", 0.0), "hammer_bpm": m.get("bpm", 0), "vibration_mms": m.get("vib", 0.0)}


class RollerEngine(Engine):
    ecu = "ENG"
    label = "Engine and drum ECU"
    pgns = (J.EEC1, J.LFE1, J.ET1, J.HOURS, J.RLR1)

    def values(self, m, pgn):
        if pgn == J.RLR1.pgn:
            on = abs(m.get("speed", 0)) > 0.1
            return {"drum_freq_hz": 30 if on else 0, "amplitude_mm": 0.9 if on else 0, "cmv": m.get("cmv", 20.0)}
        return super().values(m, pgn)


class AiBoom(Vecu):
    """Telehandler boom. Its tick is the code the AI wrote and tested, run as it was published."""
    ecu = "BOOM"
    sa = 0x8A
    label = "Telescopic boom controller (AI-written)"
    pgns = (J.BOOM1,)

    def tick(self, m, dt, ctx):
        fn = ctx["ai_code"].get(m["id"])
        inputs = {"target_angle": m.get("boom_target", 0.2), "target_ext": m.get("ext_target", 0.0), "load_t": m.get("load_t", 0.0),
                  "angle": m.get("boom_angle", 0.0), "ext": m.get("ext", 0.0), "stop": m["mode"] in ("hold", "offline")}
        if fn is None:
            return
        try:
            out = fn(inputs, dt, m.setdefault("ai_state", {}))
            m["boom_angle"] = float(out.get("boom_angle_rad", m.get("boom_angle", 0.0)))
            m["ext"] = float(out.get("extension_m", m.get("ext", 0.0)))
            m["stability"] = float(out.get("stability_pct", 50.0))
        except Exception as e:  # noqa: BLE001
            m["ai_error"] = str(e)[:200]

    def values(self, m, pgn):
        return {"boom_angle_rad": m.get("boom_angle", 0.0), "extension_m": m.get("ext", 0.0), "fork_load_t": m.get("load_t", 0.0),
                "stability_pct": m.get("stability", 0.0)}


ENGINE = Engine()
TYPES = {
    "ENG": ENGINE, "HYD": Hydraulic(), "SWB": SwingBoom(), "TEL": Telematics(), "SPLC": SafetyPlc(),
    "TRN": Transmission(), "CAS": CollisionAvoid(), "TRK": TrackBlade(), "SLEW": Slew(), "LUFF": Luff(),
    "HOIST": Hoist(), "LMI": Lmi(), "ACU": AntiCollision(), "PILE": Pile(), "RENG": RollerEngine(), "BOOM": AiBoom(),
}

LAYOUT_BY_KIND = {
    "excavator": ("ENG", "HYD", "SWB", "TEL", "SPLC"),
    "haul_truck": ("ENG", "TRN", "TEL", "CAS"),
    "dozer": ("ENG", "TRK"),
    "tower_crane": ("SLEW", "LUFF", "HOIST", "LMI", "ACU"),
    "mobile_crane": ("SLEW", "LMI"),
    "piling_rig": ("PILE",),
    "roller": ("RENG",),
    "drone": (),
    "telehandler": ("BOOM",),
}

CRITICAL_DTCS = {(110, 0), (100, 1), (1638, 0), (1762, 1), (520200, 0), (639, 9)}


def dtc_lamps(dtcs: list) -> int:
    if not dtcs:
        return J.lamp_byte()
    crit = any((d[0], d[1]) in CRITICAL_DTCS for d in dtcs)
    return J.lamp_byte(mil=1 if crit else 0, red_stop=1 if crit else 0, amber=0 if crit else 1)
