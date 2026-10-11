"""The ECUs. Each runs in its own container, claims its address, and speaks J1939 on the machine's bus.

Sensors and actuators read and write the plant, the physical machine. Everything else they learn from the bus:
setpoints from the controller, the safety state from the safety PLC, the engine override from TSC1.
"""

from __future__ import annotations

import math
import random
import time

from . import frames as F
from .frames import J, L
from .machines import FUNCTION, MACHINES, identity, initial_plant, preferred_sa
from .plant import Plant
from .stack import GLOBAL, Node, make_name

# setpoints and safety frames come every 20 ms; a controller that has said nothing for this long is gone
DT_STALE = 0.5


def approach(v: float, target: float, rate: float, dt: float) -> float:
    d = target - v
    s = rate * dt
    return v + s if d > s else v - s if d < -s else target


def wrap(a: float) -> float:
    return math.atan2(math.sin(a), math.cos(a))


class Ecu:
    role = "?"
    label = "?"

    def __init__(self, machine: str):
        self.machine = machine
        self.kind = MACHINES[machine]["kind"]
        self.plant = Plant(machine, initial_plant(machine))
        self.node = Node(f"{machine}/{self.role}", make_name(identity(machine, self.role), FUNCTION[self.role]), preferred_sa(machine, self.role))
        self.safety = {"mode": 0, "rule": 0, "at": 0.0}
        self.dtcs: list = []
        self.lamps = J.lamp_byte()
        self.node.on(J.SPLC1.pgn, self._on_splc)
        self.node.every(J.DM1.pgn, 1000, self._dm1)
        self.node.serve(J.DM1.pgn, lambda sa: self._dm1())
        self.node.serve(F.SOFT, lambda sa: f"{self.label}*GW-{self.role.upper()} 2.5.8*".encode())
        self.setup()

    def setup(self) -> None:
        pass

    def tick(self, dt: float, now: float) -> None:
        pass

    def _on_splc(self, sa, da, data, ts) -> None:
        v = J.decode(J.SPLC1.pgn, data)
        self.safety = {"mode": int(v["mode"] or 0), "rule": int(v["rule"] or 0), "at": time.monotonic()}

    def stopped(self) -> bool:
        """Brakes on: the safety PLC says hold or offline, or its frames stopped arriving."""
        if time.monotonic() - self.safety["at"] > DT_STALE and self.role != "safety":
            return True
        return self.safety["mode"] in (1, 4)

    def speed_scale(self) -> float:
        return 0.4 if self.safety["mode"] == 2 else 1.0

    def _dm1(self) -> bytes:
        return J.encode_dm1(self.lamps, self.dtcs)

    def run(self) -> None:
        self.node.run(self.tick)


# ---------- engine

