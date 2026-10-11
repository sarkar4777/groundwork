"""Sparkplug B payloads, from the Eclipse Tahu protobuf (EPL-2.0)."""

from __future__ import annotations

import time

from .proto import sparkplug_b_pb2 as pb

T = pb.DataType
Payload = pb.Payload


def now_ms() -> int:
    return int(time.time() * 1000)


def type_of(v) -> int:
    if isinstance(v, bool):
        return T.Boolean
    if isinstance(v, int):
        return T.Int64
    if isinstance(v, float):
        return T.Double
    return T.String


def set_value(m, v, dt: int) -> None:
    m.datatype = dt
    if v is None:
        m.is_null = True
    elif dt == T.Boolean:
        m.boolean_value = bool(v)
    elif dt in (T.Int8, T.Int16, T.Int32, T.UInt8, T.UInt16, T.UInt32):
        m.int_value = int(v) & 0xFFFFFFFF
    elif dt in (T.Int64, T.UInt64, T.DateTime):
        m.long_value = int(v) & 0xFFFFFFFFFFFFFFFF
    elif dt == T.Float:
        m.float_value = float(v)
    elif dt == T.Double:
        m.double_value = float(v)
    else:
        m.string_value = str(v)


def payload(metrics: list, seq: int | None, ts: int | None = None) -> bytes:
    """metrics: [(name, value, datatype, alias, writable)]. Writable metrics carry the Sparkplug property."""
    p = Payload()
    p.timestamp = ts or now_ms()
    if seq is not None:
        p.seq = seq
    for name, value, dt, alias, writable in metrics:
        m = p.metrics.add()
        if name:
            m.name = name
        if alias is not None:
            m.alias = alias
        m.timestamp = p.timestamp
        set_value(m, value, dt)
        if writable:
            m.properties.keys.append("readOnly")
            v = m.properties.values.add()
            v.type = T.Boolean
            v.boolean_value = False
    return p.SerializeToString()


def parse(data: bytes) -> Payload:
    p = Payload()
    p.ParseFromString(data)
    return p


def value_of(m):
    kind = m.WhichOneof("value")
    return None if kind is None else getattr(m, kind)
