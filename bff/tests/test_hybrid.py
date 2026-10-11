"""The hybrid twin: machines on industrial PCs follow Abenix telemetry, the site's rules command them back."""

import json

from twin import j1939 as J
from twin.api import run


def _ex1(ts, swing=0.0, online=True, cycles=10, holding=False, hold=False, extra=None):
    m = {
        "Properties/Site": ["northgate", 1],
        "telematics/GNSS/X_m": [-6.0, ts], "telematics/GNSS/Y_m": [-14.0, ts], "telematics/GNSS/Heading_rad": [-0.56, ts],
        "telematics/GNSS/Speed_mps": [0.0, ts], "telematics/GNSS/Fix": [4, ts], "telematics/Task/State": ["dig", ts],
        "telematics/Task/Cycles": [cycles, ts],
        "swing/Kinematics/Swing_rad": [swing, ts], "swing/Kinematics/Boom_rad": [0.2, ts], "swing/Kinematics/Stick_rad": [0.5, ts],
        "swing/Kinematics/Bucket_rad": [0.4, ts], "safety/Safety/Holding": [holding, ts], "safety/Safety/Hold": [hold, ts],
        "safety/Mode/Set": ["auto", ts], "Bus/Load_pct": [16.5, ts], "Latency/HoldStop_ms": [206.0, ts],
        "engine/Diagnostics/DTCs": ["none", ts],
    }
    m.update(extra or {})
    return {"ipc-ex1": {"online": online, "m": m}}


def _init(rules):
    z = run({"op": "init", "seed": 2026})["state_z"]
    o = run({"op": "step", "state_z": z, "ticks": 5, "rules": rules})
    return o["state_z"]


def _step(z, **kw):
    o = run({"op": "step", "state_z": z, "ticks": 5, **kw})
    return o, o["state_z"]


def test_without_devices_nothing_changes(rules):
    z = _init(rules)
    o, _ = _step(z)
    assert "commands" not in o
    assert "ipc" not in o["frame"]
    assert all("src" not in m for m in o["frame"]["machines"])


def test_pc_drives_its_machine_and_is_tagged(rules):
    z = _init(rules)
    o, z = _step(z, devices=_ex1(1000, swing=0.3))
    ex = next(m for m in o["frame"]["machines"] if m["id"] == "EX1")
    assert ex["src"] == "ipc" and ex["node"] == "ipc-ex1" and ex["online"]
    assert abs(ex["joints"]["swing"] - 0.3) < 1e-6 and ex["x"] == -6.0
    assert next(m for m in o["frame"]["machines"] if m["id"] == "EX2")["src"] == "sim"
    assert o["frame"]["ipc"]["EX1"]["bus_load_pct"] == 16.5
    assert any(e["title"] == "EX1 runs on its industrial PC" for e in o["events"])
    # the joint rate comes from successive readings, the rules read it as tip speed
    o, z = _step(z, devices={"ipc-ex1": {"online": True, "m": {"swing/Kinematics/Swing_rad": [0.4, 1100], "safety/Safety/Holding": [False, 1100]}}})
    st = run({"op": "step", "state_z": z, "ticks": 1, "raw_state": True})["state"]
    assert abs(st["machines"]["EX1"]["joints_rate"]["swing"] - 1.0) < 1e-6


def test_worker_in_swing_sends_one_hold_then_a_release(rules):
    z = _init(rules)
    _, z = _step(z, devices=_ex1(1000))
    _, z = _step(z, faults=[{"kind": "worker_in_swing", "target": "EX1", "worker": "W07", "start_m": 17.5, "speed": 1.6}])
    holds = []
    ts = 1000
    for k in range(400):
        ts += 50
        # the swing keeps moving on the PC until it holds
        o, z = _step(z, devices={"ipc-ex1": {"online": True, "m": {"swing/Kinematics/Swing_rad": [0.02 * k, ts]}}})
        holds += [c for c in o.get("commands") or [] if c["signal"] == "Safety/Hold"]
        if holds:
            break
    assert holds and holds[0]["value"] is True and holds[0]["node"] == "ipc-ex1" and holds[0]["device"] == "safety"
    assert "worker_in_swing" in holds[0]["reason"]
    assert any(e["kind"] == "safety_stop" and e["machine"] == "EX1" for e in o["events"])
    # edge triggered: the PC reports the hold, nothing more is sent
    o, z = _step(z, devices={"ipc-ex1": {"online": True, "m": {"safety/Safety/Hold": [True, ts + 10], "safety/Safety/Holding": [True, ts + 10]}}})
    assert not [c for c in o.get("commands") or [] if c["signal"] == "Safety/Hold"]
    o, z = _step(z, clear_simplex=["EX1"], cleared_by="test")
    rel = []
    for _ in range(400):
        o, z = _step(z)
        rel += [c for c in o.get("commands") or [] if c["signal"] == "Safety/Hold"]
        if rel:
            break
    assert rel and rel[0]["value"] is False