class Engine(Ecu):
    role = "engine"
    label = "Engine ECU"

    def setup(self):
        self.tsc1 = {"at": 0.0, "rpm": None, "sa": 0}
        n = self.node
        n.every(J.EEC1.pgn, 20, self._eec1, 3)
        n.every(J.LFE1.pgn, 100, lambda: J.encode(J.LFE1.pgn, {"fuel_rate_lph": self.plant["fuel_rate"], "throttle_pct": 100 * self.plant["eng_load"]}))
        n.every(J.ET1.pgn, 1000, lambda: J.encode(J.ET1.pgn, {"coolant_c": self.plant["coolant"], "fuel_temp_c": 38, "oil_temp_c": self.plant["oil_t"],
                                                               "turbo_oil_temp_c": self.plant["oil_t"] + 6, "intercooler_c": 45, "intercooler_thermostat_pct": 40}))
        # J1939-71: engine hours are sent on request
        n.serve(J.HOURS.pgn, lambda sa: J.encode(J.HOURS.pgn, {"engine_hours": self.plant["hours"], "engine_revolutions": self.plant["revs"] / 1000}))
        n.serve(F.CI, lambda sa: f"GWSIM*{self.kind.upper()}-ENGINE*{identity(self.machine, 'engine'):06X}*{self.machine}*".encode())
        n.on(F.TSC1.pgn, self._on_tsc1)

    def _on_tsc1(self, sa, da, data, ts):
        if da not in (self.node.sa, GLOBAL):
            return
        v = J.decode(F.TSC1.pgn, data)
        if v["override_mode"] == 1:
            self.tsc1 = {"at": time.monotonic(), "rpm": v["requested_speed_rpm"], "sa": sa}
        elif v["override_mode"] == 0:
            self.tsc1["at"] = 0.0

    def overridden(self) -> bool:
        return time.monotonic() - self.tsc1["at"] < 0.1

    def tick(self, dt, now):
        p = self.plant
        demand = min(1.0, abs(p["flow"]) * 0.8 + abs(p["speed"]) / 9.0 + abs(p["rope_speed"]) * 0.5 + abs(p["slew_rate"]) * 3 + 0.12)
        idle, top = (900, 1800) if self.kind == "excavator" else (750, 1900)
        target = idle + demand * (top - idle)
        if self.overridden() and self.tsc1["rpm"] is not None:
            target = self.tsc1["rpm"]
            demand = 0.05
        p["rpm"] = approach(p["rpm"], target, 900, dt)
        p["eng_load"] = demand
        p["torque"] = 15 + 80 * demand
        heat = 72 + 20 * demand
        p["coolant"] = approach(p["coolant"], heat, 0.08, dt)
        p["oil_t"] = approach(p["oil_t"], heat + 8, 0.05, dt)
        p["fuel_rate"] = 4 + 38 * demand
        p["fuel_l"] = max(0.0, p["fuel_l"] - p["fuel_rate"] * dt / 3600)
        p["hours"] = p["hours"] + dt / 3600
        p["revs"] = p["revs"] + p["rpm"] * dt / 60

    def _eec1(self):
        p = self.plant
        return J.encode(J.EEC1.pgn, {"torque_mode": 1 if not self.overridden() else 2, "drivers_demand_torque_pct": p["torque"],
                                     "actual_torque_pct": p["torque"], "engine_speed_rpm": p["rpm"],
                                     "controlling_sa": self.tsc1["sa"] if self.overridden() else 0, "starter_mode": 0,
                                     "engine_demand_torque_pct": p["torque"]})


# ---------- telematics: GNSS and the vehicle position

class Telematics(Ecu):
    role = "telematics"
    label = "Telematics unit"

    def setup(self):
        n = self.node
        n.every(J.VP.pgn, 5000, self._vp)
        n.every(J.VDS.pgn, 100, self._vds)
        n.every(F.GNSS1.pgn, 50, lambda: J.encode(F.GNSS1.pgn, {"x_m": self.plant["x"], "y_m": self.plant["y"]}), 3)
        n.every(F.GNSS2.pgn, 50, lambda: J.encode(F.GNSS2.pgn, {"heading_rad": wrap(self.plant["heading"]), "speed_mps": self.plant["speed"],
                                                                "z_m": self.plant["z"], "fix": 4, "sats": 18}), 3)

    def _vp(self):
        lat, lon = L.latlon(self.plant["x"], self.plant["y"])
        return J.encode(J.VP.pgn, {"latitude_deg": lat, "longitude_deg": lon})

    def _vds(self):
        p = self.plant
        return J.encode(J.VDS.pgn, {"compass_bearing_deg": (90 - math.degrees(p["heading"])) % 360, "nav_speed_kmh": abs(p["speed"]) * 3.6,
                                    "pitch_deg": 0, "altitude_m": 120 + p["z"]})


# ---------- safety PLC

# J1939-73 DTCs the safety PLC can raise, with real SPN and FMI
FAULTS = {
    1: [(970, 31)],                    # auxiliary shutdown switch, condition exists: the emergency stop
    2: [(639, 9), (520192, 19)],       # J1939 network 1 abnormal update rate, site uplink data error
    3: [(1675, 2), (639, 9)],          # engine starter mode erratic, network abnormal update rate
}


