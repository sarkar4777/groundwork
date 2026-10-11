"""A CAN bus in user space: the copper and the controllers' timing, bit-timed at 250 kbit/s.

Every ECU container on a machine connects here over the socketcand protocol (linux-can/socketcand, rawmode), the
same protocol a real socketcand daemon serves next to a real bus. The emulator is not a relay:

- frames wait in each controller's transmit queue until the bus is idle;
- when several are waiting, arbitration gives the bus to the lowest identifier, the rest lose and retry;
- a frame occupies the bus for its real bit count (stuff bits and CRC included) at the bit rate, one at a time;
- a frame nobody acknowledges is an error; injected noise corrupts frames into error frames;
- transmit and receive error counters run per controller, error active to error passive to bus off and back;
- every frame and error frame goes into a rolling candump -L log.

    python -m canbus            serves localhost:29536 (socketcand) and localhost:29537 (stats and control)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import statistics
import time
from collections import deque
from logging.handlers import RotatingFileHandler

from .wire import ERROR_FRAME_BITS, frame_bits

BITRATE = int(os.environ.get("CAN_BITRATE", "250000"))
CHANNEL = os.environ.get("CAN_CHANNEL", "vcan0")
HOST = os.environ.get("CANBUS_LISTEN", "127.0.0.1")
PORT = int(os.environ.get("CANBUS_PORT", "29536"))
CTL_PORT = int(os.environ.get("CANBUS_CONTROL_PORT", "29537"))
LOG_PATH = os.environ.get("CANDUMP_LOG", f"/var/log/candump/{os.environ.get('GW_NODE', 'bus')}.log")
CAN_ERR_FLAG = 0x20000000
BUS_OFF_RECOVERY_BITS = 128 * 11


def ctl_state(tec: int, rec: int, off: bool) -> str:
    if off:
        return "bus-off"
    if tec > 127 or rec > 127:
        return "error-passive"
    return "error-active"


class Controller:
    """One socketcand client: a CAN controller with its transmit queue and error counters."""

    n = 0

    def __init__(self, writer: asyncio.StreamWriter):
        Controller.n += 1
        self.id = Controller.n
        self.w = writer
        self.q: deque = deque()
        self.tec = 0
        self.rec = 0
        self.off_until = 0.0
        self.sa = None
        self.tx = 0
        self.rx = 0
        self.lost = 0
        self.raw = False
        self.peer = str(writer.get_extra_info("peername"))

    @property
    def bus_off(self) -> bool:
        return self.off_until > 0

    @property
    def state(self) -> str:
        return ctl_state(self.tec, self.rec, self.bus_off)


class Bus:
    def __init__(self):
        self.ctl: dict[int, Controller] = {}
        self.vt = 0.0
        self.out: deque = deque()
        self.busy: deque = deque()          # (end, seconds busy) for the last second
        self.frames: deque = deque()        # end times, for frames per second
        self.queue_lat: deque = deque(maxlen=2000)
        self.stats = {"frames": 0, "error_frames": 0, "ack_errors": 0, "arbitration_lost": 0, "bits": 0, "stuff_bits": 0}
        self.noise_p = 0.0
        self.noise_until = 0.0
        self.log = self._open_log()
        self.wake = asyncio.Event()

    def _open_log(self):
        try:
            os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
            lg = logging.getLogger("candump")
            h = RotatingFileHandler(LOG_PATH, maxBytes=40_000_000, backupCount=1)
            h.setFormatter(logging.Formatter("%(message)s"))
            lg.addHandler(h)
            lg.setLevel(logging.INFO)
            lg.propagate = False
            return lg
        except OSError:
            return None

    def _dump(self, ts: float, cid: int, data: bytes) -> None:
        if self.log:
            self.log.info(f"({ts:.6f}) {CHANNEL} {cid:08X}#{data.hex().upper()}")

    # ---------- the wire

    async def run(self) -> None:
        """The wire runs on its own clock. Each frame starts when the bus goes idle, occupies it for its bit time,
        and only frames already waiting at that instant take part in arbitration. Delivery to the controllers
        follows the wire clock to within a millisecond, which is as fine as the host's timers go."""
        self.vt = time.monotonic()
        while True:
            now = time.monotonic()
            if self.vt < now - 0.002:
                # an idle bus does not bank time
                self.vt = now - 0.002
            sent = 0
            while self.vt <= now and sent < 64:
                for c in self.ctl.values():
                    if c.bus_off and self.vt >= c.off_until:
                        c.off_until = 0.0
                        c.tec = c.rec = 0
                waiting = [c for c in self.ctl.values() if c.q and not c.bus_off and c.q[0][2] <= self.vt]
                if not waiting:
                    nxt = min((c.q[0][2] for c in self.ctl.values() if c.q and not c.bus_off), default=None)
                    if nxt is None or nxt > now:
                        break
                    self.vt = nxt
                    continue
                self._transmit(waiting, time.time() - time.monotonic())
                sent += 1
            self._deliver(time.monotonic())
            delay = max(0.0005, min(0.05, self.vt - time.monotonic()))
            if not any(c.q for c in self.ctl.values()) and not self.out:
                self.wake.clear()
                try:
                    await asyncio.wait_for(self.wake.wait(), 0.05)
                except asyncio.TimeoutError:
                    pass
            else:
                await asyncio.sleep(delay)
            self._deliver(time.monotonic())

    def _transmit(self, waiting: list, offset: float) -> None:
        # arbitration: every waiting controller starts its identifier, the lowest one keeps the bus
        winner = min(waiting, key=lambda c: c.q[0][0])
        for c in waiting:
            if c is not winner:
                c.lost += 1
                self.stats["arbitration_lost"] += 1
        cid, data, queued = winner.q[0]
        bits, stuff = frame_bits(cid, data)
        start = self.vt
        receivers = [c for c in self.ctl.values() if c is not winner and not c.bus_off and c.raw]
        noisy = start < self.noise_until and random.random() < self.noise_p
        if noisy or not receivers:
            # a corrupted frame or a missing acknowledgement ends in an error frame and a retry
            err_at = random.randint(20, bits - 12) if noisy else bits - 10
            seconds = (err_at + ERROR_FRAME_BITS) / BITRATE
            self.vt = start + seconds
            self._account(start, seconds)
            self.stats["error_frames"] += 1
            if not noisy:
                self.stats["ack_errors"] += 1
            # ISO 11898-1: an error-passive transmitter does not count up on an acknowledgement error
            if noisy or winner.state != "error-passive":
                winner.tec += 8
            if noisy:
                for c in receivers:
                    c.rec = min(255, c.rec + 1)
            if winner.tec > 255:
                winner.off_until = self.vt + BUS_OFF_RECOVERY_BITS / BITRATE + 0.05
                winner.q.clear()
            self._dump(self.vt + offset, CAN_ERR_FLAG | (0x08 if noisy else 0x20),
                       bytes((0, 0, 0x08 if noisy else 0x80, 0, 0, 0, winner.tec & 0xFF, winner.rec & 0xFF)))
            return
        winner.q.popleft()
        seconds = bits / BITRATE
        self.vt = start + seconds
        self._account(start, seconds)
        self.stats["frames"] += 1
        self.stats["bits"] += bits
        self.stats["stuff_bits"] += stuff
        winner.tx += 1
        winner.tec = max(0, winner.tec - 1)
        end = self.vt + offset
        self.queue_lat.append((self.vt - queued) * 1000)
        self.frames.append(self.vt)
        line = f"< frame {cid:08X} {end:.6f} {data.hex().upper()} >".encode()
        # the receivers have the frame once its last bit is on the wire
        self.out.append((self.vt, line, receivers, end, cid, data))

    def _deliver(self, now: float) -> None:
        while self.out and self.out[0][0] <= now:
            _, line, receivers, end, cid, data = self.out.popleft()
            for c in receivers:
                c.rec = max(0, c.rec - 1)
                c.rx += 1
                try:
                    c.w.write(line)
                except (ConnectionError, RuntimeError):
                    pass
            self._dump(end, cid, data)

    def _account(self, start: float, seconds: float) -> None:
        self.busy.append((start, seconds))

    def snapshot(self) -> dict:
        now = time.monotonic()
        while self.busy and now - self.busy[0][0] > 1.0:
            self.busy.popleft()
        while self.frames and now - self.frames[0] > 1.0:
            self.frames.popleft()
        lat = list(self.queue_lat)
        worst = "error-active"
        for c in self.ctl.values():
            if c.state == "bus-off" or (c.state == "error-passive" and worst == "error-active"):
                worst = c.state
        return {
            "bitrate": BITRATE, "channel": CHANNEL, "load_pct": round(100 * sum(s for _, s in self.busy), 2),
            "frames_per_s": len(self.frames), "state": worst, "noise_p": self.noise_p if now < self.noise_until else 0.0,
            "queue_ms_p50": round(statistics.median(lat), 3) if lat else None,
            "queue_ms_p99": round(sorted(lat)[int(len(lat) * 0.99) - 1], 3) if len(lat) > 10 else None,
            **self.stats,
            "controllers": [{"id": c.id, "sa": c.sa, "tec": c.tec, "rec": c.rec, "state": c.state, "tx": c.tx, "rx": c.rx,
                             "arbitration_lost": c.lost, "queued": len(c.q)} for c in self.ctl.values()],
        }

    # ---------- socketcand, rawmode

    async def client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        c = Controller(writer)
        writer.write(b"< hi >")
        await writer.drain()
        buf = ""
        try:
            while True:
                chunk = await reader.read(4096)
                if not chunk:
                    break
                buf += chunk.decode("ascii", "replace")
                while True:
                    s, e = buf.find("<"), buf.find(">")
                    if s < 0 or e < 0:
                        break
                    cmd = buf[s + 1:e].split()
                    buf = buf[e + 1:]
                    await self._command(c, cmd)
        except (ConnectionError, asyncio.IncompleteReadError):
            pass
        finally:
            self.ctl.pop(c.id, None)
            writer.close()

    async def _command(self, c: Controller, cmd: list) -> None:
        if not cmd:
            return
        op = cmd[0]
        if op == "open":
            c.w.write(b"< ok >" if len(cmd) > 1 and cmd[1] == CHANNEL else b"< error unknown channel >")
        elif op == "rawmode":
            c.w.write(b"< ok >")
            await c.w.drain()
            # the client reads the reply on its own before it starts parsing frames
            await asyncio.sleep(0.05)
            c.raw = True
            self.ctl[c.id] = c
        elif op == "send" and len(cmd) >= 3:
            cid = int(cmd[1], 16) & 0x1FFFFFFF
            dlc = int(cmd[2], 16)
            data = bytes(int(x, 16) for x in cmd[3:3 + dlc])
            c.sa = cid & 0xFF
            if c.bus_off:
                return
            # a controller's transmit buffer holds frames in order, like a socketcan qdisc in front of the chip
            if len(c.q) < 256:
                c.q.append((cid, data, time.monotonic()))
                self.wake.set()
        elif op == "echo":
            c.w.write(b"< echo >")

    # ---------- stats and control, one JSON object per line

    async def control(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            while True:
                line = await reader.readline()
                if not line:
                    break
                try:
                    req = json.loads(line)
                except ValueError:
                    req = {"cmd": "stats"}
                if req.get("cmd") == "noise":
                    self.noise_p = max(0.0, min(1.0, float(req.get("p", 0.4))))
                    self.noise_until = time.monotonic() + float(req.get("seconds", 5))
                writer.write((json.dumps(self.snapshot()) + "\n").encode())
                await writer.drain()
        except ConnectionError:
            pass
        finally:
            writer.close()


async def main() -> None:
    bus = Bus()
    srv = await asyncio.start_server(bus.client, HOST, PORT)
    ctl = await asyncio.start_server(bus.control, HOST, CTL_PORT)
    print(f"[canbus] {CHANNEL} at {BITRATE // 1000} kbit/s, socketcand on {HOST}:{PORT}, control on {HOST}:{CTL_PORT}, log {LOG_PATH}", flush=True)
    async with srv, ctl:
        await asyncio.gather(bus.run(), srv.serve_forever(), ctl.serve_forever())


if __name__ == "__main__":
    asyncio.run(main())
