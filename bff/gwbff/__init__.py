import sys
from pathlib import Path

# the vendored Abenix SDK
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "vendor"))