class Safety(Ecu):
    role = "safety"
    label = "Safety PLC"

    def setup(self):
        self.mode = 0
        self.rule = 0
        self.hold_cmd = False
        self.mode_cmd = 0
        self.fault = 0
        self.hb = 0
        self.setpoint_at = time.monotonic() + 3.0
        self.uplink_at = time.monotonic() + 5.0
        self.uplink = 1
        n = self.node
        n.every(J.SPLC1.pgn, 20, self._splc1, 2)
        n.every(F.TSC1.pgn, 10, self._tsc1, 3)
        n.on(F.PROP_A, self._on_cmd)
        for pgn in (F.XCMD1.pgn, F.DRV1.pgn, F.CRN1.pgn):
            n.on(pgn, lambda *a: setattr(self, "setpoint_at", time.monotonic()))
        n.on(F.GWHB1.pgn, self._on_gw)

    def _on_gw(self, sa, da, data, ts):
        v = J.decode(F.GWHB1.pgn, data)
        self.uplink_at = time.monotonic()
        self.uplink = int(v["uplink"] or 0)

    def _on_cmd(self, sa, da, data, ts):
        if da != self.node.sa or not data:
            return
        code = data[0]
        if code == F.CMD_HOLD:
            self.hold_cmd = bool(data[1] & 1)
        elif code == F.CMD_MODE:
            self.mode_cmd = data[1] if data[1] in (0, 2) else 1
        elif code == F.CMD_FAULT:
            self.fault = data[1]
        else:
            self.node.ack(1, code, F.PROP_A, sa)
            return
        self._evaluate()
        # positive acknowledgement, then the new state at once rather than on the next 20 ms tick
        self.node.ack(0, code, F.PROP_A, sa)
        self.node.send(J.SPLC1.pgn, self._splc1(), 2)

    def _evaluate(self):
        now = time.monotonic()
        rule, mode = 0, self.mode_cmd
        dtcs = []
        if self.fault in FAULTS:
            dtcs += FAULTS[self.fault]
            rule, mode = 8, 1
        if now - self.setpoint_at > 1.0:
            dtcs.append((639, 9))
            rule, mode = 7, 1
        if now - self.uplink_at > 1.0 or not self.uplink:
            # the site link is gone: stop where you are, the site will take the machine over when it is back
            dtcs.append((520192, 19))
            rule, mode = 7, 1
        if self.hold_cmd:
            rule, mode = (rule or 1), 1
        self.mode, self.rule = mode, rule
        uniq = []
        for d in dtcs:
            if d not in uniq:
                uniq.append(d)
        self.dtcs = [J.Dtc(spn, fmi, 1) for spn, fmi in uniq]
        crit = any(d.spn in (970, 639) for d in self.dtcs)
        self.lamps = J.lamp_byte(mil=0, red_stop=1 if crit else 0, amber=1 if self.dtcs and not crit else 0)

    def tick(self, dt, now):
        self._evaluate()

    def _splc1(self):
        self.hb = (self.hb + 1) % 250
        p = self.plant
        tip = abs(p["r_swing"]) * 9.0 if self.kind == "excavator" else abs(p["speed"]) if self.kind != "tower_crane" else abs(p["slew_rate"]) * p["radius"]
        return J.encode(J.SPLC1.pgn, {"mode": self.mode, "rule": self.rule, "heartbeat": self.hb, "nearest_tag_m": 600.0,
                                      "exclusion_m": 10.5 if self.kind == "excavator" else 0.0, "tip_speed_ms": tip})

    def _tsc1(self):
        # while holding, the safety PLC takes the engine to idle through TSC1 speed control
        eng = self.node.find(FUNCTION["engine"])
        if eng is None or self.mode != 1:
            return None
        self.node.send(F.TSC1.pgn, J.encode(F.TSC1.pgn, {"override_mode": 1, "speed_condition": 0, "override_priority": 0,
                                                         "requested_speed_rpm": 700.0, "requested_torque_pct": 0}), 3, eng)
        return None


# ---------- excavator

