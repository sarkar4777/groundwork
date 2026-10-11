"""The bff's side of the industrial PCs: read through the SDK, hand changes to the twin, measure a stop honestly."""

import asyncio

from gwbff.ipc import Ipc, flatten


class FakeTelemetry:
    def __init__(self):
        self.commands = []
        self.timing = {}
        self.frame_calls = []

    async def node(self, group, node, device=None):
        if node != "ipc-ex1":
            raise RuntimeError("not found")
        return {"online": True, "metrics": [{"name": "Bus/Load_pct", "value": 16.0, "ts": 1}],
                "devices": [{"device": "safety", "metrics": [{"name": "Safety/Holding", "value": False, "ts": 1},
                                                             {"name": "Latency/HoldStop_ms", "value": 1.0, "ts": 1}]},
                            {"device": "", "metrics": []}]}

    async def frames(self, group, node, limit=200, since=None):
        self.frame_calls.append((node, limit, since))
        return [{"t": (since or 1000) + 5, "id": 1, "data": "00", "dlc": 1}]

    async def health(self):
        return {"publish_to_store_ms": {"p50": 2.5, "p99": 50.0}}

    async def command(self, group, node, device, signal, value, reason, *, dry_run=False):
        self.commands.append((group, node, device, signal, value, reason))
        return {"published": True, **self.timing}

    async def stream(self, **kw):
        await asyncio.sleep(3600)
        yield "ping", {}


class FakeForge:
    def __init__(self):
        self.telemetry = FakeTelemetry()


def test_flatten_prefixes_devices():
    doc = {"metrics": [{"name": "Bus/Load_pct", "value": 1, "ts": 5}],
           "devices": [{"device": "swing", "metrics": [{"name": "Kinematics/Swing_rad", "value": 0.2, "ts": 6}]}]}
    assert flatten(doc) == {"Bus/Load_pct": [1, 5], "swing/Kinematics/Swing_rad": [0.2, 6]}


def test_take_hands_over_changes_once_and_gives_back_on_failure():
    async def go():
        ipc = Ipc(FakeForge(), nodes=("ipc-ex1", "ipc-tc1"))
        assert await ipc.start()
        dev, fr = ipc.take()
        assert dev["ipc-ex1"]["online"] is True and "safety/Safety/Holding" in dev["ipc-ex1"]["m"]
        assert "ipc-tc1" not in dev
        assert ipc.take()[0] == {}
        ipc.give_back(dev, fr)
        assert "safety/Safety/Holding" in ipc.take()[0]["ipc-ex1"]["m"]
        ipc._metrics("ipc-ex1", "swing", [{"name": "Kinematics/Swing_rad", "value": 0.3, "ts": 9}])
        assert ipc.take()[0]["ipc-ex1"]["m"] == {"swing/Kinematics/Swing_rad": [0.3, 9]}
        ipc.stop()
    asyncio.run(go())


def test_stop_time_adds_every_measured_hop():
    async def go():
        ipc = Ipc(FakeForge(), nodes=("ipc-ex1",))
        await ipc.start()
        cmd = {"machine": "EX1", "node": "ipc-ex1", "device": "safety", "signal": "Safety/Hold", "value": True, "kind": "hold", "reason": "test"}
        await ipc.send([cmd], {"EX1": {"kind": "safety_stop", "ms": 4.5}})
        assert ipc.forge.telemetry.commands[0][3] == "Safety/Hold"
        ipc.watch[0]["api_ms"] = 12.0
        for ms in (20.0, 8.0, 30.0):
            ipc.rtt_ms.add(ms)
        # a stale stop time repeated by NDATA before our command reached the PC does not count
        ipc._metrics("ipc-ex1", "", [{"name": "Latency/HoldStop_ms", "value": 999.0, "ts": 40}])
        ipc._metrics("ipc-ex1", "", [{"name": "Latency/SiteToGateway_ms", "value": 1.5, "ts": 50},
                                     {"name": "Latency/HoldAck_ms", "value": 6.5, "ts": 50}, {"name": "Latency/Commands", "value": 1, "ts": 50}])
        assert not ipc.stops
        ipc._metrics("ipc-ex1", "safety", [{"name": "Safety/Holding", "value": True, "ts": 60}])
        ipc._metrics("ipc-ex1", "", [{"name": "Latency/HoldStop_ms", "value": 200.0, "ts": 61}, {"name": "Latency/Stops", "value": 1, "ts": 61}])
        assert len(ipc.stops) == 1
        s = ipc.stops[0]
        # half the quickest round trip, then Abenix's own stamp to the PC, then the PC's stop
        assert s["stop_ms"] == 4.5 + 4.0 + 1.5 + 200.0
        assert s["confirm_ms"] is not None and [h["ms"] for h in s["hops"]] == [4.5, 4.0, 1.5, 200.0] and s["hold_ack_ms"] == 6.5
        ipc.stop()
    asyncio.run(go())


