"""Runs Abenix typed JSON decision rules inside the tick, first matching rule wins.

The rules are exported from Abenix (decisions.export) and passed into each step, so the
published decision is the source of truth. Only constant outcomes are supported here,
which is all the gw.* tables use. Anything else makes the table refuse to compile.
"""

from __future__ import annotations

import hashlib
import json

_CACHE: dict[str, "Table"] = {}


def _getter(path: str):
    parts = path.split(".")

    def get(facts):
        v = facts
        for p in parts:
            if not isinstance(v, dict) or p not in v:
                return None
            v = v[p]
        return v

    return get


def _operand(x):
    if isinstance(x, dict) and "fact" in x:
        return _getter(x["fact"])
    return lambda _f, c=x: c


def _compile(node):
    if not isinstance(node, dict) or len(node) != 1:
        raise ValueError(f"bad condition {node!r}")
    (op, args), = node.items()
    if op in ("all", "any"):
        subs = [_compile(a) for a in args]
        if op == "all":
            return lambda f: all(s(f) for s in subs)
        return lambda f: any(s(f) for s in subs)
    if op == "not":
        inner = _compile(args if isinstance(args, dict) else args[0])
        return lambda f: not inner(f)
    a = _operand(args[0])
    if op in ("isTrue", "isFalse", "isSet", "isNotSet"):
        return {
            "isTrue": lambda f: a(f) is True,
            "isFalse": lambda f: a(f) is False,
            "isSet": lambda f: a(f) is not None,
            "isNotSet": lambda f: a(f) is None,
        }[op]
    if op == "between":
        lo, hi = _operand(args[1]), _operand(args[2])

        def between(f):
            v = a(f)
            return v is not None and lo(f) <= v <= hi(f)
        return between
    if op in ("in", "notIn"):
        vals = args[1] if isinstance(args[1], list) else [args[1]]
        if op == "in":
            return lambda f: a(f) in vals
        return lambda f: a(f) not in vals
    b = _operand(args[1])
    cmp = {
        "eq": lambda x, y: x == y,
        "neq": lambda x, y: x != y,
        "gt": lambda x, y: x > y,
        "gte": lambda x, y: x >= y,
        "lt": lambda x, y: x < y,
        "lte": lambda x, y: x <= y,
    }.get(op)
    if cmp is None:
        raise ValueError(f"operator {op} is not supported in the tick")

    def test(f):
        x = a(f)
        if x is None:
            return False
        try:
            return cmp(x, b(f))
        except TypeError:
            return False
    return test


class Table:
    def __init__(self, key: str, version: int, rules: list):
        self.key = key
        self.version = version
        self.rules = []
        for r in rules:
            then = r.get("then") or {}
            for k, v in then.items():
                if isinstance(v, dict):
                    raise ValueError(f"{key} {r.get('ruleKey')}: outcome {k} is not a constant")
            self.rules.append((r.get("ruleKey"), _compile(r.get("when") or {"all": []}), dict(then)))

    def evaluate(self, facts: dict):
        for key, cond, then in self.rules:
            if cond(facts):
                return key, then
        return None, None


def table(entry: dict) -> Table:
    """entry: {key, version, rules}. Compiled once per content hash in this process."""
    h = entry.get("hash")
    if not h:
        h = hashlib.sha1(json.dumps(entry.get("rules"), sort_keys=True).encode()).hexdigest()
        entry["hash"] = h
    t = _CACHE.get(h)
    if t is None:
        t = Table(entry.get("key", "?"), int(entry.get("version") or 0), entry.get("rules") or [])
        _CACHE[h] = t
    return t
