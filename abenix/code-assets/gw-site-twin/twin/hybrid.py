"""Machines that run on industrial PCs. Their state comes from Abenix telemetry, the rest of the site stays simulated.

The bff hands the twin what Abenix holds for each PC: the metrics that changed (devices) and the raw CAN frames
Abenix kept (ipc_frames). The twin puts those machines where their own controllers drove them, runs the site's
safety rules over the combined site, and answers with commands for the PCs: a hold from the Simplex switch, the
mode, and the task from the plan. Without devices in a step nothing here runs, so a simulated site is unchanged.
"""

from __future__ import annotations

import json
import math

from . import j1939 as J
from . import layout as L
from . import terrain as T

DT = 0.01
NODES = {"ipc-ex1": "EX1", "ipc-tc1": "TC1", "ipc-ht1": "HT1", "ipc-dz1": "DZ1"}
GROUP = "groundwork"

# the PC's devices as ECU codes on the site's trace
ECU_CODE = {"engine": "ENG", "hydraulics": "HYD", "swing": "SWG", "telematics": "TEL", "safety": "SPLC", "transmission": "TRN",
            "payload": "PAY", "blade": "BLD", "slew": "SLW", "hoist": "HOIST", "lmi": "LMI", "controller": "CTL", "gateway": "GW"}
ROLE_BY_SA = {v: k for k, v in J.SA.items()}

# the twin's truck phases for the PC controller's task states
TRUCK_PHASE = {"to_load": "to_queue", "queue": "queue", "loading": "loading", "haul": "haul", "tip": "dump", "return": "return",
               "held": "queue", "idle": "queue", "drive": "haul"}
CRITICAL = {(639, 9), (970, 31)}
HOLD_RETRY_S = 2.0
NODE_KEYS = ("Properties/Site", "Bus/Load_pct", "Bus/FramesPerSecond", "Bus/State", "Bus/ErrorFrames", "Bus/NoiseInjected", "Bus/TPSessions",
             "Bus/AddressClaims", "Bus/AckErrors", "Uplink/MessagesPerSecond")
KEEP = {
    "telematics": ("GNSS/X_m", "GNSS/Y_m", "GNSS/Heading_rad", "GNSS/Speed_mps", "GNSS/Fix", "Task/State", "Task/Cycles", "Task/Assign",
                   "Controller/Address"),
    "engine": ("Engine/Speed_rpm", "Engine/Coolant_C", "Engine/OilTemp_C", "Engine/FuelRate_lph", "Engine/Torque_pct", "Engine/Hours_h"),
    "hydraulics": ("Hydraulics/Pump1Pressure_bar", "Hydraulics/Pump2Pressure_bar", "Hydraulics/BoomPressure_bar", "Hydraulics/OilTemp_C",
                   "Hydraulics/Flow_pct"),
    "swing": ("Kinematics/Swing_rad", "Kinematics/Boom_rad", "Kinematics/Stick_rad", "Kinematics/Bucket_rad"),
    "payload": ("Kinematics/Body_deg", "Payload/Load_t"),
    "blade": ("Kinematics/Blade_m", "Blade/Load_pct"),
    "slew": ("Kinematics/Slew_rad", "Kinematics/Luff_rad", "Kinematics/Radius_m", "Slew/Rate_rads"),
    "hoist": ("Kinematics/Hook_m", "Hoist/Load_t"),
    "lmi": ("LMI/Moment_pct", "LMI/Chart_t"),
    "safety": ("Safety/Mode", "Safety/Holding", "Safety/Hold", "Mode/Set", "Safety/Rule"),
}
JOINTS = ("swing", "boom", "stick", "bucket")


def wanted(key: str) -> bool:
    dev, _, name = key.partition("/")
    if dev in KEEP:
        return name in KEEP[dev] or name in ("Diagnostics/DTCs", "ECU/Address", "ECU/TEC", "ECU/ErrorState")
    return key in NODE_KEYS or key.startswith("Latency/")


def active(st) -> bool:
    return bool(st.get("ipc"))


def is_ipc(st, mid) -> bool:
    ip = st.get("ipc")
    return bool(ip) and mid in ip


def _new(node):
    return {"node": node, "online": None, "v": {}, "since": 0.0, "clock": 0, "cycles": None, "last_load": 0.0,
            "cmd": {"hold": None, "mode": None, "task": "auto", "hold_at": -99.0, "mode_at": -99.0, "mode_ext": False}, "dtc_seen": [], "rates_at": 0}


def _val(ip, key, default=None):
    x = ip["v"].get(key)
    return default if x is None else x[0]


