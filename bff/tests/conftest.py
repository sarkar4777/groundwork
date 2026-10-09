import glob
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "abenix" / "code-assets" / "gw-site-twin"))
sys.path.insert(0, str(ROOT / "abenix" / "code-assets" / "gw-dispatch-optimiser"))
sys.path.insert(0, str(ROOT / "bff"))


def load_rules() -> dict:
    out = {}
    for p in glob.glob(str(ROOT / "abenix" / "decisions" / "*.json")):
        d = json.loads(Path(p).read_text())
        out[d["key"]] = {"key": d["key"], "version": 1, "rules": d["rules"]}
    return out


@pytest.fixture
def rules():
    return load_rules()