def test_unplugged_pc_goes_offline_and_gets_no_commands(rules):
    z = _init(rules)
    _, z = _step(z, devices=_ex1(1000))
    o, z = _step(z, devices={"ipc-ex1": {"online": False, "m": {}}})
    assert any(e["title"] == "EX1's PC offline" for e in o["events"])
    for _ in range(60):
        o, z = _step(z, faults=[{"kind": "worker_in_swing", "target": "EX1"}] if _ == 0 else None)
        assert not o.get("commands")
    ex = next(m for m in o["frame"]["machines"] if m["id"] == "EX1")
    assert ex["mode"] == "offline" and not ex["online"] and ex["health"] == "fault"
    o, z = _step(z, devices={"ipc-ex1": {"online": True, "m": {}}})
    assert any(e["title"] == "EX1's PC back online" for e in o["events"])


def test_crane_cycles_land_lifts(rules):
    z = _init(rules)
    tc = {"Properties/Site": ["northgate", 1], "telematics/Task/Cycles": [5, 1], "slew/Kinematics/Slew_rad": [1.0, 1],
          "slew/Kinematics/Radius_m": [30.0, 1], "slew/Kinematics/Luff_rad": [1.0, 1], "lmi/LMI/Moment_pct": [31.0, 1]}
    _, z = _step(z, devices={"ipc-tc1": {"online": True, "m": tc}})
    st = run({"op": "step", "state_z": z, "ticks": 1, "raw_state": True})["state"]
    q0 = len(st["lift_queue"]["TC1"])
    o, z = _step(z, devices={"ipc-tc1": {"online": True, "m": {"telematics/Task/Cycles": [6, 2]}}})
    assert any(e["title"].startswith("Lift done") for e in o["events"]) == (q0 > 0)
    tcf = next(c for c in o["frame"]["cranes"] if c["id"] == "TC1")
    assert abs(tcf["slew"] - 1.0) < 1e-6 and abs(tcf["radius"] - 30.0) < 1e-6


def test_real_frames_decode_with_the_twin_dictionary(rules):
    z = _init(rules)
    _, z = _step(z, devices=_ex1(1000))
    swb = J.encode(J.SWB1.pgn, {"swing_rad": 0.25, "boom_rad": 0.1, "stick_rad": 0.5, "bucket_rad": 0.4})
    hold = bytes((J.CMD_HOLD, 1, 7, 0, 0xFF, 0xFF, 0xFF, 0xFF))
    frames = [
        {"t": 2000, "id": J.can_id(3, J.SWB1.pgn, 0x81), "data": swb.hex(), "dlc": 8},
        {"t": 2001, "id": J.can_id(1, J.PROP_A, 0xF9, 0x82), "data": hold.hex(), "dlc": 8},
        {"t": 2002, "id": J.can_id(3, J.SWB1.pgn, 0x81), "data": swb.hex(), "dlc": 8},
    ]
    o, _ = _step(z, ipc_frames={"ipc-ex1": frames}, devices={"ipc-ex1": {"online": True, "m": {"swing/ECU/Address": [0x81, 1]}}})
    real = [b for b in o["bus"] if b.get("source") == "ipc"]
    assert len(real) == 2
    # commands sort first, then the rest, one per PGN and source address
    assert real[0]["decoded"] == {"cmd": "hold", "hold": 1, "id": 7} and real[0]["ecu"] == "GW" and real[0]["da"] == 0x82
    assert real[1]["acronym"] == "SWB1" and real[1]["ecu"] == "SWG" and abs(real[1]["decoded"]["swing_rad"] - 0.25) < 1e-3


def test_pc_for_another_site_is_refused(rules):
    z = run({"op": "init", "seed": 2026, "layout": "nh108"})["state_z"]
    o, z = _step(z, rules=rules, devices=_ex1(1000))
    assert any("is set up for northgate" in e["title"] for e in o["events"])
    assert "commands" not in o and all(m.get("src") != "ipc" for m in o["frame"]["machines"])


def test_task_from_the_plan_reaches_the_pc(rules):
    z = _init(rules)
    _, z = _step(z, devices=_ex1(1000))
    st = run({"op": "step", "state_z": z, "ticks": 1, "raw_state": True})["state"]
    st["tasks"]["EX1"] = {"do": "hold"}
    o = run({"op": "step", "state": st, "ticks": 1})
    t = [c for c in o.get("commands") or [] if c["signal"] == "Task/Assign"]
    assert t and json.loads(t[0]["value"]) == {"do": "hold"} and t[0]["device"] == "telematics"


