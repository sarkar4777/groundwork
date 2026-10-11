"""Writes edge/dbc/groundwork-j1939.dbc from the J1939 dictionary the PCs and the twin share.

    python edge/tools/make_dbc.py

Every PGN with signals becomes a message. Its id carries priority, PGN and the null source address 0xFE, with
VFrameFormat J1939PG, which is how SavvyCAN, cantools and most J1939 tools expect a J1939 DBC.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "edge"))

from ipc import frames as F  # noqa: E402,F401
from ipc.frames import J  # noqa: E402


def ident(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]", "_", s)


def main() -> None:
    out = ['VERSION "groundwork-j1939 2.5.8"', "", "NS_ :", "", "BS_:", "", "BU_: Vector__XXX", ""]
    attrs = []
    for pgn in sorted(J.PGNS):
        p = J.PGNS[pgn]
        if not p.spns:
            continue
        cid = J.can_id(p.priority, pgn, 0xFE, 0xFF)
        name = ident(p.acronym)
        out.append(f"BO_ {cid | 0x80000000} {name}: 8 Vector__XXX")
        for s in p.spns:
            lo = s.offset
            hi = s.offset + s.scale * s.maxv
            unit = s.unit.replace('"', "")
            out.append(f' SG_ {ident(s.name)} : {s.shift}|{s.length}@1+ ({s.scale:g},{s.offset:g}) [{lo:g}|{hi:g}] "{unit}" Vector__XXX')
        out.append("")
        attrs.append(f'CM_ BO_ {cid | 0x80000000} "{p.name}, PGN {pgn} (0x{pgn:04X}), every {p.rate_ms} ms";' if p.rate_ms else
                     f'CM_ BO_ {cid | 0x80000000} "{p.name}, PGN {pgn} (0x{pgn:04X}), on event or request";')
        for s in p.spns:
            if s.spn:
                attrs.append(f'CM_ SG_ {cid | 0x80000000} {ident(s.name)} "SPN {s.spn}";')
    out += attrs
    out += ['', 'BA_DEF_ BO_ "VFrameFormat" ENUM "StandardCAN","ExtendedCAN","reserved","J1939PG";',
            'BA_DEF_ "ProtocolType" STRING ;', 'BA_DEF_DEF_ "VFrameFormat" "J1939PG";', 'BA_DEF_DEF_ "ProtocolType" "J1939";',
            'BA_ "ProtocolType" "J1939";']
    path = ROOT / "edge" / "dbc" / "groundwork-j1939.dbc"
    path.parent.mkdir(exist_ok=True)
    path.write_text("\n".join(out) + "\n", newline="\n")
    print(f"wrote {path.relative_to(ROOT)}: {sum(1 for l in out if l.startswith('BO_'))} messages")


if __name__ == "__main__":
    main()
