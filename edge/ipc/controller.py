"""The machine's onboard controller. It reads the machine only through the bus, runs the task the site gave it
and sends setpoints to the actuator ECUs. It never touches the plant.

Tasks arrive from the gateway as JSON over the J1939 transport protocol, proprietary A, command 0x10:
  {"do": "auto"}                                    the machine's own cycle from the site layout
  {"do": "hold"}                                    stop commanding motion
  {"do": "dig", "dig_centre": rad, "load_at": [x, y] | null}               excavator
  {"do": "route", "route": [[x, y], ...], "then": "load" | "tip" | "stop"} haul truck, dozer
  {"do": "spread", "lanes": [y, ...], "run": [x0, x1]}                      dozer
  {"do": "lift", "from": [x, y], "to": [x, y], "tonnes": t}                 tower crane
"""

from __future__ import annotations

import json
import math
import time

from . import frames as F
from .ecus import wrap
from .frames import J, L
from .machines import FUNCTION, MACHINES, identity, preferred_sa
from .stack import Node, make_name


class Controller:
    role = "controller"

    def __init__(self, machine: str):
        self.machine = machine
        self.kind = MACHINES[machine]["kind"]
        self.node = Node(f"{machine}/controller", make_name(identity(machine, "controller"), FUNCTION["controller"]), preferred_sa(machine, "controller"))
        self.fb: dict = {}
        self.safety_mode = 0
        self.state = "idle"
        self.phase_t = 0.0
        self.cycles = 0
        self.task_seq = 0
        self.task = {"do": "auto"}
        self.plan: list = []
        self.sp: dict = {}
        n = self.node
        for pgn in (J.SWB1.pgn, F.GNSS1.pgn, F.GNSS2.pgn, J.SLEW1.pgn, J.LUFF1.pgn, J.HOIST1.pgn, J.BODY1.pgn, J.TRK1.pgn):
            n.on(pgn, lambda sa, da, data, ts, pgn=pgn: self.fb.update({k: v for k, v in J.decode(pgn, data).items() if v is not None}))
        n.on(J.SPLC1.pgn, lambda sa, da, data, ts: setattr(self, "safety_mode", int(J.decode(J.SPLC1.pgn, data)["mode"] or 0)))
        n.on(F.PROP_A, self._on_cmd)
        n.every(F.TSTAT1.pgn, 200, self._tstat)
        if self.kind == "excavator":
            n.every(F.XCMD1.pgn, 20, lambda: J.encode(F.XCMD1.pgn, self.sp), 3)
        elif self.kind == "tower_crane":
            n.every(F.CRN1.pgn, 20, lambda: J.encode(F.CRN1.pgn, self.sp), 3)
        else:
            n.every(F.DRV1.pgn, 20, lambda: J.encode(F.DRV1.pgn, self.sp), 3)
        self._default()

    # ---------- tasks

    def _on_cmd(self, sa, da, data, ts):
        if da != self.node.sa or not data or data[0] != F.CMD_TASK:
            return
        try:
            task = json.loads(bytes(data[1:]).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self.node.ack(1, F.CMD_TASK, F.PROP_A, sa)
            return
        self.task_seq = (self.task_seq + 1) % 65536
        self.task = task
        self.plan = []
        if task.get("do") == "auto":
            self._default()
        self.phase_t = 0.0
        self.node.ack(0, F.CMD_TASK, F.PROP_A, sa)

    def _default(self):
        if self.kind == "excavator":
            self.task = {"do": "dig", "dig_centre": L.EX1_DIG, "load_at": list(L.NODES["bay1"])}
            self.state = "dig"
        elif self.kind == "haul_truck":
            self.task = {"do": "cycle"}
            self.state = "to_load"
            self.plan = [list(p) for p in L.route_to_bay("EX1")] + [list(L.NODES["bay1"])]
        elif self.kind == "dozer":
            self.task = {"do": "spread", "lanes": list(L.DOZER_LANES), "run": list(L.SPOIL_RUN)}
            self.state = "spread"
            self.lane = 0
            self.dir = 1
        else:
            locs = L.LOCATIONS
            self.task = {"do": "lift", "from": list(locs["laydown"]), "to": list(locs["core"]), "tonnes": 2.4, "cycle": True}
            self.state = "to_pick"

    # ---------- feedback helpers

    def pose(self):
        return self.fb.get("x_m", 0.0), self.fb.get("y_m", 0.0), self.fb.get("heading_rad", 0.0)

    def tick(self, dt, now):
        self.phase_t += dt
        if self.task.get("do") == "hold" or not self.fb:
            self.state = "held" if self.task.get("do") == "hold" else "idle"
            self._hold_setpoints()
            return
        getattr(self, f"_{self.kind}")(dt)

    def _hold_setpoints(self):
        if self.kind == "excavator":
            self.sp = {f"{k}_target_rad": self.fb.get(f"{k}_rad", 0.0) for k in ("swing", "boom", "stick", "bucket")}
        elif self.kind == "tower_crane":
            self.sp = {"slew_target_rad": self.fb.get("slew_rad", 0.0), "radius_target_m": self.fb.get("radius_m", 20.0),
                       "hook_target_m": self.fb.get("hook_height_m", 20.0), "load_t": self.fb.get("load_t", 0.0)}
        else:
            self.sp = {"speed_target_mps": 0.0, "heading_target_rad": self.pose()[2], "body_target_deg": 0.0, "blade_target_m": 0.2}

    # ---------- excavator: dig, swing to the truck, dump, swing back

    def _ex_targets(self, abs_ang, boom, stick, bucket):
        _, _, heading = self.pose()
        self.sp = {"swing_target_rad": wrap(abs_ang - heading), "boom_target_rad": boom, "stick_target_rad": stick, "bucket_target_rad": bucket}

    def _ex_at(self, tol):
        sp = self.sp
        return all(abs(wrap(sp[f"{k}_target_rad"] - self.fb.get(f"{k}_rad", 99))) < tol for k in ("swing", "boom", "stick", "bucket"))

    def _excavator(self, dt):
        x, y, _ = self.pose()
        t = self.task
        centre = t.get("dig_centre", L.EX1_DIG)
        load_at = t.get("load_at")
        truck = math.atan2(load_at[1] - y, load_at[0] - x) if load_at else centre + 0.9
        st = self.state
        if st not in ("dig", "swing_load", "dump", "swing_back"):
            st = self.state = "dig"
        if st == "dig":
            off = (-0.3, -0.1, 0.1, 0.3)[self.cycles % 4]
            self._ex_targets(centre + off, -0.35, 1.05, 1.35)
            if self._ex_at(0.08) and self.phase_t > 2.5:
                self.state, self.phase_t = "swing_load", 0.0
        elif st == "swing_load":
            self._ex_targets(truck, 0.45, 0.35, 1.35)
            if self._ex_at(0.06):
                self.state, self.phase_t = "dump", 0.0
        elif st == "dump":
            self._ex_targets(truck, 0.45, 0.35, -0.55)
            if self.phase_t > 1.6:
                self.state, self.phase_t = "swing_back", 0.0
                self.cycles += 1
        elif st == "swing_back":
            self._ex_targets(centre, 0.1, 0.7, 0.4)
            if self._ex_at(0.1):
                self.state, self.phase_t = "dig", 0.0

    # ---------- drive: pure pursuit along a route

    def _follow(self, route, speed, arrive=1.2):
        x, y, h = self.pose()
        # a waypoint counts once it is close or already behind on the way to the next one
        while len(route) > 1:
            (ax, ay), (bx, by) = route[0], route[1]
            if math.hypot(ax - x, ay - y) < 3.0 or (x - ax) * (bx - ax) + (y - ay) * (by - ay) > 0:
                route.pop(0)
            else:
                break
        if not route:
            return True
        tx, ty = route[0]
        d = math.hypot(tx - x, ty - y)
        if len(route) == 1 and d < arrive:
            route.pop(0)
            return True
        want = math.atan2(ty - y, tx - x)
        v = speed if len(route) > 1 or d > 8 else max(0.8, speed * d / 8)
        # slow into a turn the machine cannot make at speed, as a driver would
        err = abs(wrap(want - h))
        v = max(min(v, 1.5), v * max(0.0, math.cos(err))) if err > 0.3 else v
        self.sp.update({"speed_target_mps": v, "heading_target_rad": want})
        return False

    def _haul_truck(self, dt):
        t = self.task
        self.sp.setdefault("body_target_deg", 0.0)
        self.sp["blade_target_m"] = 0.2
        if t.get("do") == "route":
            if self.state not in ("drive", "loading", "tip", "idle"):
                self.state, self.plan = "drive", [list(p) for p in t.get("route", [])]
            if self.state == "drive" and self._follow(self.plan, 6.0):
                self.state, self.phase_t = {"load": "loading", "tip": "tip"}.get(t.get("then", "stop"), "idle"), 0.0
            if self.state in ("loading", "idle"):
                self.sp.update({"speed_target_mps": 0.0})
            if self.state == "tip":
                self._tip()
            return
        st = self.state
        if st == "to_load":
            if self._follow(self.plan, 6.0):
                self.state, self.phase_t = "loading", 0.0
        elif st == "loading":
            self.sp.update({"speed_target_mps": 0.0})
            if self.fb.get("payload_t", 0) >= 26.5 or self.phase_t > 60:
                self.state, self.phase_t = "haul", 0.0
                self.plan = [list(p) for p in L.route_haul("EX1", "spoil", self.cycles)]
        elif st == "haul":
            if self._follow(self.plan, 7.0, 2.0):
                self.state, self.phase_t = "tip", 0.0
        elif st == "tip":
            if self._tip():
                self.state, self.phase_t = "return", 0.0
                self.plan = [list(p) for p in L.route_return("spoil", self.cycles)] + [list(p) for p in L.route_to_bay("EX1")] + [list(L.NODES["bay1"])]
                self.cycles += 1
        elif st == "return":
            self.sp["body_target_deg"] = 0.0
            if self._follow(self.plan, 7.0):
                self.state, self.phase_t = "loading", 0.0
        else:
            self.state = "to_load"

    def _tip(self):
        self.sp.update({"speed_target_mps": 0.0})
        self.sp["body_target_deg"] = 55.0 if self.phase_t < 9 else 0.0
        return self.phase_t > 13 and self.fb.get("body_angle_deg", 0) < 2

    def _dozer(self, dt):
        t = self.task
        if t.get("do") == "route":
            self.sp["blade_target_m"] = 0.4
            if self._follow(self.plan or [list(p) for p in t.get("route", [])], 2.5):
                self.state = "idle"
                self.sp["speed_target_mps"] = 0.0
            else:
                self.state = "drive"
            return
        lanes, run = t.get("lanes") or [0.0], t.get("run") or [-10.0, 10.0]
        x, y, _ = self.pose()
        lane_y = lanes[self.lane % len(lanes)]
        tx = run[1] if self.dir > 0 else run[0]
        self.state = "spread"
        self.sp.update({"blade_target_m": 0.0, "body_target_deg": 0.0})
        if (self.dir > 0 and x >= run[1] - 0.5) or (self.dir < 0 and x <= run[0] + 0.5):
            self.dir *= -1
            self.lane += 1
            self.cycles += 1
        self.sp.update({"speed_target_mps": 1.4, "heading_target_rad": math.atan2(lane_y - y, tx - x)})

    # ---------- tower crane: pick, hoist, slew and trolley, lower, release

    def _tower_crane(self, dt):
        t = self.task
        bx, by = L.TC1_BASE
        fr, to = t.get("from", list(L.LOCATIONS["laydown"])), t.get("to", list(L.LOCATIONS["core"]))

        def aim(p):
            return math.atan2(p[1] - by, p[0] - bx), max(3.0, min(L.TC1_JIB, math.hypot(p[0] - bx, p[1] - by)))

        clear = 30.0
        fb = self.fb
        carrying = self.sp.get("load_t", 0.0) > 0
        if self.state not in ("to_pick", "lower", "hoist", "to_place"):
            self.state = "to_pick"
        st = self.state
        if st in ("to_pick", "to_place"):
            s, r = aim(to if carrying else fr)
            self.sp.update({"slew_target_rad": s, "radius_target_m": r, "hook_target_m": clear})
            self.sp.setdefault("load_t", 0.0)
            if abs(wrap(s - fb.get("slew_rad", 9))) < 0.03 and abs(r - fb.get("radius_m", 0)) < 0.5 and fb.get("hook_height_m", 0) > clear - 2:
                self.state, self.phase_t = "lower", 0.0
        elif st == "lower":
            self.sp["hook_target_m"] = 2.0
            if fb.get("hook_height_m", 99) < 2.5:
                # slung at the pick, released at the place
                self.sp["load_t"] = 0.0 if carrying else float(t.get("tonnes", 2.4))
                self.state, self.phase_t = "hoist", 0.0
        elif st == "hoist":
            self.sp["hook_target_m"] = clear
            if fb.get("hook_height_m", 0) > clear - 1:
                if carrying:
                    self.state = "to_place"
                else:
                    self.cycles += 1
                    if t.get("cycle"):
                        t["from"], t["to"] = to, fr
                    self.state = "to_pick"
                self.phase_t = 0.0

    # ---------- state out

    def _tstat(self):
        return J.encode(F.TSTAT1.pgn, {"state": F.TASK_CODE.get(self.state, 0), "cycles": self.cycles % 65536, "task_seq": self.task_seq,
                                       "progress_pct": min(100.0, self.phase_t * 10)})

    def run(self):
        self.node.run(self.tick, 100.0)
