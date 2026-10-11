"""A small J1939 stack: one per ECU container, on one shared bus.

What it does, after SAE J1939-21 and J1939-81:
- address claim at power-on with a 64-bit NAME, conflict resolution by lowest NAME, re-claim from 128 to 247
  when the ECU is arbitrary-address capable, cannot-claim otherwise;
- answers Request (PGN 59904) for address claimed and for any PGN it serves on request, NACKs the rest when the
  request was addressed to it;
- transport protocol for payloads over 8 bytes: BAM to global, RTS/CTS/EndOfMsgAck to a destination, aborts;
- periodic transmission at each PGN's repetition rate;
- python-can underneath, so the bus is whatever CAN_INTERFACE and CAN_CHANNEL say.
"""

from __future__ import annotations

import os
import random
import time

import can

from .frames import ACKM, ADDRESS_CLAIMED, J, REQUEST

TP_CM, TP_DT = J.TP_CM.pgn, J.TP_DT.pgn
GLOBAL = 0xFF
NULL = 0xFE
BAM, RTS, CTS, EOMA, ABORT = 32, 16, 17, 19, 255


def open_bus() -> can.BusABC:
    """The bus a container talks on, picked by environment:
    - default: the pod's canbus sidecar over the socketcand protocol, CAN_HOST=localhost, CAN_PORT=29536, CAN_CHANNEL=vcan0
    - CAN_HOST pointing at a real socketcand daemon next to a real bus
    - CAN_INTERFACE=socketcan with CAN_CHANNEL=can0 on a PC with a PEAK or Kvaser adapter, or vcan0 on a host that has one
    """
    iface = os.environ.get("CAN_INTERFACE", "socketcand")
    channel = os.environ.get("CAN_CHANNEL", "vcan0")
    if iface == "socketcand":
        host = os.environ.get("CAN_HOST", "localhost")
        port = int(os.environ.get("CAN_PORT", "29536"))
        for attempt in range(60):
            try:
                return can.Bus(interface="socketcand", host=host, port=port, channel=channel)
            except (OSError, TimeoutError, can.CanError):
                time.sleep(0.5)
        raise RuntimeError(f"no socketcand bus at {host}:{port}")
    if iface == "udp_multicast":
        return can.Bus(interface="udp_multicast", channel=os.environ.get("CAN_CHANNEL", "239.74.163.2"), fd=False)
    return can.Bus(interface=iface, channel=channel, bitrate=int(os.environ.get("CAN_BITRATE", "250000")))


def make_name(identity: int, function: int, manufacturer: int = 2047, ecu_instance: int = 0, function_instance: int = 0,
              vehicle_system: int = 0, industry_group: int = 3, arbitrary: bool = True) -> int:
    """J1939-81 NAME. Industry group 3 is construction. Manufacturer 2047 marks a simulated maker."""
    return ((1 if arbitrary else 0) << 63 | (industry_group & 7) << 60 | (0 & 0xF) << 56 | (vehicle_system & 0x7F) << 49
            | (function & 0xFF) << 40 | (function_instance & 0x1F) << 35 | (ecu_instance & 7) << 32
            | (manufacturer & 0x7FF) << 21 | (identity & 0x1FFFFF))


