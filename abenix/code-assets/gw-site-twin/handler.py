"""Warm runner handler: one JSON request per line on stdin, one JSON answer per line on stdout."""

import json
import sys
import traceback

from twin.api import run


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            out = run(req.get("input") or {})
            sys.stdout.write(json.dumps({"id": rid, "output": out}, separators=(",", ":")) + "\n")
        except Exception as e:  # noqa: BLE001
            sys.stdout.write(json.dumps({"id": rid, "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-1500:]}) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