def _ts(ip, key):
    x = ip["v"].get(key)
    return 0 if x is None else int(x[1] or 0)


def _num(ip, key, default=0.0):
    v = _val(ip, key)
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _dtcs(text) -> list:
    out = []
    for part in str(text or "").split(";"):
        w = part.split()
        if len(w) >= 4 and w[0] == "SPN" and w[2] == "FMI":
            try:
                out.append([int(w[1]), int(w[3]), int(w[5]) if len(w) >= 6 else 1])
            except ValueError:
                continue
    return out


# ---------- inputs

def apply(st, devices: dict, ev: list, d) -> None:
    """Fold what changed on each PC into the machines it drives."""
    ips = st.setdefault("ipc", {})
    for node, dv in (devices or {}).items():
        mid = NODES.get(node)
        m = st["machines"].get(mid)
        if m is None or not isinstance(dv, dict):
            continue
        if mid in st.get("ipc_refused", ()):
            continue
        site = (dv.get("m") or {}).get("Properties/Site")
        if site and site[0] and site[0] != st.get("layout", "northgate"):
            # a PC laid out for another site would drive its machine through the wrong ground
            if mid not in st.setdefault("ipc_refused", []):
                st["ipc_refused"].append(mid)
                ev.append({"kind": "fault", "machine": mid, "title": f"{mid}'s PC is set up for {site[0]}",
                           "detail": f"The twin runs {st.get('layout', 'northgate')}, so {mid} stays simulated. Set GW_SITE on the PCs to match"})
            continue
        ip = ips.get(mid)
        if ip is None:
            ip = ips[mid] = _new(node)
            ev.append({"kind": "story", "machine": mid, "title": f"{mid} runs on its industrial PC",
                       "detail": f"{node}: real J1939 bus, Sparkplug B over MQTT into Abenix. The twin follows it and sends it commands"})
        prev_j = {k: (_num(ip, f"swing/Kinematics/{k.title()}_rad"), _ts(ip, f"swing/Kinematics/{k.title()}_rad")) for k in JOINTS}
        for k, x in (dv.get("m") or {}).items():
            if wanted(k) and isinstance(x, (list, tuple)) and len(x) == 2:
                ip["v"][k] = [x[0], x[1]]
                ip["clock"] = max(ip["clock"], int(x[1] or 0))
        online = dv.get("online")
        if online is not None and bool(online) != ip["online"]:
            if ip["online"] is not None:
                if online:
                    ev.append({"kind": "plan_change", "machine": mid, "title": f"{mid}'s PC back online",
                               "detail": f"NBIRTH from {node}. Abenix has it live again and the twin hands the machine back its task"})
                else:
                    ev.append({"kind": "fault", "machine": mid, "title": f"{mid}'s PC offline",
                               "detail": f"NDEATH for {node} from the broker. The site routes around {mid}, its own safety PLC holds it when the uplink goes"})
            ip["online"] = bool(online)
            ip["since"] = st["t"]
        _pose(st, m, ip, prev_j)
        _cycles(st, m, ip, ev, d)
        _diagnostics(st, m, ip, ev)