def test_fault_deck_sends_node_commands():
    async def go():
        ipc = Ipc(FakeForge(), nodes=("ipc-ex1",))
        await ipc.fault("unplug_pc", "ipc-ex1", 9)
        await ipc.fault("noisy_harness", "ipc-ex1", 6)
        sent = ipc.forge.telemetry.commands
        assert sent[0][2:5] == ("", "Node Control/Unplug_s", 9.0) and sent[1][2:5] == ("", "Bus/InjectNoise_s", 6.0)
    asyncio.run(go())


def test_a_machine_already_still_reports_the_hold_in_force():
    async def go():
        ipc = Ipc(FakeForge(), nodes=("ipc-ex1",))
        await ipc.start()
        cmd = {"machine": "EX1", "node": "ipc-ex1", "device": "safety", "signal": "Safety/Hold", "value": True, "kind": "hold", "reason": "test"}
        await ipc.send([cmd], {"EX1": {"kind": "safety_stop", "ms": 4.0}})
        ipc.rtt_ms.add(10.0)
        ipc._metrics("ipc-ex1", "", [{"name": "Latency/HoldStop_ms", "value": 214.7, "ts": 49}, {"name": "Latency/SiteToGateway_ms", "value": 2.0, "ts": 50},
                                     {"name": "Latency/HoldAck_ms", "value": 6.0, "ts": 50}, {"name": "Latency/Commands", "value": 1, "ts": 50}])
        ipc._metrics("ipc-ex1", "safety", [{"name": "Safety/Holding", "value": True, "ts": 60}])
        ipc.watch[0]["t0"] -= 5
        ipc.expire()
        s = ipc.stops[0]
        assert not s["moving"] and s["stop_ms"] == 4.0 + 5.0 + 2.0 + 6.0 and s["hops"][-1]["hop"].startswith("Hold in force")
        ipc.stop()
    asyncio.run(go())


def test_split_timings_give_abenix_checks_and_the_broker_hop_their_own_lines():
    async def go():
        ipc = Ipc(FakeForge(), nodes=("ipc-ex1",))
        await ipc.start()
        ipc.forge.telemetry.timing = {"received_at": 1000, "checks_ms": 2.5, "published_at": 1002.5}
        cmd = {"machine": "EX1", "node": "ipc-ex1", "device": "safety", "signal": "Safety/Hold", "value": True, "kind": "hold", "reason": "test"}
        await ipc.send([cmd], {"EX1": {"kind": "safety_stop", "ms": 4.0}})
        ipc.rtt_ms.add(6.0)
        ipc._metrics("ipc-ex1", "", [{"name": "Latency/SiteToGateway_ms", "value": 1.0, "ts": 50}, {"name": "Latency/HoldAck_ms", "value": 6.0, "ts": 50},
                                     {"name": "Latency/Commands", "value": 1, "ts": 50}])
        ipc._metrics("ipc-ex1", "safety", [{"name": "Safety/Holding", "value": True, "ts": 60}])
        ipc._metrics("ipc-ex1", "", [{"name": "Latency/HoldStop_ms", "value": 150.0, "ts": 61}, {"name": "Latency/Stops", "value": 1, "ts": 61}])
        s = ipc.stops[0]
        assert [h["hop"] for h in s["hops"]] == ["Twin decides", "bff to Abenix", "Abenix checks", "Abenix publish to the PC", "PC to standstill"]
        assert s["stop_ms"] == 4.0 + 3.0 + 2.5 + 1.0 + 150.0
        ipc.stop()
    asyncio.run(go())


def test_frame_polls_ask_only_for_what_is_new():
    async def go():
        ipc = Ipc(FakeForge(), nodes=("ipc-ex1",))
        await ipc.start()
        for _ in range(40):
            if len(ipc.forge.telemetry.frame_calls) >= 2:
                break
            await asyncio.sleep(0.05)
        ipc.stop()
        calls = ipc.forge.telemetry.frame_calls
        assert calls[0] == ("ipc-ex1", 50, None) and calls[1] == ("ipc-ex1", 50, 1005)
    asyncio.run(go())