def test_excavator_cycles_cut_the_face(rules):
    z = _init(rules)
    o, z = _step(z, devices=_ex1(1000, cycles=10))
    rev = o["frame"]["terrain"]["rev"]
    for c in (11, 12):
        o, z = _step(z, devices={"ipc-ex1": {"online": True, "m": {"telematics/Task/Cycles": [c, 1000 + c]}}})
    assert o["frame"]["terrain"]["rev"] > rev


def test_mode_set_from_outside_is_left_alone(rules):
    z = _init(rules)
    _, z = _step(z, devices=_ex1(1000))
    o, z = _step(z, devices={"ipc-ex1": {"online": True, "m": {"safety/Mode/Set": ["safe", 1100], "safety/Safety/Mode": ["safe", 1100]}}})
    assert any("set outside the site" in e["title"] for e in o["events"])
    assert next(m for m in o["frame"]["machines"] if m["id"] == "EX1")["mode"] == "safe"
    assert o["frame"]["ipc"]["EX1"]["mode_by"] == "outside"
    for _ in range(20):
        o, z = _step(z)
        assert not [c for c in o.get("commands") or [] if c["signal"] == "Mode/Set"]


def _ht1(ts, x, y, extra=None):
    m = {"Properties/Site": ["northgate", 1], "telematics/GNSS/X_m": [x, ts], "telematics/GNSS/Y_m": [y, ts],
         "telematics/GNSS/Heading_rad": [0.0, ts], "telematics/GNSS/Speed_mps": [5.0, ts], "telematics/Task/State": ["haul", ts],
         "telematics/Task/Cycles": [1, ts]}
    m.update(extra or {})
    return {"ipc-ht1": {"online": True, "m": m}}


def test_drive_off_road_routes_ht1_outside_its_haul_area(rules):
    from twin import hybrid as H
    from twin import layout as L
    L.use("northgate")
    z = _init(rules)
    _, z = _step(z, devices=_ht1(1000, 26.0, -42.0))
    o, z = _step(z, faults=[{"kind": "drive_off_road", "target": "HT1"}])
    c = [x for x in o["commands"] if x["signal"] == "Task/Assign"]
    assert c and c[0]["node"] == "ipc-ht1" and c[0]["device"] == "telematics"
    task = json.loads(c[0]["value"])
    tx, ty = task["route"][-1]
    assert task["do"] == "route" and not H.inside(H.corridor(), tx, ty)
    # the plan does not undo it, an outside task ends it
    for _ in range(3):
        o, z = _step(z)
        assert not [x for x in o.get("commands") or [] if x["signal"] == "Task/Assign"]


def test_pump_wear_goes_to_the_pc_and_clear_takes_it_back(rules):
    z = _init(rules)
    _, z = _step(z, devices=_ex1(1000))
    o, z = _step(z, faults=[{"kind": "hydraulic_wear", "target": "EX1"}])
    assert [x for x in o["commands"] if x["signal"] == "Diagnostics/InjectFault" and x["value"] == 4]
    o, z = _step(z, faults=[{"kind": "clear"}])
    assert [x for x in o["commands"] if x["signal"] == "Diagnostics/InjectFault" and x["value"] == 0]


def test_haul_corridor_holds_every_route_point():
    from twin import hybrid as H
    from twin import layout as L
    L.use("northgate")
    poly = H.corridor()
    pts = L.route_to_bay("EX1") + L.route_haul("EX1", "spoil", 0) + L.route_return("spoil", 0) + [list(p) for p in L.DUMP_POINTS]
    assert all(H.inside(poly, x, y) for x, y in pts)
    assert len(poly) <= 200


def test_an_outside_auto_stands_until_the_site_has_a_new_reason(rules):
    z = _init(rules)
    _, z = _step(z, devices=_ex1(1000))
    st = run({"op": "step", "state_z": z, "ticks": 1, "raw_state": True})["state"]
    # the site is on its fallback for EX1 and has said safe
    st["machines"]["EX1"]["simplex"]["latched"] = True
    o = run({"op": "step", "state": st, "ticks": 5})
    z = o["state_z"]
    assert [c for c in o["commands"] if c["signal"] == "Mode/Set" and c["value"] == "safe"]
    assert any(e["title"] == "EX1 Mode/Set safe, from the site" for e in o["events"])
    # a person sets auto through Abenix: the site leaves it while its reason is the same
    o, z = _step(z, devices={"ipc-ex1": {"online": True, "m": {"safety/Mode/Set": ["safe", 1100]}}})
    for _ in range(8):
        o, z = _step(z, ticks=50)
    o, z = _step(z, devices={"ipc-ex1": {"online": True, "m": {"safety/Mode/Set": ["auto", 1200]}}})
    assert any("set outside the site" in e["title"] for e in o["events"])
    for _ in range(10):
        o, z = _step(z)
        assert not [c for c in o.get("commands") or [] if c["signal"] == "Mode/Set"]