class Swing(Ecu):
    role = "swing"
    label = "Swing and boom controller"
    LIMITS = {"swing": (0.75, 2.2), "boom": (0.5, 2.0), "stick": (0.6, 2.0), "bucket": (1.1, 4.0)}

    def setup(self):
        self.target = {k: self.plant[k] for k in self.LIMITS}
        self.target_at = 0.0
        self.node.on(F.XCMD1.pgn, self._on_cmd)
        self.node.every(J.SWB1.pgn, 20, lambda: J.encode(J.SWB1.pgn, {f"{k}_rad": self.plant[k] for k in self.LIMITS}), 3)

    def _on_cmd(self, sa, da, data, ts):
        v = J.decode(F.XCMD1.pgn, data)
        for k in self.LIMITS:
            if v.get(f"{k}_target_rad") is not None:
                self.target[k] = v[f"{k}_target_rad"]
        self.target_at = time.monotonic()

    def tick(self, dt, now):
        p = self.plant
        stop = self.stopped() or time.monotonic() - self.target_at > DT_STALE
        sc = self.speed_scale()
        for k, (vmax, amax) in self.LIMITS.items():
            if stop:
                want = 0.0
            else:
                err = self.target[k] - p[k]
                if k == "swing":
                    err = wrap(err)
                want = max(-vmax * sc, min(vmax * sc, 2.2 * err))
            r = approach(p["r_" + k], want, amax * (2.0 if stop else 1.0), dt)
            p["r_" + k] = r
            p[k] = wrap(p[k] + r * dt) if k == "swing" else p[k] + r * dt


class Hydraulics(Ecu):
    role = "hydraulics"
    label = "Hydraulic controller"

    def setup(self):
        self.node.every(J.HYD1.pgn, 50, lambda: J.encode(J.HYD1.pgn, {"pump1_bar": self.plant["p1"], "pump2_bar": self.plant["p2"],
                                                                     "boom_head_bar": self.plant["boom_head"], "oil_temp_c": self.plant["hyd_t"],
                                                                     "flow_pct": 100 * self.plant["flow"]}), 4)

    def tick(self, dt, now):
        p = self.plant
        flow = min(1.0, (abs(p["r_swing"]) + abs(p["r_boom"]) + abs(p["r_stick"]) + abs(p["r_bucket"])) / 1.6)
        digging = 1.0 if p["stick"] > 0.9 and p["r_stick"] > 0.05 else 0.0
        ripple = 4.0 * math.sin(now * 17.0)
        p["flow"] = flow
        p["p1"] = 35 + 230 * flow + 90 * digging + ripple
        p["p2"] = 30 + 200 * flow + 60 * digging + 0.6 * ripple
        p["boom_head"] = 60 + 120 * max(0.0, -p["boom"]) + 25 * digging + ripple
        p["hyd_t"] = approach(p["hyd_t"], 52 + 14 * flow, 0.05, dt)


# ---------- haul truck and dozer

class Transmission(Ecu):
    role = "transmission"
    label = "Transmission"
    RATIOS = (0, 4.84, 2.81, 1.84, 1.36, 1.0, 0.74)

    def setup(self):
        self.target = {"speed": 0.0, "heading": self.plant["heading"]}
        self.target_at = 0.0
        self.node.on(F.DRV1.pgn, self._on_cmd)
        self.node.every(J.ETC2.pgn, 100, self._etc2)
        self.node.every(J.CCVS1.pgn, 100, lambda: J.encode(J.CCVS1.pgn, {"parking_brake": 1 if abs(self.plant["speed"]) < 0.05 else 0,
                                                                         "wheel_speed_kmh": abs(self.plant["speed"]) * 3.6}))

    def _on_cmd(self, sa, da, data, ts):
        v = J.decode(F.DRV1.pgn, data)
        if v["speed_target_mps"] is not None:
            self.target["speed"] = v["speed_target_mps"]
        if v["heading_target_rad"] is not None:
            self.target["heading"] = v["heading_target_rad"]
        self.target_at = time.monotonic()

    def tick(self, dt, now):
        p = self.plant
        stop = self.stopped() or time.monotonic() - self.target_at > DT_STALE
        want = 0.0 if stop else self.target["speed"] * self.speed_scale()
        brake = 3.0 if stop else 1.2
        p["speed"] = approach(p["speed"], want, brake if abs(want) < abs(p["speed"]) else 0.8, dt)
        # a hauler steers with speed, a dozer pivots on its tracks
        turn = 0.6 if self.kind == "dozer" else 0.5 * min(1.0, abs(p["speed"]) / 1.5)
        err = wrap(self.target["heading"] - p["heading"])
        if not stop:
            p["heading"] = wrap(p["heading"] + max(-turn, min(turn, 1.5 * err)) * dt)
        p["x"] = p["x"] + p["speed"] * math.cos(p["heading"]) * dt
        p["y"] = p["y"] + p["speed"] * math.sin(p["heading"]) * dt
        v = abs(p["speed"])
        p["gear"] = 0 if v < 0.2 else min(6, 1 + int(v / 1.6))

    def _etc2(self):
        g = int(self.plant["gear"]) if self.plant["speed"] >= 0 else -1
        return J.encode(J.ETC2.pgn, {"selected_gear": g, "current_gear": g, "actual_gear_ratio": self.RATIOS[max(0, g)] if g >= 0 else 4.84})


