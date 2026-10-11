"""Decoding through the DBC with cantools, the way a real gateway is configured: the database is a file."""

from __future__ import annotations

import os
from pathlib import Path

import cantools

from .frames import J


def _path() -> Path:
    env = os.environ.get("GW_DBC")
    if env:
        return Path(env)
    here = Path(__file__).resolve()
    for cand in (here.parent.parent / "dbc" / "groundwork-j1939.dbc",):
        if cand.exists():
            return cand
    raise FileNotFoundError("groundwork-j1939.dbc not found, set GW_DBC")


DB = cantools.database.load_file(str(_path()))
BY_PGN = {(m.frame_id >> 8) & 0x3FFFF: m for m in DB.messages}


def _na(length: int) -> int:
    return J.max_valid(length)


def decode(can_id: int, data: bytes):
    """(message name, {signal: value}) with J1939 not-available and error ranges as None, or (None, {})."""
    return decode_pgn(J.parse_can_id(can_id)[1], data)


def decode_pgn(pgn: int, data: bytes):
    m = BY_PGN.get(pgn)
    if m is None:
        return None, {}
    raw = m.decode(bytes(data).ljust(8, b"\xff"), decode_choices=False, scaling=False)
    out = {}
    for s in m.signals:
        r = raw[s.name]
        out[s.name] = None if r > _na(s.length) else round(r * s.scale + s.offset, 6)
    return m.name, out
