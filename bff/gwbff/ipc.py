"""The industrial PCs as Abenix holds them. Live values ride the telemetry stream, raw frames come from the frame
ring, commands go back through Abenix. All of it through the SDK, none of it knows how a machine works.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from .lanes import Rolling

log = logging.getLogger("gw.ipc")

GROUP = "groundwork"
NODES = ("ipc-ex1", "ipc-tc1", "ipc-ht1", "ipc-dz1")
FRAME_POLL_S = 0.25
FRAMES_KEPT = 80
# the trace shows a handful per step, and since keeps each poll to what is new
FRAME_LIMIT = 50
ACK_MAX_MS = 10_000
# gateway numbers a stop is measured from, written by the PC after it acts on a hold
STOP_KEYS = ("Latency/HoldStop_ms", "Latency/HoldAck_ms", "Latency/SiteToGateway_ms", "Latency/Commands", "Latency/Stops")


def flatten(doc: dict) -> dict:
    """A node read as {device/metric: [value, ts]}, node metrics without a device prefix."""
    out = {}
    for m in doc.get("metrics") or []:
        out[m["name"]] = [m.get("value"), m.get("ts")]
    for d in doc.get("devices") or []:
        for m in d.get("metrics") or []:
            out[f"{d['device']}/{m['name']}"] = [m.get("value"), m.get("ts")]
    return out


class Ipc:
    def __init__(self, forge, nodes=NODES, group=GROUP):
        self.forge = forge
        self.group = group
        self.nodes = tuple(nodes)
        self.values: dict = {n: {} for n in self.nodes}
        self.dirty: dict = {n: {} for n in self.nodes}
        self.online: dict = {n: None for n in self.nodes}
        self.online_dirty: set = set()
        self.frames: dict = {n: [] for n in self.nodes}
        self.frame_t: dict = {n: None for n in self.nodes}
        self.health: dict = {}
        self.p2s: dict = {}
        self.stream_up = False
        self.status = "starting"
        self.cmd_ms = Rolling(50)
        self.confirm_ms = Rolling(20)
        self.rtt_ms = Rolling(60)
        self.checks_ms = Rolling(50)
        self.sent: list = []
        self.stops: list = []
        self.watch: list = []
        self.tasks: list = []

    # reading

    async def start(self) -> bool:
        """Seed from a full read of each PC. False when none of them is known to Abenix."""
        found = 0
        for n in self.nodes:
            try:
                doc = await self.forge.telemetry.node(self.group, n)
            except Exception as e:  # noqa: BLE001
                log.info("ipc %s not readable: %s", n, e)
                continue
            found += 1
            self._seed(n, doc)
        if not found:
            self.status = "no industrial PCs in Abenix"
            return False
        self.tasks = [asyncio.create_task(self._stream()), asyncio.create_task(self._frames()), asyncio.create_task(self._health())]
        self.status = "running"
        return True

    def stop(self) -> None:
        for t in self.tasks:
            t.cancel()
        self.tasks = []

    def _seed(self, n: str, doc: dict) -> None:
        vals = flatten(doc)
        self.values[n].update(vals)
        self.dirty[n].update(vals)
        self.online[n] = bool(doc.get("online"))
        self.online_dirty.add(n)

    def _metrics(self, n: str, device: str, metrics: list) -> None:
        for m in metrics or []:
            k = f"{device}/{m['name']}" if device else m["name"]
            x = [m.get("value"), m.get("ts")]
            self.values[n][k] = x
            self.dirty[n][k] = x
            if k in STOP_KEYS or k == "safety/Safety/Holding":
                self._check_stops(n, k, x)

    async def _stream(self) -> None:
        backoff = 1.0
        while True:
            try:
                async for event, data in self.forge.telemetry.stream(nodes=[f"{self.group}/{n}" for n in self.nodes]):
                    self.stream_up = True
                    backoff = 1.0
                    if not isinstance(data, dict):
                        continue
                    n = data.get("node")
                    if event == "metrics" and n in self.values:
                        self._metrics(n, data.get("device") or "", data.get("metrics"))
                    elif event == "device" and n in self.values and not data.get("device"):
                        on = bool(data.get("online"))
                        if on != self.online[n]:
                            self.online[n] = on
                            self.online_dirty.add(n)
                            if on:
                                # a rebirth sends every metric again, read them all at once
                                asyncio.create_task(self._reseed(n))
                    elif event == "health":
                        self.health = data
                        if (data.get("publish_to_store_ms") or {}).get("p50") is not None:
                            self.p2s = data["publish_to_store_ms"]
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                log.warning("telemetry stream: %s", e)
            self.stream_up = False
            await asyncio.sleep(backoff)
            backoff = min(10.0, backoff * 2)

    async def _reseed(self, n: str) -> None:
        try:
            self._seed(n, await self.forge.telemetry.node(self.group, n))
        except Exception as e:  # noqa: BLE001
            log.info("ipc reseed %s: %s", n, e)

    async def _frames(self) -> None:
        while True:
            for n in self.nodes:
                if not self.online.get(n):
                    continue
                try:
                    t0 = time.perf_counter()
                    got = await self.forge.telemetry.frames(self.group, n, limit=FRAME_LIMIT, since=self.frame_t[n])
                    self.rtt_ms.add((time.perf_counter() - t0) * 1000)
                except asyncio.CancelledError:
                    raise
                except Exception as e:  # noqa: BLE001
                    log.debug("frames %s: %s", n, e)
                    continue
                if got:
                    self.frame_t[n] = max(int(f.get("t") or 0) for f in got)
                    self.frames[n] = (got + self.frames[n])[:FRAMES_KEPT]
            await asyncio.sleep(FRAME_POLL_S)

    async def _health(self) -> None:
        # the stream carries health every second, this covers the gaps when it reconnects
        while True:
            if not self.stream_up or not self.p2s:
                try:
                    self.health = await self.forge.telemetry.health()
                    if (self.health.get("publish_to_store_ms") or {}).get("p50") is not None:
                        self.p2s = self.health["publish_to_store_ms"]
                except asyncio.CancelledError:
                    raise
                except Exception:  # noqa: BLE001
                    pass
            await asyncio.sleep(2.0)

    def take(self) -> tuple[dict, dict]:
        """What changed since the last step that reached the twin, and the frames Abenix kept since."""
        devices = {}
        for n in self.nodes:
            if self.dirty[n] or n in self.online_dirty:
                devices[n] = {"online": self.online[n], "m": self.dirty[n]}
        frames = {n: f for n, f in self.frames.items() if f}
        self.dirty = {n: {} for n in self.nodes}
        self.online_dirty = set()
        self.frames = {n: [] for n in self.nodes}
        return devices, frames

    def give_back(self, devices: dict, frames: dict) -> None:
        """A step that never reached the twin: its changes go with the next one."""
        for n, d in devices.items():
            for k, x in (d.get("m") or {}).items():
                self.dirty[n].setdefault(k, x)
            self.online_dirty.add(n)
        for n, f in frames.items():
            self.frames[n] = (self.frames.get(n, []) + f)[:FRAMES_KEPT]

    # commanding

    async def send(self, cmds: list, stop_events: dict) -> None:
        for c in cmds:
            t_wall = time.time()
            t0 = time.perf_counter()
            rec = {"machine": c.get("machine"), "node": c["node"], "signal": c["signal"], "value": c["value"], "at": t_wall}
            try:
                r = await self.forge.telemetry.command(self.group, c["node"], c["device"], c["signal"], c["value"], c.get("reason") or "Groundwork site")
                rec["ms"] = round((time.perf_counter() - t0) * 1000, 2)
                if isinstance(r, dict) and r.get("checks_ms") is not None:
                    rec["checks_ms"] = float(r["checks_ms"])
                    self.checks_ms.add(rec["checks_ms"])
                rec["ok"] = True
                self.cmd_ms.add(rec["ms"])
            except Exception as e:  # noqa: BLE001
                rec["ok"] = False
                rec["error"] = str(e)[:200]
                log.warning("command %s %s: %s", c["node"], c["signal"], e)
            self.sent = (self.sent + [rec])[-20:]
            if rec["ok"] and c.get("kind") == "hold" and c["value"] is True:
                ev = stop_events.get(c.get("machine")) or {}
                vals = self.values[c["node"]]
                self.watch.append({"machine": c.get("machine"), "node": c["node"], "t0": t0, "api_ms": rec["ms"], "detect_ms": ev.get("ms"),
                                   "checks_ms": rec.get("checks_ms"),
                                   "commands": self._count(vals, "Latency/Commands"), "stops": self._count(vals, "Latency/Stops"),
                                   "got": {}, "event": ev})

    @staticmethod
    def _count(vals: dict, k: str) -> float:
        try:
            return float((vals.get(k) or [0])[0] or 0)
        except (TypeError, ValueError):
            return 0.0

    def _check_stops(self, n: str, k: str, x: list) -> None:
        vals = self.values[n]
        for w in list(self.watch):
            if w["node"] != n:
                continue
            if k == "safety/Safety/Holding":
                if x[0] is True and "confirm_ms" not in w:
                    w["confirm_ms"] = round((time.perf_counter() - w["t0"]) * 1000, 1)
                    self.confirm_ms.add(w["confirm_ms"])
                continue
            # the PC repeats its latencies every second, only numbers after our command count
            if self._count(vals, "Latency/Commands") > w["commands"]:
                for key in ("Latency/SiteToGateway_ms", "Latency/HoldAck_ms"):
                    if vals.get(key):
                        w["got"][key] = vals[key][0]
            if self._count(vals, "Latency/Stops") > w["stops"] and vals.get("Latency/HoldStop_ms"):
                w["got"]["Latency/HoldStop_ms"] = vals["Latency/HoldStop_ms"][0]
            if "confirm_ms" in w and "Latency/HoldStop_ms" in w["got"] and "Latency/SiteToGateway_ms" in w["got"]:
                self.watch.remove(w)
                self.stops = (self.stops + [self._stop(w)])[-10:]

    def expire(self) -> None:
        # a machine already still when the hold came gives no stop time, its record closes without one
        now = time.perf_counter()
        for w in list(self.watch):
            if now - w["t0"] > 3.0:
                self.watch.remove(w)
                if "confirm_ms" in w:
                    self.stops = (self.stops + [self._stop(w)])[-10:]

    def _stop(self, w: dict) -> dict:
        g = w["got"]
        # the gateway forgets a command after 10 s, an older ACK figure belongs to another command
        if (g.get("Latency/HoldAck_ms") or 0) > ACK_MAX_MS:
            g.pop("Latency/HoldAck_ms")
        detect = float(w.get("detect_ms") or 0.0)
        # Abenix stamps a command on arrival, so the leg before it is half the quickest round trip
        rtt = self.rtt_ms.pct(0.1)
        oneway = round(rtt / 2, 2) if rtt is not None else round(w["api_ms"] / 2, 2)
        still = g.get("Latency/HoldStop_ms")
        # a machine already still when the hold came has no stop time, the hold is in force at the PC's ACK
        last = ("PC to standstill", still) if still is not None else ("Hold in force, ACK on the bus", g.get("Latency/HoldAck_ms"))
        if w.get("checks_ms") is not None:
            # Abenix reports its checks, and stamps the DCMD when it publishes, so the gateway's number is the broker hop alone
            hops = [("Twin decides", detect), ("bff to Abenix", oneway), ("Abenix checks", w["checks_ms"]),
                    ("Abenix publish to the PC", g.get("Latency/SiteToGateway_ms")), last]
        else:
            hops = [("Twin decides", detect), ("bff to Abenix", oneway), ("Abenix to the PC", g.get("Latency/SiteToGateway_ms")), last]
        total = round(sum(float(v or 0) for _, v in hops), 1)
        return {"type": "ipc_stop", "machine": w["machine"], "node": w["node"], "stop_ms": total, "confirm_ms": w.get("confirm_ms"), "moving": still is not None,
                "hops": [{"hop": h, "ms": None if v is None else round(float(v), 2)} for h, v in hops], "hold_ack_ms": g.get("Latency/HoldAck_ms"),
                "api_ms": w["api_ms"], "at": time.time()}

    async def fault(self, kind: str, node: str, seconds: float) -> dict:
        """The fault deck's PC faults are node commands the PC's gateway acts on."""
        signal = {"unplug_pc": "Node Control/Unplug_s", "noisy_harness": "Bus/InjectNoise_s"}[kind]
        reason = {"unplug_pc": f"Fault deck: unplug {node} for {seconds:.0f} s", "noisy_harness": f"Fault deck: noisy harness on {node} for {seconds:.0f} s"}[kind]
        await self.forge.telemetry.command(self.group, node, "", signal, float(seconds), reason)
        return {"ok": True, "node": node, "signal": signal, "seconds": seconds}

    def view(self) -> dict:
        """Abenix-side numbers for the frame: ingest, command and round-trip latency."""
        h = self.health or {}
        p2s = h.get("publish_to_store_ms") or self.p2s or {}
        if p2s.get("p50") is None:
            p2s = self.p2s
        last = self.stops[-1] if self.stops else None
        return {"stream": self.stream_up, "status": self.status, "publish_to_store_p50_ms": p2s.get("p50"), "publish_to_store_p99_ms": p2s.get("p99"),
                "ingest_mps": h.get("messages_per_second"), "seq_gaps": h.get("seq_gaps"), "command_p50_ms": self.cmd_ms.pct(0.5), "checks_p50_ms": self.checks_ms.pct(0.5),
                "bff_to_abenix_ms": round(self.rtt_ms.pct(0.1) / 2, 2) if self.rtt_ms.pct(0.1) is not None else None,
                "confirm_p50_ms": self.confirm_ms.pct(0.5), "last_stop": last, "sent": self.sent[-5:]}