class Node:
    def __init__(self, label: str, name: int, preferred_sa: int):
        self.label = label
        self.name = name
        self.preferred = preferred_sa
        self.sa = NULL
        self.bus = open_bus()
        self.claimed = False
        self.claim_at = 0.0
        self.handlers: dict[int, list] = {}
        self.on_request: dict[int, callable] = {}
        self.periodic: list = []
        self.addresses: dict[int, int] = {}   # sa -> NAME of everyone on the bus
        self.rx_tp: dict = {}
        self.tx_tp: dict = {}
        self.raw_hooks: list = []   # fn(msg, own) for every frame on the wire, ours included
        self.stats = {"tx": 0, "rx": 0, "tp_tx": 0, "tp_rx": 0, "claims": 0, "conflicts": 0}
        self.on(ADDRESS_CLAIMED, self._on_claim)
        self.on(REQUEST, self._on_request)
        self.on(TP_CM, self._on_tp_cm)
        self.on(TP_DT, self._on_tp_dt)
        self.serve(ADDRESS_CLAIMED, lambda requester: self._send_claim())

    # ---------- api

    def on(self, pgn: int, fn) -> None:
        self.handlers.setdefault(pgn, []).append(fn)

    def serve(self, pgn: int, fn) -> None:
        """fn(requester_sa) returns bytes to send for a Request of this PGN, or None."""
        self.on_request[pgn] = fn

    def every(self, pgn: int, period_ms: int, fn, priority: int = 6, phase_ms: float | None = None) -> None:
        """fn() returns bytes or None. The phase spreads ECUs so they do not all speak on the same tick."""
        first = time.monotonic() + (phase_ms if phase_ms is not None else random.uniform(0, period_ms)) / 1000
        self.periodic.append([pgn, period_ms / 1000, fn, priority, first])

    def send(self, pgn: int, data: bytes, priority: int = 6, da: int = GLOBAL) -> None:
        if not self.claimed and pgn not in (ADDRESS_CLAIMED,):
            return
        if len(data) <= 8:
            self._raw(priority, pgn, data, da)
        elif da == GLOBAL:
            self._start_bam(pgn, data, priority)
        else:
            self._start_rts(pgn, data, priority, da)

    def request(self, pgn: int, da: int = GLOBAL) -> None:
        self._raw(6, REQUEST, bytes((pgn & 0xFF, (pgn >> 8) & 0xFF, (pgn >> 16) & 0xFF)), da)

    def ack(self, control: int, group_fn: int, pgn: int, to_sa: int) -> None:
        data = bytes((control, group_fn & 0xFF, 0xFF, 0xFF, to_sa & 0xFF, pgn & 0xFF, (pgn >> 8) & 0xFF, (pgn >> 16) & 0xFF))
        self._raw(6, ACKM, data, GLOBAL)

    def find(self, function: int) -> int | None:
        """The current address of the ECU with this NAME function, as learnt from address claims."""
        for sa, name in self.addresses.items():
            if (name >> 40) & 0xFF == function:
                return sa
        return None

    def run(self, tick=None, hz: float = 200.0) -> None:
        self.start_claim()
        dt = 1.0 / hz
        last = time.monotonic()
        while True:
            now = time.monotonic()
            self._drain(now)
            if not self.claimed and self.sa != NULL and now >= self.claim_at:
                self.claimed = True
                self.stats["claims"] += 1
            if tick:
                tick(now - last if now > last else dt, now)
            last = now
            if self.claimed:
                for p in self.periodic:
                    if now >= p[4]:
                        data = p[2]()
                        if data is not None:
                            self.send(p[0], data, p[3])
                        p[4] += p[1]
                        if p[4] < now:
                            p[4] = now + p[1]
            self._pump_tp(now)
            time.sleep(max(0.0, dt - (time.monotonic() - now)))

    # ---------- address claim

    def start_claim(self, sa: int | None = None) -> None:
        self.sa = self.preferred if sa is None else sa
        self.claimed = False
        self._send_claim()
        # J1939-81: wait 250 ms for a contending claim before using the address
        self.claim_at = time.monotonic() + 0.25

    def _send_claim(self) -> None:
        self._raw(6, ADDRESS_CLAIMED, self.name.to_bytes(8, "little"), GLOBAL, force_sa=self.sa)

    def _on_claim(self, sa: int, da: int, data: bytes, ts: float) -> None:
        other = int.from_bytes(data[:8], "little")
        if sa == NULL:
            return
        for k in [k for k, v in self.addresses.items() if v == other]:
            del self.addresses[k]
        self.addresses[sa] = other
        if sa != self.sa or other == self.name:
            return
        self.stats["conflicts"] += 1
        if self.name < other:
            # we win, say so again
            self._send_claim()
            return
        if (self.name >> 63) & 1:
            taken = set(self.addresses) | {self.sa}
            free = [a for a in range(128, 248) if a not in taken]
            if free:
                self.start_claim(free[0])
                return
        # cannot claim: announce from the null address and stay quiet
        self.sa = NULL
        self.claimed = False
        self._raw(6, ADDRESS_CLAIMED, self.name.to_bytes(8, "little"), GLOBAL, force_sa=NULL)

    # ---------- request

    def _on_request(self, sa: int, da: int, data: bytes, ts: float) -> None:
        if da not in (GLOBAL, self.sa) or len(data) < 3:
            return
        pgn = data[0] | (data[1] << 8) | (data[2] << 16)
        fn = self.on_request.get(pgn)
        if fn is None:
            if da == self.sa:
                self.ack(1, 0xFF, pgn, sa)
            return
        out = fn(sa)
        if out is None:
            if da == self.sa:
                self.ack(3, 0xFF, pgn, sa)
            return
        if pgn == ADDRESS_CLAIMED:
            return
        self.send(pgn, out, 6, sa if (da == self.sa and len(out) > 8) else GLOBAL)

    # ---------- transport protocol

    def _start_bam(self, pgn: int, data: bytes, priority: int) -> None:
        n = (len(data) + 6) // 7
        cm = bytes((BAM, len(data) & 0xFF, len(data) >> 8, n, 0xFF, pgn & 0xFF, (pgn >> 8) & 0xFF, (pgn >> 16) & 0xFF))
        self._raw(7, TP_CM, cm, GLOBAL)
        # J1939-21: 50 to 200 ms between BAM data packets
        self.tx_tp[("bam", pgn)] = {"kind": "bam", "pgn": pgn, "data": data, "n": n, "next": 1, "at": time.monotonic() + 0.05}
        self.stats["tp_tx"] += 1

    def _start_rts(self, pgn: int, data: bytes, priority: int, da: int) -> None:
        n = (len(data) + 6) // 7
        cm = bytes((RTS, len(data) & 0xFF, len(data) >> 8, n, 0xFF, pgn & 0xFF, (pgn >> 8) & 0xFF, (pgn >> 16) & 0xFF))
        self._raw(7, TP_CM, cm, da)
        self.tx_tp[("rts", da)] = {"kind": "rts", "pgn": pgn, "data": data, "n": n, "next": 1, "allowed": 0, "da": da,
                                   "at": time.monotonic(), "timeout": time.monotonic() + 1.25, "state": "wait_cts"}
        self.stats["tp_tx"] += 1

    def _packet(self, s: dict, i: int) -> bytes:
        return bytes((i,)) + s["data"][(i - 1) * 7:i * 7].ljust(7, b"\xff")

    def _pump_tp(self, now: float) -> None:
        for key, s in list(self.tx_tp.items()):
            if s["kind"] == "bam":
                if now >= s["at"]:
                    self._raw(7, TP_DT, self._packet(s, s["next"]), GLOBAL)
                    s["next"] += 1
                    s["at"] = now + 0.05
                    if s["next"] > s["n"]:
                        del self.tx_tp[key]
            elif s["state"] == "send" and s["allowed"] > 0:
                self._raw(7, TP_DT, self._packet(s, s["next"]), s["da"])
                s["next"] += 1
                s["allowed"] -= 1
                if s["allowed"] == 0:
                    s["state"] = "wait_cts" if s["next"] <= s["n"] else "wait_eoma"
                    s["timeout"] = now + 1.25
            elif now > s["timeout"]:
                self._abort(s["pgn"], s["da"], 3)
                del self.tx_tp[key]
        for key, r in list(self.rx_tp.items()):
            if now > r["timeout"]:
                if r["kind"] == "rts":
                    self._abort(r["pgn"], key[0], 3)
                del self.rx_tp[key]

    def _abort(self, pgn: int, da: int, reason: int) -> None:
        self._raw(7, TP_CM, bytes((ABORT, reason, 0xFF, 0xFF, 0xFF, pgn & 0xFF, (pgn >> 8) & 0xFF, (pgn >> 16) & 0xFF)), da)

    def _on_tp_cm(self, sa: int, da: int, data: bytes, ts: float) -> None:
        ctl = data[0]
        pgn = data[5] | (data[6] << 8) | (data[7] << 16)
        if ctl == BAM and da == GLOBAL:
            size = data[1] | (data[2] << 8)
            self.rx_tp[(sa, GLOBAL)] = {"kind": "bam", "pgn": pgn, "size": size, "n": data[3], "buf": {}, "timeout": time.monotonic() + 0.75}
        elif ctl == RTS and da == self.sa:
            size = data[1] | (data[2] << 8)
            self.rx_tp[(sa, self.sa)] = {"kind": "rts", "pgn": pgn, "size": size, "n": data[3], "buf": {}, "timeout": time.monotonic() + 1.25}
            n = data[3]
            self._raw(7, TP_CM, bytes((CTS, n, 1, 0xFF, 0xFF, data[5], data[6], data[7])), sa)
        elif ctl == CTS and da == self.sa:
            s = self.tx_tp.get(("rts", sa))
            if s:
                s["allowed"] = data[1]
                s["next"] = data[2]
                s["state"] = "send" if data[1] else "wait_cts"
                s["timeout"] = time.monotonic() + 1.25
        elif ctl == EOMA and da == self.sa:
            self.tx_tp.pop(("rts", sa), None)
        elif ctl == ABORT and da == self.sa:
            self.tx_tp.pop(("rts", sa), None)
            self.rx_tp.pop((sa, self.sa), None)

    def _on_tp_dt(self, sa: int, da: int, data: bytes, ts: float) -> None:
        key = (sa, GLOBAL if da == GLOBAL else self.sa)
        r = self.rx_tp.get(key)
        if r is None or (da != GLOBAL and da != self.sa):
            return
        r["buf"][data[0]] = bytes(data[1:8])
        r["timeout"] = time.monotonic() + 0.75
        if len(r["buf"]) >= r["n"]:
            payload = b"".join(r["buf"][i] for i in range(1, r["n"] + 1))[:r["size"]]
            del self.rx_tp[key]
            if r["kind"] == "rts":
                pgn = r["pgn"]
                self._raw(7, TP_CM, bytes((EOMA, r["size"] & 0xFF, r["size"] >> 8, r["n"], 0xFF, pgn & 0xFF, (pgn >> 8) & 0xFF, (pgn >> 16) & 0xFF)), sa)
            self.stats["tp_rx"] += 1
            self._dispatch(r["pgn"], sa, da, payload, ts)

    # ---------- wire

    def _raw(self, priority: int, pgn: int, data: bytes, da: int = GLOBAL, force_sa: int | None = None) -> None:
        sa = self.sa if force_sa is None else force_sa
        cid = J.can_id(priority, pgn, sa, da)
        msg = can.Message(arbitration_id=cid, data=bytes(data), is_extended_id=True, dlc=len(data))
        try:
            msg.timestamp = time.time()
            self.bus.send(msg)
            self.stats["tx"] += 1
            for fn in self.raw_hooks:
                fn(msg, True)
        except can.CanError:
            pass

    def _drain(self, now: float) -> None:
        while True:
            msg = self.bus.recv(0.0)
            if msg is None:
                return
            if not msg.is_extended_id:
                continue
            _, pgn, sa, da = J.parse_can_id(msg.arbitration_id)
            # our own frame looped back by the transport
            if sa == self.sa and self.sa != NULL and (pgn != ADDRESS_CLAIMED or bytes(msg.data[:8]) == self.name.to_bytes(8, "little")):
                continue
            for fn in self.raw_hooks:
                fn(msg, False)
            self.stats["rx"] += 1
            self._dispatch(pgn, sa, da, bytes(msg.data), msg.timestamp)

    def _dispatch(self, pgn: int, sa: int, da: int, data: bytes, ts: float) -> None:
        for fn in self.handlers.get(pgn, ()):
            fn(sa, da, data, ts)
        for fn in self.handlers.get(-1, ()):
            fn(pgn, sa, da, data, ts)