class Payload(Ecu):
    role = "payload"
    label = "Body hoist and payload weigher"

    def setup(self):
        self.body_target = 0.0
        self.loading = False
        self.next_bucket = 0.0
        self.node.on(F.DRV1.pgn, self._on_cmd)
        self.node.on(F.TSTAT1.pgn, self._on_state)
        self.node.every(J.BODY1.pgn, 100, lambda: J.encode(J.BODY1.pgn, {"body_angle_deg": self.plant["body_deg"], "payload_t": self.plant["load_t"]}), 5)

    def _on_cmd(self, sa, da, data, ts):
        v = J.decode(F.DRV1.pgn, data)
        if v["body_target_deg"] is not None:
            self.body_target = v["body_target_deg"]

    def _on_state(self, sa, da, data, ts):
        self.loading = F.TASK_STATES.get(int(J.decode(F.TSTAT1.pgn, data)["state"] or 0)) == "loading"

    def tick(self, dt, now):
        p = self.plant
        target = 0.0 if self.stopped() else self.body_target
        p["body_deg"] = approach(p["body_deg"], target, 8.0, dt)
        # the weigher reads what lands in the body: a bucket from the excavator, or the load sliding out as it tips
        if self.loading and abs(p["speed"]) < 0.05 and now >= self.next_bucket:
            p["load_t"] = min(27.0, p["load_t"] + 4.5)
            self.next_bucket = now + 7.0
        if p["body_deg"] > 35:
            p["load_t"] = max(0.0, p["load_t"] - 9.0 * dt)


class Blade(Ecu):
    role = "blade"
    label = "Track and blade controller"

    def setup(self):
        self.target = 0.2
        self.node.on(F.DRV1.pgn, self._on_cmd)
        self.node.every(J.TRK1.pgn, 50, lambda: J.encode(J.TRK1.pgn, {"left_track_mps": self.plant["speed"], "right_track_mps": self.plant["speed"],
                                                                     "blade_height_m": self.plant["blade_m"], "blade_load_pct": 100 * self.plant["blade_load"]}), 4)

    def _on_cmd(self, sa, da, data, ts):
        v = J.decode(F.DRV1.pgn, data)
        if v["blade_target_m"] is not None:
            self.target = v["blade_target_m"]

    def tick(self, dt, now):
        p = self.plant
        p["blade_m"] = approach(p["blade_m"], self.plant["blade_m"] if self.stopped() else self.target, 0.4, dt)
        p["blade_load"] = 0.6 if p["blade_m"] < 0.05 and abs(p["speed"]) > 0.3 else 0.1


# ---------- tower crane