def _pose(st, m, ip, prev_j):
    kind = m["kind"]
    if "telematics/GNSS/X_m" in ip["v"]:
        m["x"] = _num(ip, "telematics/GNSS/X_m", m["x"])
        m["y"] = _num(ip, "telematics/GNSS/Y_m", m["y"])
    if "telematics/GNSS/Heading_rad" in ip["v"] and kind != "tower_crane":
        m["heading"] = _num(ip, "telematics/GNSS/Heading_rad", m["heading"])
    m["speed"] = _num(ip, "telematics/GNSS/Speed_mps", 0.0) if kind != "tower_crane" else 0.0
    m["gnss"]["fix"] = int(_num(ip, "telematics/GNSS/Fix", 4))
    s = m["sig"]
    for key, sig in (("engine/Engine/Speed_rpm", "rpm"), ("engine/Engine/Coolant_C", "coolant"), ("engine/Engine/OilTemp_C", "oil_t"),
                     ("engine/Engine/FuelRate_lph", "fuel_rate"), ("engine/Engine/Torque_pct", "torque"), ("engine/Engine/Hours_h", "hours")):
        if key in ip["v"]:
            s[sig] = _num(ip, key, s.get(sig, 0.0))
    state = str(_val(ip, "telematics/Task/State", "") or "")
    if kind == "excavator":
        for key, sig in (("hydraulics/Hydraulics/Pump1Pressure_bar", "p1"), ("hydraulics/Hydraulics/Pump2Pressure_bar", "p2"),
                         ("hydraulics/Hydraulics/BoomPressure_bar", "boom_head"), ("hydraulics/Hydraulics/OilTemp_C", "hyd_t"),
                         ("hydraulics/Hydraulics/Flow_pct", "flow")):
            if key in ip["v"]:
                s[sig] = _num(ip, key, s.get(sig, 0.0))
        clock = ip["clock"]
        for k in JOINTS:
            key = f"swing/Kinematics/{k.title()}_rad"
            if key not in ip["v"]:
                continue
            v, ts = _num(ip, key), _ts(ip, key)
            pv, pts = prev_j[k]
            if pts and ts > pts:
                m["joints_rate"][k] = (v - pv) / max(0.02, (ts - pts) / 1000.0)
            elif clock - ts > 250:
                # nothing new for a quarter second: the joint is still
                m["joints_rate"][k] = 0.0
            m["joints"][k] = v
            m["joints_target"][k] = v
        m["phase"] = state or m.get("phase", "dig")
    elif kind == "haul_truck":
        m["body_deg"] = _num(ip, "payload/Kinematics/Body_deg", m.get("body_deg", 0.0))
        m["load_t"] = _num(ip, "payload/Payload/Load_t", m.get("load_t", 0.0))
        if m["load_t"] > 1.0:
            ip["last_load"] = m["load_t"]
        m["phase"] = TRUCK_PHASE.get(state, m.get("phase", "haul"))
        m["assign"] = {"ex": "EX1", "dest": "spoil"}
    elif kind == "dozer":
        m["blade_m"] = _num(ip, "blade/Kinematics/Blade_m", m.get("blade_m", 0.2))
        s["blade_load"] = _num(ip, "blade/Blade/Load_pct", 0.0) / 100.0
        m["dir"] = 1 if math.cos(m["heading"]) >= 0 else -1
    elif kind == "tower_crane":
        m["slew"] = _num(ip, "slew/Kinematics/Slew_rad", m["slew"])
        m["luff"] = _num(ip, "slew/Kinematics/Luff_rad", m["luff"])
        m["radius"] = _num(ip, "slew/Kinematics/Radius_m", m["radius"])
        m["slew_rate"] = _num(ip, "slew/Slew/Rate_rads", 0.0)
        m["slew_target"], m["luff_target"] = m["slew"], m["luff"]
        m["hook_z"] = _num(ip, "hoist/Kinematics/Hook_m", m["hook_z"])
        m["hook_target"] = m["hook_z"]
        m["load_t"] = _num(ip, "hoist/Hoist/Load_t", m.get("load_t", 0.0))
        m["lmi_pct"] = _num(ip, "lmi/LMI/Moment_pct", m.get("lmi_pct", 0.0))
        m["chart_t"] = _num(ip, "lmi/LMI/Chart_t", m.get("chart_t", 0.0))
        m["phase"] = state or "idle"
    m["task"] = _task_text(m, ip, state)


def _task_text(m, ip, state):
    if ip["online"] is False:
        return "PC offline, held by its safety PLC"
    if _val(ip, "safety/Safety/Holding") is True:
        return f"held by its safety PLC, {state or 'idle'}"
    return (state or "idle").replace("_", " ")


def _cycles(st, m, ip, ev, d):
    c = _val(ip, "telematics/Task/Cycles")
    if c is None:
        return
    c = int(c)
    last = ip["cycles"]
    ip["cycles"] = c
    if last is None or c <= last:
        return
    for _ in range(min(3, c - last)):
        _one_cycle(st, m, ip, ev, d)


