"""Records where HT1 actually drives, from its GNSS in Abenix, into the twin's drive.json.

    GW_SITE=nh108 python scripts/trace_haul.py [--minutes 30]

The PCs must be running the same layout. The haul corridor the twin traces, and the geofence rule provision.py fills
from it, then cover the ground HT1 really uses as well as the planned road. Run provision.py after it.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TWIN = ROOT / "abenix" / "code-assets" / "gw-site-twin"
sys.path.insert(0, str(ROOT / "bff" / "vendor"))
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(TWIN))

from abenix_sdk import Abenix  # noqa: E402
from provision import env  # noqa: E402
from twin import layout as L  # noqa: E402


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=int, default=30)
    ap.add_argument("--node", default="ipc-ht1")
    a = ap.parse_args()
    site = L.use(env("GW_SITE", "northgate"))
    async with Abenix(api_key=env("ABENIX_API_KEY"), base_url=env("ABENIX_URL", "http://localhost:8000"), timeout=120) as f:
        xy = {}
        for sig in ("GNSS/X_m", "GNSS/Y_m"):
            h = await f.telemetry.history("groundwork", a.node, "telematics", sig, from_=f"-{a.minutes}m", step="1s")
            xy[sig] = {p["t"]: p["avg"] for p in h["series"][0]["points"]}
    ts = sorted(set(xy["GNSS/X_m"]) & set(xy["GNSS/Y_m"]))
    runs, run, last = [], [], None
    for t in ts:
        p = [round(xy["GNSS/X_m"][t], 1), round(xy["GNSS/Y_m"][t], 1)]
        # a gap in the data or a jump across the site starts a new run
        if last and (t - last[0] > 5000 or abs(p[0] - last[1][0]) + abs(p[1] - last[1][1]) > 40):
            if len(run) > 1:
                runs.append(run)
            run = []
        if not run or p != run[-1]:
            run.append(p)
        last = (t, p)
    if len(run) > 1:
        runs.append(run)
    # only runs on this layout's ground, the start of a window can hold the layout before
    pit = next(z["polygon"] for z in L.site()["zones"] if z["kind"] == "excavation")
    near = lambda r: any(min(abs(x - q[0]) + abs(y - q[1]) for q in pit) < 60 for x, y in r)  # noqa: E731
    runs = [r for r in runs if near(r)]
    n = sum(len(r) for r in runs)
    if n < 100:
        sys.exit(f"only {n} points of {a.node} on {site} in the last {a.minutes} min, let it drive longer")
    path = TWIN / "twin" / "drive.json"
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    data[site] = {"node": a.node, "minutes": a.minutes, "points": n, "runs": runs}
    path.write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{n} points of {a.node} on {site} in {len(runs)} runs written to {path}")


if __name__ == "__main__":
    asyncio.run(main())
