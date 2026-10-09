import json
import sys
import traceback

from optimiser import run


def main():
    for line in sys.stdin:
        if not line.strip():
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            sys.stdout.write(json.dumps({"id": rid, "output": run(req.get("input") or {})}) + "\n")
        except Exception as e:  # noqa: BLE001
            sys.stdout.write(json.dumps({"id": rid, "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-1500:]}) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
