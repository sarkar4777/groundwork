"""candump for the emulated bus, in the formats can-utils uses.

    candump                 live, one line per frame, like candump -ta any
    candump -L              candump -L log lines: (timestamp) vcan0 18FEF100#0102030405060708
    candump --decode        each frame decoded through the J1939 DBC with cantools
    candump -n 200          stop after 200 frames
    candump --stats         the bus's own numbers: load, arbitration, error counters, bus state
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
from pathlib import Path

HOST = os.environ.get("CAN_HOST", "localhost")
PORT = int(os.environ.get("CAN_PORT", "29536"))
CHANNEL = os.environ.get("CAN_CHANNEL", "vcan0")


def frames():
    s = socket.create_connection((HOST, PORT))
    assert s.recv(64) == b"< hi >"
    s.sendall(f"< open {CHANNEL} >".encode())
    s.recv(64)
    s.sendall(b"< rawmode >")
    s.recv(64)
    buf = ""
    while True:
        chunk = s.recv(65536)
        if not chunk:
            return
        buf += chunk.decode("ascii", "replace")
        while True:
            a, b = buf.find("<"), buf.find(">")
            if a < 0 or b < 0:
                break
            parts = buf[a + 1:b].split()
            buf = buf[b + 1:]
            if len(parts) >= 3 and parts[0] == "frame":
                yield int(parts[1], 16), float(parts[2]), bytes.fromhex(parts[3]) if len(parts) > 3 else b""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-L", action="store_true", help="log format")
    ap.add_argument("--decode", action="store_true")
    ap.add_argument("-n", type=int, default=0)
    ap.add_argument("--stats", action="store_true")
    a = ap.parse_args()
    if a.stats:
        with socket.create_connection((HOST, int(os.environ.get("CANBUS_CONTROL_PORT", "29537")))) as s:
            s.sendall(b'{"cmd": "stats"}\n')
            print(json.dumps(json.loads(s.makefile().readline()), indent=1))
        return
    dec = None
    if a.decode:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        from ipc import dbc
        from ipc.frames import J
        dec = (dbc, J)
    n = 0
    try:
        for cid, ts, data in frames():
            if a.L:
                line = f"({ts:.6f}) {CHANNEL} {cid:08X}#{data.hex().upper()}"
            else:
                line = f" ({ts:.6f})  {CHANNEL}  {cid:08X}   [{len(data)}]  {' '.join(f'{b:02X}' for b in data)}"
            if dec:
                dbc, J = dec
                _, pgn, sa, da = J.parse_can_id(cid)
                name, vals = dbc.decode_pgn(pgn, data)
                p = J.PGNS.get(pgn)
                label = name or (p.acronym if p else f"PGN {pgn}")
                body = "  ".join(f"{k}={v}" for k, v in vals.items() if v is not None)
                line += f"   ;; {label} PGN {pgn} SA 0x{sa:02X}" + (f" DA 0x{da:02X}" if da != 0xFF else "") + (f"  {body}" if body else "")
            print(line, flush=True)
            n += 1
            if a.n and n >= a.n:
                return
    except (KeyboardInterrupt, BrokenPipeError):
        return


if __name__ == "__main__":
    main()
