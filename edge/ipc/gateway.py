"""The edge gateway: the industrial PC on the machine. It reads the bus through python-can like any J1939 node,
maps what it hears to Sparkplug B on MQTT, and turns commands from the site back into J1939 frames.

- NBIRTH and a DBIRTH per ECU, NDATA once a second, DDATA every 50 ms with what changed.
- seq on every message, bdSeq on births and on the NDEATH registered as the MQTT last will.
- NCMD: Node Control/Rebirth, Node Control/Unplug_s (drops the link without a goodbye, so the will fires).
- DCMD: Safety/Hold, Mode/Set and Diagnostics/InjectFault become proprietary A commands to the safety PLC,
  Task/Assign goes to the controller over the transport protocol.
- Raw frames as JSON batches every 50 ms on groundwork/{node}/can/raw. Signals are decoded through the DBC with
  cantools. The bus's own numbers (load, arbitration, error counters, bus state) come from the canbus sidecar.
"""

from __future__ import annotations

import json
import socket
import os
import statistics
import threading
import time
from collections import deque
from urllib.parse import urlparse

import paho.mqtt.client as mqtt

from . import dbc
from . import frames as F
from . import sparkplug as SP
from .frames import J, L
from .machines import FUNCTION, MACHINES, identity, preferred_sa
from .stack import GLOBAL, Node, make_name

GROUP = os.environ.get("SPARKPLUG_GROUP", "groundwork")
T = SP.T
ROLE_BY_FUNCTION = {v: k for k, v in FUNCTION.items()}

# PGN acronym and SPN name to the Sparkplug metric and its type
MAP = {
    "EEC1": {"engine_speed_rpm": ("Engine/Speed_rpm", T.Double), "actual_torque_pct": ("Engine/Torque_pct", T.Double),
             "controlling_sa": ("Engine/ControllingSA", T.Int32), "torque_mode": ("Engine/TorqueMode", T.Int32)},
    "LFE1": {"fuel_rate_lph": ("Engine/FuelRate_lph", T.Double), "throttle_pct": ("Engine/Throttle_pct", T.Double)},
    "ET1": {"coolant_c": ("Engine/Coolant_C", T.Double), "oil_temp_c": ("Engine/OilTemp_C", T.Double)},
    "HOURS": {"engine_hours": ("Engine/Hours_h", T.Double)},
    "VP": {"latitude_deg": ("GNSS/Lat_deg", T.Double), "longitude_deg": ("GNSS/Lon_deg", T.Double)},
    "VDS": {"compass_bearing_deg": ("GNSS/Bearing_deg", T.Double), "nav_speed_kmh": ("GNSS/Speed_kmh", T.Double)},
    "GNSS1": {"x_m": ("GNSS/X_m", T.Double), "y_m": ("GNSS/Y_m", T.Double)},
    "GNSS2": {"heading_rad": ("GNSS/Heading_rad", T.Double), "speed_mps": ("GNSS/Speed_mps", T.Double), "fix": ("GNSS/Fix", T.Int32),
              "sats": ("GNSS/Sats", T.Int32)},
    "SPLC1": {"rule": ("Safety/Rule", T.Int32), "heartbeat": ("Safety/Heartbeat", T.Int32), "tip_speed_ms": ("Safety/TipSpeed_mps", T.Double),
              "exclusion_m": ("Safety/Exclusion_m", T.Double)},
    "HYD1": {"pump1_bar": ("Hydraulics/Pump1Pressure_bar", T.Double), "pump2_bar": ("Hydraulics/Pump2Pressure_bar", T.Double),
             "boom_head_bar": ("Hydraulics/BoomPressure_bar", T.Double), "oil_temp_c": ("Hydraulics/OilTemp_C", T.Double),
             "flow_pct": ("Hydraulics/Flow_pct", T.Double)},
    "SWB1": {"swing_rad": ("Kinematics/Swing_rad", T.Double), "boom_rad": ("Kinematics/Boom_rad", T.Double),
             "stick_rad": ("Kinematics/Stick_rad", T.Double), "bucket_rad": ("Kinematics/Bucket_rad", T.Double)},
    "ETC2": {"selected_gear": ("Transmission/Gear", T.Int32)},
    "CCVS1": {"parking_brake": ("Transmission/ParkingBrake", T.Boolean), "wheel_speed_kmh": ("Transmission/WheelSpeed_kmh", T.Double)},
    "BODY1": {"body_angle_deg": ("Kinematics/Body_deg", T.Double), "payload_t": ("Payload/Load_t", T.Double)},
    "TRK1": {"left_track_mps": ("Kinematics/TrackLeft_mps", T.Double), "right_track_mps": ("Kinematics/TrackRight_mps", T.Double),
             "blade_height_m": ("Kinematics/Blade_m", T.Double), "blade_load_pct": ("Blade/Load_pct", T.Double)},
    "SLEW1": {"slew_rad": ("Kinematics/Slew_rad", T.Double), "slew_rate_rads": ("Slew/Rate_rads", T.Double), "brake": ("Slew/Brake", T.Boolean)},
    "LUFF1": {"luff_rad": ("Kinematics/Luff_rad", T.Double), "radius_m": ("Kinematics/Radius_m", T.Double)},
    "HOIST1": {"hook_height_m": ("Kinematics/Hook_m", T.Double), "rope_speed_mps": ("Hoist/RopeSpeed_mps", T.Double), "load_t": ("Hoist/Load_t", T.Double)},
    "LMI1": {"lmi_pct": ("LMI/Moment_pct", T.Double), "wind_ms": ("LMI/Wind_ms", T.Double), "chart_t": ("LMI/Chart_t", T.Double),
             "load_t": ("LMI/Load_t", T.Double), "radius_m": ("LMI/Radius_m", T.Double)},
}
WRITABLE = {
    "safety": {"Safety/Hold": (False, T.Boolean), "Mode/Set": ("auto", T.String), "Diagnostics/InjectFault": (0, T.Int32)},
    "telematics": {"Task/Assign": ("", T.String)},
}
FAULT_TEXT = {970: "auxiliary shutdown switch (emergency stop)", 639: "J1939 network 1", 520192: "site uplink", 1675: "engine starter mode"}
FMI_TEXT = {31: "condition exists", 9: "abnormal update rate", 19: "received network data in error", 2: "data erratic"}