class Slew(Ecu):
    role = "slew"
    label = "Slew and trolley drive"
    JIB = L.TC1_JIB

    def setup(self):
        self.target = {"slew": self.plant["slew"], "radius": self.plant["radius"]}
        self.target_at = 0.0
        self.node.on(F.CRN1.pgn, self._on_cmd)
        self.node.every(J.SLEW1.pgn, 20, lambda: J.encode(J.SLEW1.pgn, {"slew_rad": self.plant["slew"], "slew_rate_rads": self.plant["slew_rate"],
                                                                       "brake": 1 if abs(self.plant["slew_rate"]) < 1e-3 else 0}), 3)
        self.node.every(J.LUFF1.pgn, 20, self._luff1, 3)

    def _luff1(self):
        r = self.plant["radius"]
        return J.encode(J.LUFF1.pgn, {"luff_rad": math.acos(max(-1.0, min(1.0, (r - 2.0) / self.JIB))), "luff_rate_rads": 0.0, "radius_m": r})

    def _on_cmd(self, sa, da, data, ts):
        v = J.decode(F.CRN1.pgn, data)
        if v["slew_target_rad"] is not None:
            self.target["slew"] = v["slew_target_rad"]
        if v["radius_target_m"] is not None:
            self.target["radius"] = v["radius_target_m"]
        self.target_at = time.monotonic()

    def tick(self, dt, now):
        p = self.plant
        stop = self.stopped() or time.monotonic() - self.target_at > DT_STALE
        vmax = 0.12 * self.speed_scale()
        want = 0.0 if stop else max(-vmax, min(vmax, 0.6 * wrap(self.target["slew"] - p["slew"])))
        p["slew_rate"] = approach(p["slew_rate"], want, 0.12 if stop else 0.08, dt)
        p["slew"] = wrap(p["slew"] + p["slew_rate"] * dt)
        rv = 0.0 if stop else max(-0.8, min(0.8, 0.8 * (self.target["radius"] - p["radius"])))
        p["radius_rate"] = approach(p["radius_rate"], rv, 0.6, dt)
        p["radius"] = max(3.0, min(self.JIB, p["radius"] + p["radius_rate"] * dt))


class Hoist(Ecu):
    role = "hoist"
    label = "Hoist drive"

    def setup(self):
        self.target = {"hook": self.plant["hook_z"], "load": 0.0}
        self.target_at = 0.0
        self.node.on(F.CRN1.pgn, self._on_cmd)
        self.node.every(J.HOIST1.pgn, 20, lambda: J.encode(J.HOIST1.pgn, {"hook_height_m": self.plant["hook_z"], "rope_speed_mps": self.plant["rope_speed"],
                                                                         "load_t": self.plant["crane_load_t"]}), 3)

    def _on_cmd(self, sa, da, data, ts):
        v = J.decode(F.CRN1.pgn, data)
        if v["hook_target_m"] is not None:
            self.target["hook"] = v["hook_target_m"]
        if v["load_t"] is not None:
            self.target["load"] = v["load_t"]
        self.target_at = time.monotonic()

    def tick(self, dt, now):
        p = self.plant
        stop = self.stopped() or time.monotonic() - self.target_at > DT_STALE
        want = 0.0 if stop else max(-1.2, min(1.2, 0.8 * (self.target["hook"] - p["hook_z"]))) * self.speed_scale()
        p["rope_speed"] = approach(p["rope_speed"], want, 1.5, dt)
        p["hook_z"] = p["hook_z"] + p["rope_speed"] * dt
        # the load cell reads what is slung once the hook has come down to it
        if p["hook_z"] < 3.0:
            p["crane_load_t"] = self.target["load"]


class Lmi(Ecu):
    role = "lmi"
    label = "Load moment indicator"

    def setup(self):
        self.node.every(J.LMI1.pgn, 100, lambda: J.encode(J.LMI1.pgn, {"radius_m": self.plant["radius"], "load_t": self.plant["crane_load_t"],
                                                                      "lmi_pct": self.plant["lmi_pct"], "wind_ms": self.plant["wind"],
                                                                      "chart_t": self.plant["chart_t"]}), 2)

    def tick(self, dt, now):
        p = self.plant
        cap = min(12.0, 300.0 / max(1.0, p["radius"]))
        p["chart_t"] = cap
        p["lmi_pct"] = 100.0 * (p["crane_load_t"] + 0.4) / cap
        p["wind"] = 6.5 + 1.5 * math.sin(now * 0.07) + random.uniform(-0.3, 0.3)


ECUS = {c.role: c for c in (Engine, Telematics, Safety, Swing, Hydraulics, Transmission, Payload, Blade, Slew, Hoist, Lmi)}