def _one_cycle(st, m, ip, ev, d):
    from . import world as W
    kind = m["kind"]
    if kind == "excavator":
        # one bucket from the face, into the simulated truck under the PC's bucket if there is one
        centre = m.get("dig_centre", L.EX1_DIG)
        cands = [centre + da for da in (-0.3, -0.1, 0.1, 0.3)]
        got = 0.0
        for k in range(12):
            c = m.get("dig_cursor", 0) + k
            a = cands[c % len(cands)]
            r = (6.5, 7.8, 9.0)[(c // len(cands)) % 3]
            got = T.cut(d, m["x"] + r * math.cos(a), m["y"] + r * math.sin(a), W.BUCKET_M3)
            if got > 0.2:
                m["dig_cursor"] = c + 1
                break
        truck = next((t for t in st["machines"].values() if t["kind"] == "haul_truck" and not is_ipc(st, t["id"])
                      and t.get("phase") == "loading" and (t.get("assign") or {}).get("ex") == m["id"]), None)
        if truck is not None and got > 0:
            truck["load_t"] = round(truck["load_t"] + got * W.SOIL_T_PER_M3, 2)
            truck["buckets"] = truck.get("buckets", 0) + 1
            st["m3_moved"] += got
            m["load_t"] = round(got * W.SOIL_T_PER_M3, 2)
        elif got > 0:
            a = centre + 0.7
            T.fill(d, m["x"] + 7 * math.cos(a), m["y"] + 7 * math.sin(a), got, 0)
        st["terrain_dirty"] = True
    elif kind == "haul_truck":
        st["cycles"] += 1
        p = L.DUMP_POINTS[(ip["cycles"] or 0) % len(L.DUMP_POINTS)]
        if ip["last_load"] > 0:
            T.fill(d, p[0], p[1], ip["last_load"] / W.SOIL_T_PER_M3 * 1.2, 1)
            st["terrain_dirty"] = True
        ip["last_load"] = 0.0
    elif kind == "tower_crane":
        q = st["lift_queue"].get(m["id"]) or []
        if q:
            lift = q[0]
            item = (lift.get("params") or {}).get("item", lift.get("label", "load"))
            st["lift_progress"][lift["id"]] = "success"
            m["lifts_done"] = m.get("lifts_done", 0) + 1
            st["lift_queue"][m["id"]] = q[1:]
            ev.append({"kind": "plan_change", "machine": m["id"], "title": f"Lift done, {item}",
                       "detail": f"{lift['id']} landed by TC1's own controller on its PC"})


def _diagnostics(st, m, ip, ev):
    dtcs = []
    for k, x in ip["v"].items():
        if k.endswith("/Diagnostics/DTCs"):
            for dd in _dtcs(x[0]):
                if dd not in dtcs:
                    dtcs.append(dd)
    seen = ip["dtc_seen"]
    for dd in dtcs:
        if [dd[0], dd[1]] not in seen:
            seen.append([dd[0], dd[1]])
            crit = (dd[0], dd[1]) in CRITICAL
            ev.append({"kind": "fault", "machine": m["id"], "title": f"DM1 on {m['id']}'s PC: SPN {dd[0]} FMI {dd[1]}",
                       "detail": f"From the real bus, through Sparkplug into Abenix. {J.SPN_TEXT.get(dd[0], 'SPN ' + str(dd[0]))}, "
                                 f"{J.FMI_TEXT.get(dd[1], 'FMI ' + str(dd[1]))}", "spn": dd[0], "fmi": dd[1],
                       **({"route": "fault_triage"} if crit else {})})
    ip["dtc_seen"] = [s for s in seen if any(s == [dd[0], dd[1]] for dd in dtcs)]
    # the twin's own link faults stay, the rest is what the PC reports
    m["dtcs"] = dtcs + [x for x in m["dtcs"] if x[0] in (584,) and x not in dtcs]


# ---------- per tick

def tick(st, m, d, ev):
    """What the twin still does for a machine on a PC: watch the link, keep the site's wind, level the spoil."""
    ip = st["ipc"][m["id"]]
    can = m["can"]
    if ip["online"] is False:
        can["silent_s"] += DT
    else:
        can["silent_s"] = 0.0
    g = m["gnss"]
    g["lost_s"] = g["lost_s"] + DT if g["fix"] == 0 else 0.0
    if m["kind"] == "tower_crane":
        m["wind_ms"] = round(st["weather"]["wind"] * 1.25 + st["weather"]["gust"] * 1.3, 2)
    elif m["kind"] == "dozer" and st["tick"] % 50 == 0 and abs(m.get("speed", 0.0)) > 0.3 and ip["online"]:
        if T.level(d, m["x"] + 3 * math.cos(m["heading"]), m["y"] + 3 * math.sin(m["heading"]), 2.0, 0.08):
            st["terrain_dirty"] = True
    from . import vecu as V
    if ip["online"] is False:
        m["health"] = "fault"
    else:
        m["health"] = "fault" if any((x[0], x[1]) in V.CRITICAL_DTCS or (x[0], x[1]) in CRITICAL for x in m["dtcs"]) else ("warn" if m["dtcs"] else "ok")


# ---------- faults on the PCs, sent as commands through Abenix like any other

WEAR_CODE = 4


def takes_fault(st, f) -> bool:
    k, tgt = f.get("kind"), f.get("target")
    if k == "drive_off_road":
        return is_ipc(st, tgt or "HT1")
    return k == "hydraulic_wear" and is_ipc(st, tgt or "")


def fault(st, f, ev) -> None:
    k = f.get("kind")
    ips = st.get("ipc") or {}
    if k == "hydraulic_wear":
        mid = f["target"]
        ips[mid].setdefault("queue", []).append({"device": "safety", "signal": "Diagnostics/InjectFault", "value": WEAR_CODE, "kind": "fault",
                                                 "reason": "Fault deck: a main pump losing efficiency"})
        ips[mid]["wear"] = True
        ev.append({"kind": "story", "machine": mid, "title": f"{mid}'s main pump starts to wear",
                   "detail": "Fault deck, through Abenix: the pump works harder for the same flow, pressure and oil temperature creep up"})
    elif k == "drive_off_road":
        mid = f.get("target") or "HT1"
        m = st["machines"][mid]
        # out of the pit along its own road first, then the wrong turn off it
        ax, ay = min((L.NODES[n] for n in ("ramp_top", "j1")), key=lambda q: math.hypot(q[0] - m["x"], q[1] - m["y"]))
        tx, ty = off_road(ax, ay)
        task = {"do": "route", "route": [[round(m["x"], 1), round(m["y"], 1)], [ax, ay], [tx, ty]], "then": "stop"}
        ips[mid].setdefault("queue", []).append({"device": "telematics", "signal": "Task/Assign", "value": json.dumps(task), "kind": "task",
                                                 "reason": "Fault deck: the driver takes a wrong turn off the haul road"})
        ips[mid]["cmd"]["task"] = "off_road"
        ips[mid]["cmd"]["task_at"] = st["t"]
        ev.append({"kind": "story", "machine": mid, "title": f"{mid} turns off the haul road",
                   "detail": f"Fault deck, through Abenix: a route to ({tx:.0f}, {ty:.0f}), outside the haul area"})
    elif k == "clear":
        for mid, ip in ips.items():
            if ip.pop("wear", False):
                ip.setdefault("queue", []).append({"device": "safety", "signal": "Diagnostics/InjectFault", "value": 0, "kind": "fault",
                                                   "reason": "Fault deck: pump wear cleared"})


def off_road(x, y) -> tuple:
    """The nearest open ground 30 m away that is outside HT1's haul area and every site zone."""
    poly = corridor()
    zones = [z["polygon"] for z in L.site()["zones"] if "polygon" in z]
    best = None
    for i in range(16):
        a = i * math.pi / 8
        for r in (30.0, 40.0, 50.0):
            tx, ty = x + r * math.cos(a), y + r * math.sin(a)
            if abs(tx) > 90 or abs(ty) > 90 or inside(poly, tx, ty) or any(inside(z, tx, ty) for z in zones):
                continue
            # a wrong turn, not a drive through a fenced zone
            if any(inside(z, x + (tx - x) * k / 10, y + (ty - y) * k / 10) for z in zones for k in range(1, 10)):
                continue
            if best is None or r < best[0]:
                best = (r, round(tx, 1), round(ty, 1))
            break
    return (best[1], best[2]) if best else (round(x + 30, 1), round(y, 1))


# ---------- outputs

def commands(st, ev) -> list:
    """Edge-triggered commands for the PCs, resent when the PC does not report it took one."""
    out = []
    for mid, ip in (st.get("ipc") or {}).items():
        m = st["machines"][mid]
        if not ip["online"]:
            continue
        cmd = ip["cmd"]
        node = ip["node"]
        for q in ip.pop("queue", []):
            out.append({"machine": mid, "node": node, **q})
        reported_hold = _val(ip, "safety/Safety/Hold")
        if cmd["hold"] is None:
            cmd["hold"] = bool(reported_hold) if reported_hold is not None else False
        want = m["mode"] in ("hold", "offline")
        stale = reported_hold is not None and bool(reported_hold) != cmd["hold"] and st["t"] - cmd["hold_at"] > HOLD_RETRY_S
        if want != cmd["hold"] or stale:
            cmd["hold"] = want
            cmd["hold_at"] = st["t"]
            rule = m["simplex"].get("rule") or m["safety"].get("rule") or m["mode"]
            out.append({"machine": mid, "node": node, "device": "safety", "signal": "Safety/Hold", "value": want, "kind": "hold",
                        "reason": (f"Site safety rule {rule}: hold {mid}" if want else f"{mid} clear to move, released by the site")[:200]})
        mode = "safe" if m["mode"] == "fallback" else "auto"
        reported_mode = _val(ip, "safety/Mode/Set")
        if cmd["mode"] is None:
            cmd["mode"] = str(reported_mode or "auto")
            cmd["mode_ext"] = cmd["mode"] != "auto"
        sent = [v for v, at in cmd.get("mode_sent", []) if st["t"] - at < 30.0]
        if reported_mode is not None and reported_mode in sent:
            pass
        elif reported_mode is not None and reported_mode != cmd["mode"] and st["t"] - cmd.get("mode_at", -99.0) > 3.0:
            # someone else set it, an agent through Abenix or a person: from now it is theirs
            cmd["mode"] = str(reported_mode)
            cmd["mode_ext"] = True
            ev.append({"kind": "plan_change", "machine": mid, "title": f"{mid} mode {cmd['mode']}, set outside the site",
                       "detail": "Mode/Set came through Abenix from an agent or a person. The site leaves it, and only asks for safe again on a new stop"})
        # the site speaks when its own reason changes, never to undo someone else's choice, and never releases their safe
        want_changed = mode != cmd.get("want")
        cmd["want"] = mode
        ours = not cmd.get("mode_ext")
        if want_changed and mode != cmd["mode"] and (ours or mode == "safe"):
            cmd["mode"] = mode
            cmd["mode_ext"] = False
            cmd["mode_at"] = st["t"]
            # what the site itself sent lately, so a late echo of it is never taken for someone else's
            cmd["mode_sent"] = [[v, at] for v, at in cmd.get("mode_sent", []) if st["t"] - at < 30.0] + [[mode, st["t"]]]
            why = m["simplex"].get("rule") or ("the AI is unavailable" if not st["ai_available"] else "a stop waits for a person")
            reason = f"Site on its fallback plan, {why}" if mode == "safe" else "Site back in auto"
            out.append({"machine": mid, "node": node, "device": "safety", "signal": "Mode/Set", "value": mode, "kind": "mode", "reason": reason})
            ev.append({"kind": "plan_change", "machine": mid, "title": f"{mid} Mode/Set {mode}, from the site", "detail": reason})
        task = st["tasks"].get(mid) or {}
        tdo = "hold" if task.get("do") == "hold" else "auto"
        if cmd["task"] == "off_road":
            # the wrong turn stands until an agent or a person sends HT1 another task
            sent = str(_val(ip, "telematics/Task/Assign", "") or "")
            if st["t"] - cmd.get("task_at", 0.0) < 5.0 or '"route"' in sent or not sent:
                continue
            cmd["task"] = "hold" if '"hold"' in sent else "auto"
            ev.append({"kind": "plan_change", "machine": mid, "title": f"{mid} has a new task from outside the site",
                       "detail": f"Task/Assign {sent[:80]} came through Abenix"})
            continue
        if tdo != cmd["task"]:
            cmd["task"] = tdo
            out.append({"machine": mid, "node": node, "device": "telematics", "signal": "Task/Assign", "value": json.dumps({"do": tdo}),
                        "kind": "task", "reason": f"Plan v{st['plan']['version']}: {tdo} for {mid}"})
    return out


def _decode(pgn, data, da):
    if pgn == J.DM1.pgn:
        lamps, dtcs = J.decode_dm1(data)
        return {"lamps": lamps, "dtcs": [{"spn": x.spn, "fmi": x.fmi, "oc": x.oc, "spn_text": J.SPN_TEXT.get(x.spn, ""),
                                          "fmi_text": J.FMI_TEXT.get(x.fmi, "")} for x in dtcs]}
    if pgn == J.TP_CM.pgn and data:
        ctl = {16: "RTS", 17: "CTS", 19: "EOMA", 32: "BAM", 255: "Abort"}.get(data[0], data[0])
        inner = data[5] | (data[6] << 8) | (data[7] << 16) if len(data) >= 8 else None
        out = {"control": ctl, "pgn": inner}
        if data[0] in (16, 32, 19):
            out["bytes"] = data[1] | (data[2] << 8)
            out["packets"] = data[3]
        return out
    if pgn == J.TP_DT.pgn and data:
        return {"packet": data[0]}
    if pgn == J.REQUEST:
        return {"requested": data[0] | (data[1] << 8) | (data[2] << 16)} if len(data) >= 3 else {}
    if pgn == J.ACKM and len(data) >= 8:
        return {"control": {0: "ACK", 1: "NACK"}.get(data[0], data[0]), "function": data[1],
                "pgn": data[5] | (data[6] << 8) | (data[7] << 16)}
    if pgn == J.ADDRESS_CLAIMED:
        return {"name": bytes(reversed(data)).hex().upper()}
    if pgn == J.PROP_A and data:
        code = data[0]
        if code == J.CMD_HOLD:
            return {"cmd": "hold", "hold": data[1] & 1, "id": data[2] | (data[3] << 8)}
        if code == J.CMD_MODE:
            return {"cmd": "mode", "mode": J.MODES.get(data[1], data[1])}
        if code == J.CMD_FAULT:
            return {"cmd": "fault", "code": data[1]}
        if code == J.CMD_TASK:
            return {"cmd": "task"}
        return {"cmd": code}
    p = J.PGNS.get(pgn)
    if p is not None and p.spns:
        return {k: v for k, v in J.decode(pgn, data).items() if v is not None}
    return {}


INTERESTING = (J.TP_CM.pgn, J.ACKM, J.PROP_A, J.ADDRESS_CLAIMED, J.REQUEST)


def bus_frames(st, ipc_frames: dict, budget: int) -> tuple[list, int]:
    """Raw frames Abenix kept for each PC, decoded with the same J1939 dictionary the vECUs use."""
    out, total = [], 0
    picked = []
    for node, frames in (ipc_frames or {}).items():
        mid = NODES.get(node)
        ip = (st.get("ipc") or {}).get(mid)
        if ip is None:
            continue
        sa_role = dict(ROLE_BY_SA)
        for k, x in ip["v"].items():
            if k.endswith("/ECU/Address") or k == "telematics/Controller/Address":
                try:
                    sa_role[int(x[0])] = "controller" if k.startswith("telematics/Controller") else k.split("/", 1)[0]
                except (TypeError, ValueError):
                    pass
        seen = set()
        for f in frames or []:
            total += 1
            try:
                cid = int(f["id"]) & 0x1FFFFFFF
                data = bytes.fromhex(str(f.get("data", "")))
            except (KeyError, TypeError, ValueError):
                continue
            pri, pgn, sa, da = J.parse_can_id(cid)
            key = (pgn, sa)
            if key in seen:
                continue
            seen.add(key)
            p = J.PGNS.get(pgn)
            role = sa_role.get(sa, "")
            fr = {"type": "bus", "t": round(st["t"], 3), "machine": mid, "ecu": ECU_CODE.get(role, f"SA{sa:02X}"), "pgn": pgn, "sa": sa,
                  "can_id": f"{cid:08X}", "data": data.hex(), "name": p.name if p else f"PGN {pgn}", "acronym": p.acronym if p else "",
                  "proto": "j1939", "decoded": _decode(pgn, data, da), "source": "ipc", "node": node, "bus_ms": f.get("t")}
            if da != 0xFF and pgn < 0xF000:
                fr["da"] = da
            hot = pgn in INTERESTING or (pgn == J.DM1.pgn and fr["decoded"].get("dtcs"))
            picked.append((0 if hot else 1, len(picked), fr))
    picked.sort(key=lambda x: (x[0], x[1]))
    out = [x[2] for x in picked[:budget]]
    return out, total


def frame_extra(st, fr: dict) -> None:
    """Tag each PC's machine and add the PCs' own numbers to the frame."""
    ips = st.get("ipc") or {}
    for mm in fr["machines"]:
        ip = ips.get(mm["id"])
        if ip is None:
            mm["src"] = "sim"
            continue
        mm["src"] = "ipc"
        mm["node"] = ip["node"]
        mm["online"] = bool(ip["online"])
        if _val(ip, "safety/Safety/Holding") is True and mm["mode"] in ("auto", "fallback"):
            mm["mode"] = "hold"
        elif _val(ip, "safety/Safety/Mode") == "safe" and mm["mode"] in ("auto", "fallback"):
            mm["mode"] = "safe"
        if ip["online"] is False:
            mm["mode"] = "offline"
    out = {}
    for mid, ip in ips.items():
        lat = {k.split("/", 1)[1]: x[0] for k, x in ip["v"].items() if k.startswith("Latency/") and x[0] is not None}
        tec = [int(_num(ip, k)) for k in ip["v"] if k.endswith("/ECU/TEC")]
        passive = sum(1 for k, x in ip["v"].items() if k.endswith("/ECU/ErrorState") and x[0] != "error-active")
        out[mid] = {"node": ip["node"], "online": bool(ip["online"]), "since": round(ip["since"], 2),
                    "holding": bool(_val(ip, "safety/Safety/Holding", False)), "mode": _val(ip, "safety/Safety/Mode", ""),
                    "bus_load_pct": _val(ip, "Bus/Load_pct"), "fps": _val(ip, "Bus/FramesPerSecond"), "bus_state": _val(ip, "Bus/State"),
                    "error_frames": _val(ip, "Bus/ErrorFrames"), "noise": _val(ip, "Bus/NoiseInjected"), "uplink_mps": _val(ip, "Uplink/MessagesPerSecond"),
                    "task": _val(ip, "telematics/Task/State", ""), "cycles": ip["cycles"], "lat": lat,
                    "mode_set": _val(ip, "safety/Mode/Set"), "mode_by": "outside" if ip["cmd"].get("mode_ext") else "site",
                    "tec_max": max(tec) if tec else None, "ecus_passive": passive,
                    "oil_c": _val(ip, "hydraulics/Hydraulics/OilTemp_C"), "pump1_bar": _val(ip, "hydraulics/Hydraulics/Pump1Pressure_bar")}
    fr["ipc"] = out


# ---------- HT1's haul area, for the rule that sees it leave and the fault that drives it off

ROAD_M = 10.0          # either side of the road, a loaded truck cuts the corners
PAD_M = 18.0           # the turning pad round the loading bay
SPOIL_M = 8.0          # round the spoil area, trucks swing wide to tip
CELL_M = 1.0


def _segd(x, y, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0.0, min(1.0, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy or 1.0)))
    return math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)