def frame_bits(dlc: int) -> int:
    # extended frame: 67 bits of framing plus the data, and about a tenth again in stuff bits
    return 67 + 8 * dlc + int((34 + 8 * dlc) * 0.1)


class Gateway:
    role = "gateway"

    def __init__(self, machine: str):
        self.machine = machine
        self.spec = MACHINES[machine]
        self.node_id = self.spec["node"]
        self.site = F.env_site()
        self.node = Node(f"{machine}/gateway", make_name(identity(machine, "gateway"), FUNCTION["gateway"]), preferred_sa(machine, "gateway"))
        self.lock = threading.RLock()
        self.values: dict = {d: {} for d in self.spec["devices"]}     # device -> metric -> (value, type)
        self.dirty: dict = {d: set() for d in self.spec["devices"]}
        self.aliases: dict = {}
        self.ecu: dict = {}                                             # device -> {sa, name}
        for d, ms in WRITABLE.items():
            if d in self.values:
                for k, (v, t) in ms.items():
                    self.values[d][k] = (v, t)
        self.raw: list = []
        self.window: deque = deque()                                    # (t, bits) for the bus load
        self.can_lat: deque = deque(maxlen=400)
        self.seq = 0
        self.bdseq = 0
        self.client = None
        self.connected = False
        self.unplug_until = 0.0
        self.pending: dict = {}                                         # cmd id -> {t, value, acked}
        self.cmd_id = 0
        self.lat = {"Latency/BusToGateway_ms": None, "Latency/BusQueue_ms": None, "Latency/BusQueueP99_ms": None, "Latency/HoldAck_ms": None, "Latency/HoldStop_ms": None,
                    "Latency/DcmdToBus_ms": None, "Latency/TaskAck_ms": None}
        self.last_motion = {}
        self.hb = 0
        self.stats = {"pub": 0, "pub_window": deque(), "tp_sessions": 0, "claims": 0}
        url = urlparse(os.environ.get("MQTT_URL", "mqtt://abenix-mosquitto.abenix.svc.cluster.local:1883"))
        self.broker = (url.hostname, url.port or 1883)
        self.mqtt_user = os.environ.get("MQTT_USERNAME") or None
        self.mqtt_pass = os.environ.get("MQTT_PASSWORD") or None
        self.busstats: dict = {}
        n = self.node
        n.raw_hooks.append(self._on_raw)
        n.on(-1, self._on_frame)
        n.every(F.GWHB1.pgn, 100, self._gwhb)
        n.every(J.HOURS.pgn, 10000, self._ask_hours)
        self.asked = False
        self.asked_ci = False

    # ---------- bus side

    def _on_raw(self, msg, own):
        now = time.time()
        if not own and msg.timestamp:
            self.can_lat.append(max(0.0, now - msg.timestamp) * 1000)
        data = bytes(msg.data)
        with self.lock:
            self.raw.append({"t": round(msg.timestamp or now, 6), "id": msg.arbitration_id, "data": data.hex().upper(), "dlc": len(data)})
            self.window.append((now, frame_bits(len(data))))

    def _device_of(self, sa: int):
        name = self.node.addresses.get(sa)
        if name is None:
            return None
        role = ROLE_BY_FUNCTION.get((name >> 40) & 0xFF)
        if role == "controller":
            return "telematics" if "telematics" in self.values else None
        return role if role in self.values else None

    def _set(self, dev: str, metric: str, value, dt: int) -> None:
        old = self.values[dev].get(metric)
        if isinstance(value, float):
            value = round(value, 4)
        if old is None or old[0] != value:
            self.values[dev][metric] = (value, dt)
            self.dirty[dev].add(metric)

    def _on_frame(self, pgn, sa, da, data, ts):
        if pgn == F.ADDRESS_CLAIMED:
            dev = self._device_of(sa)
            self.stats["claims"] += 1
            if dev:
                role = ROLE_BY_FUNCTION.get((self.node.addresses.get(sa, 0) >> 40) & 0xFF)
                prefix = "Controller" if role == "controller" else "ECU"
                with self.lock:
                    self._set(dev, f"{prefix}/Address", sa, T.Int32)
                    self._set(dev, f"{prefix}/Name", f"{self.node.addresses.get(sa, 0):016X}", T.String)
            return
        if pgn == J.TP_CM.pgn:
            if data and data[0] in (32, 16):
                self.stats["tp_sessions"] += 1
            return
        if pgn == F.ACKM:
            self._on_ack(sa, data)
            return
        dev = self._device_of(sa)
        if dev is None:
            return
        with self.lock:
            if pgn == J.DM1.pgn:
                lamps, dtcs = J.decode_dm1(data)
                self._set(dev, "Diagnostics/ActiveCount", len(dtcs), T.Int32)
                self._set(dev, "Diagnostics/DTCs", "; ".join(f"SPN {d.spn} FMI {d.fmi} OC {d.oc}" for d in dtcs) or "none", T.String)
                self._set(dev, "Diagnostics/Text", "; ".join(f"{FAULT_TEXT.get(d.spn, 'SPN ' + str(d.spn))}: {FMI_TEXT.get(d.fmi, 'FMI ' + str(d.fmi))}" for d in dtcs) or "no active faults", T.String)
                self._set(dev, "Diagnostics/RedStop", lamps["red_stop"] == 1, T.Boolean)
                self._set(dev, "Diagnostics/Amber", lamps["amber_warning"] == 1, T.Boolean)
                return
            if pgn == F.TSTAT1.pgn:
                v = J.decode(pgn, data)
                self._set(dev, "Task/State", F.TASK_STATES.get(int(v["state"] or 0), "idle"), T.String)
                self._set(dev, "Task/Cycles", int(v["cycles"] or 0), T.Int32)
                self._set(dev, "Task/Seq", int(v["task_seq"] or 0), T.Int32)
                return
            if pgn == F.SOFT or pgn == F.CI:
                self._set(dev, "ECU/Software" if pgn == F.SOFT else "ECU/Component", bytes(data).decode("ascii", "replace").strip("*"), T.String)
                return
            acr, v = dbc.decode_pgn(pgn, data)
            m = MAP.get(acr)
            if not m:
                return
            for spn, (metric, dt) in m.items():
                x = v.get(spn)
                if x is None:
                    continue
                self._set(dev, metric, bool(x) if dt == T.Boolean else int(x) if dt == T.Int32 else float(x), dt)
            if pgn == J.SPLC1.pgn:
                mode = F.MODES.get(int(v["mode"] or 0), "auto")
                self._set(dev, "Safety/Mode", mode, T.String)
                self._set(dev, "Safety/Holding", mode == "hold", T.Boolean)
            self._watch_stop(acr, v)

    def _watch_stop(self, acr, v):
        # the stop is measured where the site sees it: the moment the actuators report still on the bus
        moving = None
        if acr == "SWB1":
            prev = self.last_motion.get("SWB1")
            cur = tuple(v.get(k) or 0 for k in ("swing_rad", "boom_rad", "stick_rad", "bucket_rad"))
            self.last_motion["SWB1"] = cur
            if prev:
                moving = max(abs(a - b) for a, b in zip(cur, prev)) > 0.0006
        elif acr == "GNSS2":
            moving = abs(v.get("speed_mps") or 0) > 0.05
        elif acr == "SLEW1":
            moving = abs(v.get("slew_rate_rads") or 0) > 0.002
        if moving is None:
            return
        now = time.time()
        for cid, c in list(self.pending.items()):
            if c["kind"] != "hold" or not c["value"] or "stop" in c:
                continue
            # only a machine that was moving when the hold arrived gives a stop time
            c.setdefault("was_moving", moving)
            if not c["was_moving"]:
                c["stop"] = None
                continue
            c["still"] = c.get("still", 0) + 1 if not moving else 0
            if c["still"] >= 2:
                c["stop"] = now
                self.lat["Latency/HoldStop_ms"] = round((now - c["t"]) * 1000, 1)

    def _on_ack(self, sa, data):
        if len(data) < 8:
            return
        ctl, fn = data[0], data[1]
        pgn = data[5] | (data[6] << 8) | (data[7] << 16)
        if pgn != F.PROP_A or data[4] != self.node.sa:
            return
        now = time.time()
        for cid, c in sorted(self.pending.items()):
            if c["code"] == fn and not c.get("acked"):
                c["acked"] = now
                c["ok"] = ctl == 0
                key = "Latency/TaskAck_ms" if fn == F.CMD_TASK else "Latency/HoldAck_ms"
                self.lat[key] = round((now - c["t"]) * 1000, 1)
                with self.lock:
                    if c["kind"] == "hold":
                        self._set("safety", "Safety/Hold", bool(c["value"]), T.Boolean)
                    elif c["kind"] == "mode":
                        self._set("safety", "Mode/Set", c["value"], T.String)
                    elif c["kind"] == "fault":
                        self._set("safety", "Diagnostics/InjectFault", int(c["value"]), T.Int32)
                    elif c["kind"] == "task":
                        self._set("telematics", "Task/Assign", c["value"], T.String)
                break
        for cid in [k for k, c in self.pending.items() if now - c["t"] > 10]:
            del self.pending[cid]

    def _gwhb(self):
        self.hb = (self.hb + 1) % 250
        return J.encode(F.GWHB1.pgn, {"uplink": 1 if self.connected else 0, "counter": self.hb})

    def _ask_hours(self):
        eng = self.node.find(FUNCTION["engine"])
        if not self.asked:
            self.asked = True
            # who is on the bus, and what software they run: SOFT answers to global go out as BAM
            self.node.request(F.ADDRESS_CLAIMED, GLOBAL)
            self.node.request(F.SOFT, GLOBAL)
        if eng is not None:
            self.node.request(J.HOURS.pgn, eng)
            if not self.asked_ci:
                self.asked_ci = True
                # component identification asked of the engine alone comes back over RTS/CTS
                self.node.request(F.CI, eng)
        return None

    # ---------- commands from the site

    def _command(self, device: str, metric: str, value) -> None:
        self.cmd_id = (self.cmd_id + 1) % 65536
        cid = self.cmd_id
        now = time.time()
        if device == "safety" and metric in ("Safety/Hold", "Mode/Set", "Diagnostics/InjectFault"):
            sa = self.node.find(FUNCTION["safety"])
            if sa is None:
                return
            if metric == "Safety/Hold":
                code, arg, kind, val = F.CMD_HOLD, 1 if value else 0, "hold", bool(value)
            elif metric == "Mode/Set":
                val = str(value).lower()
                code, arg, kind = F.CMD_MODE, F.MODE_CODE.get(val, 1), "mode"
            else:
                code, arg, kind, val = F.CMD_FAULT, int(value) & 0xFF, "fault", int(value)
            self.pending[cid] = {"t": now, "code": code, "kind": kind, "value": val}
            self.node.send(F.PROP_A, bytes((code, arg, cid & 0xFF, cid >> 8, 0xFF, 0xFF, 0xFF, 0xFF)), 1, sa)
            self.lat["Latency/DcmdToBus_ms"] = round((time.time() - now) * 1000, 2)
        elif device == "telematics" and metric == "Task/Assign":
            sa = self.node.find(FUNCTION["controller"])
            if sa is None:
                return
            body = str(value).encode("utf-8")
            self.pending[cid] = {"t": now, "code": F.CMD_TASK, "kind": "task", "value": str(value)}
            self.node.send(F.PROP_A, bytes((F.CMD_TASK,)) + body, 6, sa)

    def _on_message(self, client, userdata, msg):
        parts = msg.topic.split("/")
        try:
            p = SP.parse(msg.payload)
        except Exception:  # noqa: BLE001
            return
        if parts[2] == "NCMD":
            for m in p.metrics:
                name = m.name or ""
                if name == "Node Control/Rebirth" and SP.value_of(m):
                    self._births()
                elif name == "Bus/InjectNoise_s":
                    self._bus_control({"cmd": "noise", "p": float(os.environ.get("CAN_NOISE_P", "0.15")), "seconds": float(SP.value_of(m) or 5)})
                elif name == "Node Control/Unplug_s":
                    self.unplug_until = time.time() + max(1.0, float(SP.value_of(m) or 10))
                    self._drop()
        elif parts[2] == "DCMD" and len(parts) >= 5:
            dev = parts[4]
            for m in p.metrics:
                self._command(dev, m.name, SP.value_of(m))

    # ---------- MQTT side

    def _topic(self, kind: str, device: str | None = None) -> str:
        return f"spBv1.0/{GROUP}/{kind}/{self.node_id}" + (f"/{device}" if device else "")

    def _next_seq(self) -> int:
        s = self.seq
        self.seq = (self.seq + 1) % 256
        return s

    def _node_metrics(self) -> list:
        now = time.time()
        with self.lock:
            while self.window and now - self.window[0][0] > 1.0:
                self.window.popleft()
            bits = sum(b for _, b in self.window)
            fps = len(self.window)
        while self.stats["pub_window"] and now - self.stats["pub_window"][0] > 1.0:
            self.stats["pub_window"].popleft()
        lat = sorted(self.can_lat)
        p50 = round(statistics.median(lat), 2) if lat else None
        self.lat["Latency/BusToGateway_ms"] = p50
        b = self.busstats
        self.lat["Latency/BusQueue_ms"] = b.get("queue_ms_p50")
        self.lat["Latency/BusQueueP99_ms"] = b.get("queue_ms_p99")
        out = [("Bus/Load_pct", b.get("load_pct", round(100.0 * bits / 250000.0, 2)), T.Double),
               ("Bus/FramesPerSecond", b.get("frames_per_s", fps), T.Int32),
               ("Bus/Bitrate_kbps", int(b.get("bitrate", 250000) / 1000), T.Int32), ("Bus/TPSessions", self.stats["tp_sessions"], T.Int64),
               ("Bus/State", b.get("state", "unknown"), T.String), ("Bus/ArbitrationLost", b.get("arbitration_lost", 0), T.Int64),
               ("Bus/ErrorFrames", b.get("error_frames", 0), T.Int64), ("Bus/AckErrors", b.get("ack_errors", 0), T.Int64),
               ("Bus/Frames", b.get("frames", 0), T.Int64), ("Bus/NoiseInjected", b.get("noise_p", 0.0), T.Double),
               ("Bus/StuffBits_pct", round(100.0 * b.get("stuff_bits", 0) / max(1, b.get("bits", 1)), 2), T.Double),
               ("Bus/AddressClaims", self.stats["claims"], T.Int64), ("Bus/ECUs", len(self.node.addresses), T.Int32),
               ("Uplink/MessagesPerSecond", len(self.stats["pub_window"]), T.Int32)]
        out += [(k, v, T.Double) for k, v in self.lat.items() if v is not None]
        return out

    def _alias(self, key: str) -> int:
        if key not in self.aliases:
            self.aliases[key] = len(self.aliases) + 1
        return self.aliases[key]

    def _publish(self, topic: str, data: bytes, qos: int = 0) -> None:
        c = self.client
        if c is None or not self.connected:
            return
        c.publish(topic, data, qos=qos)
        self.stats["pub"] += 1
        self.stats["pub_window"].append(time.time())

    def _births(self) -> None:
        self.seq = 0
        props = [("bdSeq", self.bdseq, T.Int64, None, False), ("Node Control/Rebirth", False, T.Boolean, None, True),
                 ("Node Control/Unplug_s", 0.0, T.Double, None, True),
                 ("Properties/Machine", self.machine, T.String, None, False), ("Properties/Kind", self.spec["kind"], T.String, None, False),
                 ("Properties/Site", self.site, T.String, None, False),
                 ("Properties/Bus", f"{os.environ.get('CAN_INTERFACE', 'socketcand')} {os.environ.get('CAN_CHANNEL', 'vcan0')} at {os.environ.get('CAN_HOST', 'localhost')}, J1939 250 kbit/s", T.String, None, False),
                 ("Properties/Simulated", "the machine, its sensors and the copper are simulated; J1939, socketcand, the gateway, Sparkplug B and MQTT are real", T.String, None, False),
                 ("Bus/InjectNoise_s", 0.0, T.Double, None, True)]
        props += [(k, v, t, self._alias("node/" + k), False) for k, v, t in self._node_metrics()]
        self._publish(self._topic("NBIRTH"), SP.payload(props, self._next_seq()), 1)
        with self.lock:
            for dev, vals in self.values.items():
                writable = WRITABLE.get(dev, {})
                ms = [(k, v, t, self._alias(f"{dev}/{k}"), k in writable) for k, (v, t) in sorted(vals.items())]
                self._publish(self._topic("DBIRTH", dev), SP.payload(ms, self._next_seq()), 1)
                self.dirty[dev].clear()

    def _death(self) -> bytes:
        return SP.payload([("bdSeq", self.bdseq, T.Int64, None, False)], None)

    def _connect(self) -> None:
        c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"{self.node_id}-gw", clean_session=True)
        if self.mqtt_user:
            c.username_pw_set(self.mqtt_user, self.mqtt_pass)
        c.will_set(self._topic("NDEATH"), self._death(), qos=1, retain=False)
        c.on_message = self._on_message

        def on_connect(cl, ud, flags, rc, props=None):
            if rc != 0:
                return
            self.connected = True
            cl.subscribe([(self._topic("NCMD"), 1), (f"spBv1.0/{GROUP}/DCMD/{self.node_id}/+", 1), ("spBv1.0/STATE/+", 1)])
            self._births()

        def on_disconnect(cl, ud, flags, rc, props=None):
            self.connected = False

        c.on_connect = on_connect
        c.on_disconnect = on_disconnect
        c.reconnect_delay_set(1, 5)
        self.client = c
        c.connect_async(self.broker[0], self.broker[1], keepalive=10)
        c.loop_start()

    def _drop(self) -> None:
        """Unplugged: the socket goes without a DISCONNECT, so the broker publishes our NDEATH."""
        c = self.client
        self.client = None
        self.connected = False
        if c is None:
            return
        try:
            s = c.socket()
            if s:
                s.close()
        except OSError:
            pass
        try:
            c.loop_stop()
        except Exception:  # noqa: BLE001
            pass

    def _uplink(self) -> None:
        last_ddata = 0.0
        last_ndata = 0.0
        while True:
            now = time.time()
            if self.client is None and now >= self.unplug_until:
                self.bdseq = (self.bdseq + 1) % 256
                self._connect()
            if self.connected and now - last_ddata >= 0.05:
                last_ddata = now
                with self.lock:
                    batch, self.raw = self.raw, []
                    out = []
                    for dev, keys in self.dirty.items():
                        if keys:
                            ms = [(k, self.values[dev][k][0], self.values[dev][k][1], self._alias(f"{dev}/{k}"), False) for k in sorted(keys)]
                            out.append((dev, ms))
                            keys.clear()
                for dev, ms in out:
                    self._publish(self._topic("DDATA", dev), SP.payload(ms, self._next_seq()))
                if batch:
                    self._publish(f"groundwork/{self.node_id}/can/raw", json.dumps(batch, separators=(",", ":")).encode())
            elif not self.connected:
                with self.lock:
                    self.raw = self.raw[-2000:]
            if self.connected and now - last_ndata >= 1.0:
                last_ndata = now
                ms = [(k, v, t, self._alias("node/" + k), False) for k, v, t in self._node_metrics()]
                self._publish(self._topic("NDATA"), SP.payload(ms, self._next_seq()))
            time.sleep(0.01)

    def _bus_control(self, req: dict) -> dict:
        """The canbus sidecar's stats and control line, on localhost next to the socketcand port."""
        host = os.environ.get("CAN_HOST", "localhost")
        port = int(os.environ.get("CANBUS_CONTROL_PORT", "29537"))
        try:
            with socket.create_connection((host, port), timeout=1.0) as sk:
                sk.sendall((json.dumps(req) + "\n").encode())
                buf = b""
                while not buf.endswith(b"\n"):
                    chunk = sk.recv(65536)
                    if not chunk:
                        break
                    buf += chunk
            return json.loads(buf or b"{}")
        except (OSError, ValueError):
            return {}

    def _bus_poll(self) -> None:
        while True:
            snap = self._bus_control({"cmd": "stats"})
            if snap:
                self.busstats = snap
                with self.lock:
                    for c in snap.get("controllers", []):
                        dev = self._device_of(c["sa"]) if c.get("sa") is not None else None
                        if dev and ROLE_BY_FUNCTION.get((self.node.addresses.get(c["sa"], 0) >> 40) & 0xFF) != "controller":
                            self._set(dev, "ECU/TEC", int(c["tec"]), T.Int32)
                            self._set(dev, "ECU/REC", int(c["rec"]), T.Int32)
                            self._set(dev, "ECU/ErrorState", c["state"], T.String)
                            self._set(dev, "ECU/ArbitrationLost", int(c["arbitration_lost"]), T.Int64)
            time.sleep(1.0)

    def run(self) -> None:
        threading.Thread(target=self._uplink, daemon=True).start()
        if os.environ.get("CAN_INTERFACE", "socketcand") == "socketcand":
            threading.Thread(target=self._bus_poll, daemon=True).start()
        self.node.run(None, 400.0)
