"""Process mode and the Job path: the input on stdin, the answer on stdout."""

import json
import os
import sys

from twin.api import run

if __name__ == "__main__":
    path = os.environ.get("ABENIX_INPUT_FILE")
    raw = open(path).read() if path and os.path.exists(path) else sys.stdin.read()
    print(json.dumps(run(json.loads(raw or "{}")), separators=(",", ":")))