def _simplify(pts, tol):
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    i, d = max(((k, _segd(pts[k][0], pts[k][1], a, b)) for k in range(1, len(pts) - 1)), key=lambda x: x[1])
    if d <= tol:
        return [a, b]
    return _simplify(pts[:i + 1], tol)[:-1] + _simplify(pts[i:], tol)


def corridor() -> list:
    """The ground HT1 works on, as one polygon in site metres: the road from its bay up the ramp to the spoil area,
    with the turning pad at the bay and the spoil area's margin, traced on a 1 m grid."""
    path = [list(L.NODES[n]) for n in ("bay1", "ramp_bot", "ramp_top", "j1", "spoil_in")]
    bay = path[0]
    spoil = next(z["polygon"] for z in L.site()["zones"] if z["kind"] == "spoil")
    sx0, sx1 = min(p[0] for p in spoil) - SPOIL_M, max(p[0] for p in spoil) + SPOIL_M
    sy0, sy1 = min(p[1] for p in spoil) - SPOIL_M, max(p[1] for p in spoil) + SPOIL_M

    def on(x, y):
        if sx0 <= x <= sx1 and sy0 <= y <= sy1:
            return True
        if math.hypot(x - bay[0], y - bay[1]) <= PAD_M:
            return True
        return any(_segd(x, y, path[i], path[i + 1]) <= ROAD_M for i in range(len(path) - 1))

    xs = [p[0] for p in path] + [sx0, sx1, bay[0] - PAD_M, bay[0] + PAD_M]
    ys = [p[1] for p in path] + [sy0, sy1, bay[1] - PAD_M, bay[1] + PAD_M]
    x0, y0 = math.floor(min(xs) - ROAD_M - 2), math.floor(min(ys) - ROAD_M - 2)
    nx, ny = int(math.ceil(max(xs) + ROAD_M + 2 - x0)), int(math.ceil(max(ys) + ROAD_M + 2 - y0))
    grid = [[on(x0 + (i + 0.5) * CELL_M, y0 + (j + 0.5) * CELL_M) for i in range(nx)] for j in range(ny)]
    cell = lambda i, j: 0 <= i < nx and 0 <= j < ny and grid[j][i]  # noqa: E731
    # walk the outline along cell edges, keeping the filled cells on the left
    start = next((i, j) for j in range(ny) for i in range(nx) if grid[j][i])
    corner = (start[0], start[1])
    d = (1, 0)
    ring = []
    pos = corner
    for _ in range(4 * nx * ny):
        ring.append(pos)
        x, y = pos
        left = {(1, 0): (x, y), (0, 1): (x - 1, y), (-1, 0): (x - 1, y - 1), (0, -1): (x, y - 1)}[d]
        right = {(1, 0): (x, y - 1), (0, 1): (x, y), (-1, 0): (x - 1, y), (0, -1): (x - 1, y - 1)}[d]
        if cell(*right):
            d = (d[1], -d[0])
        elif not cell(*left):
            d = (-d[1], d[0])
        pos = (pos[0] + d[0], pos[1] + d[1])
        if pos == corner and len(ring) > 3:
            break
    pts = [[round(x0 + x * CELL_M, 2), round(y0 + y * CELL_M, 2)] for x, y in ring]
    poly = _simplify(pts + [pts[0]], 0.8)[:-1]
    return poly if _area(poly) > 0 else poly[::-1]


def _area(poly):
    return sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly))) / 2


def inside(poly, x, y) -> bool:
    c = False
    for i in range(len(poly)):
        (ax, ay), (bx, by) = poly[i], poly[i - 1]
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            c = not c
    return c
