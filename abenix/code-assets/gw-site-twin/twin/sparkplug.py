"""Sparkplug B payloads, hand-encoded protobuf matching sparkplug_b.proto (Payload and Metric)."""

from __future__ import annotations

import struct

NAMESPACE = "spBv1.0"
GROUP = "northgate"
EDGE_NODE = "site-gw1"

# Sparkplug B DataType enum
INT32 = 3
UINT64 = 8
FLOAT = 9
DOUBLE = 10
BOOLEAN = 11
STRING = 12


def _varint(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def _key(field: int, wire: int) -> bytes:
    return _varint((field << 3) | wire)


def _len_field(field: int, data: bytes) -> bytes:
    return _key(field, 2) + _varint(len(data)) + data


def encode_metric(name: str, value, datatype: int, alias: int | None = None, ts: int | None = None) -> bytes:
    m = _len_field(1, name.encode())
    if alias is not None:
        m += _key(2, 0) + _varint(alias)
    if ts is not None:
        m += _key(3, 0) + _varint(ts)
    m += _key(4, 0) + _varint(datatype)
    if value is None:
        m += _key(7, 0) + _varint(1)
    elif datatype == FLOAT:
        m += _key(12, 5) + struct.pack("<f", float(value))
    elif datatype == DOUBLE:
        m += _key(13, 1) + struct.pack("<d", float(value))
    elif datatype == BOOLEAN:
        m += _key(14, 0) + _varint(1 if value else 0)
    elif datatype == STRING:
        m += _len_field(15, str(value).encode())
    elif datatype == UINT64:
        m += _key(11, 0) + _varint(int(value))
    else:
        m += _key(10, 0) + _varint(int(value) & 0xFFFFFFFF)
    return m


def encode_payload(ts_ms: int, metrics: list, seq: int) -> bytes:
    """metrics: (name, value, datatype). seq wraps at 256 as the spec says."""
    out = _key(1, 0) + _varint(ts_ms)
    for name, value, dt in metrics:
        out += _len_field(2, encode_metric(name, value, dt))
    out += _key(3, 0) + _varint(seq % 256)
    return out


def _read_varint(b: bytes, i: int) -> tuple[int, int]:
    shift = 0
    n = 0
    while True:
        c = b[i]
        i += 1
        n |= (c & 0x7F) << shift
        if not c & 0x80:
            return n, i
        shift += 7


def _fields(b: bytes):
    i = 0
    while i < len(b):
        k, i = _read_varint(b, i)
        f, w = k >> 3, k & 7
        if w == 0:
            v, i = _read_varint(b, i)
        elif w == 1:
            v = b[i:i + 8]
            i += 8
        elif w == 5:
            v = b[i:i + 4]
            i += 4
        elif w == 2:
            n, i = _read_varint(b, i)
            v = b[i:i + n]
            i += n
        else:
            raise ValueError(f"wire type {w}")
        yield f, w, v


def decode_payload(b: bytes) -> dict:
    out = {"timestamp": None, "seq": None, "metrics": []}
    for f, _w, v in _fields(b):
        if f == 1:
            out["timestamp"] = v
        elif f == 3:
            out["seq"] = v
        elif f == 2:
            m = {"name": None, "datatype": None, "value": None}
            for mf, _mw, mv in _fields(v):
                if mf == 1:
                    m["name"] = mv.decode()
                elif mf == 4:
                    m["datatype"] = mv
                elif mf == 12:
                    m["value"] = struct.unpack("<f", mv)[0]
                elif mf == 13:
                    m["value"] = struct.unpack("<d", mv)[0]
                elif mf == 14:
                    m["value"] = bool(mv)
                elif mf == 15:
                    m["value"] = mv.decode()
                elif mf in (10, 11):
                    m["value"] = mv
                elif mf == 7:
                    m["value"] = None
            out["metrics"].append(m)
    return out


def topic(msg_type: str, device: str | None = None) -> str:
    t = f"{NAMESPACE}/{GROUP}/{msg_type}/{EDGE_NODE}"
    return f"{t}/{device}" if device else t
