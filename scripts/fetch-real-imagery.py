#!/usr/bin/env python3
"""Fetch the real drone imagery Groundwork can render on, and prepare it for the web.

    pip install -r scripts/requirements-real.txt
    python scripts/fetch-real-imagery.py            # download, verify, prepare
    python scripts/fetch-real-imagery.py --check    # verify what is already on disk

Nothing here is committed. Sources land in data/real/src, prepared tiles in data/real/<site>.
See docs/real-imagery.md for the licences and why this site.
"""

import argparse
import hashlib
import json
import math
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "real"

SOURCES = {
    "nh108": {
        "url": "https://oin-hotosm-temp.s3.us-east-1.amazonaws.com/65088140f17ffb0001796e72/0/65088140f17ffb0001796e73.tif",
        "sha256": "cc0167b362f338695cd401f4be4a0948e531274ebe18956cac6bb2d4c87c1776",
        "bytes": 42529144,
        "title": "NH108 Construction Project 20230914",
        "provider": "Craig Goodspeed",
        "page": "https://map.openaerialmap.org/#/-70.9315,43.0419,18/square/0320010023/65088140f17ffb0001796e73",
        "licence": "CC BY 4.0",
        "licence_url": "https://creativecommons.org/licenses/by/4.0/",
        "attribution": "Orthophoto © Craig Goodspeed, via OpenAerialMap (Open Imagery Network), CC BY 4.0",
        "capture_utc": ["2023-09-14T20:18:00Z", "2023-09-14T21:20:00Z"],
        "sensor": "DJI FC8282",
        # shadowed over sunlit bare ground, sRGB, mean of the excavator and crane shadow pairs
        "shadow_ratio_srgb": [0.32, 0.42, 0.57],
        # the excavation, in source pixels
        "aoi": [4600, 6900, 12800, 11900],
        # where the twin's EX1 works, in source pixels
        "anchor": [10976, 10232],
        # three machines parked on site that day, one with a maker's logo, and their shadows
        # [x0, y0, x1, y1, donor dx, donor dy] in source pixels
        "retouch": [
            [10700, 10000, 11450, 10520, -820, 0],
            [8470, 9960, 9910, 10420, 0, -470],
            [9070, 9140, 9380, 9440, -360, 0],
        ],
    },
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(key: str, src: dict) -> Path:
    dst = OUT / "src" / f"{key}.tif"
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists() and dst.stat().st_size == src["bytes"] and sha256(dst) == src["sha256"]:
        print(f"{key}: cached {dst}")
        return dst
    print(f"{key}: downloading {src['url']}")
    tmp = dst.with_suffix(".part")
    req = urllib.request.Request(src["url"], headers={"User-Agent": "groundwork-fetch/1.0"})
    with urllib.request.urlopen(req) as r, tmp.open("wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    got = sha256(tmp)
    if got != src["sha256"]:
        tmp.unlink()
        sys.exit(f"{key}: checksum mismatch, got {got}")
    tmp.replace(dst)
    return dst


def sun_position(when: datetime, lat: float, lon: float) -> tuple[float, float]:
    """NOAA solar position. Returns (azimuth from north clockwise, elevation), degrees."""
    jd = when.timestamp() / 86400.0 + 2440587.5
    t = (jd - 2451545.0) / 36525.0
    l0 = (280.46646 + t * (36000.76983 + 0.0003032 * t)) % 360
    m = 357.52911 + t * (35999.05029 - 0.0001537 * t)
    e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
    mr = math.radians(m)
    c = math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t)) + math.sin(2 * mr) * (0.019993 - 0.000101 * t) + math.sin(3 * mr) * 0.000289
    true_long = l0 + c
    omega = 125.04 - 1934.136 * t
    app_long = true_long - 0.00569 - 0.00478 * math.sin(math.radians(omega))
    eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
    eps = eps0 + 0.00256 * math.cos(math.radians(omega))
    decl = math.degrees(math.asin(math.sin(math.radians(eps)) * math.sin(math.radians(app_long))))
    y = math.tan(math.radians(eps / 2)) ** 2
    l0r = math.radians(l0)
    eqt = 4 * math.degrees(y * math.sin(2 * l0r) - 2 * e * math.sin(mr) + 4 * e * y * math.sin(mr) * math.cos(2 * l0r) - 0.5 * y * y * math.sin(4 * l0r) - 1.25 * e * e * math.sin(2 * mr))
    minutes = when.hour * 60 + when.minute + when.second / 60
    tst = (minutes + eqt + 4 * lon) % 1440
    ha = tst / 4 - 180 if tst / 4 >= 0 else tst / 4 + 180
    latr, decr, har = math.radians(lat), math.radians(decl), math.radians(ha)
    cos_zen = math.sin(latr) * math.sin(decr) + math.cos(latr) * math.cos(decr) * math.cos(har)
    zen = math.degrees(math.acos(max(-1, min(1, cos_zen))))
    az = math.degrees(math.atan2(math.sin(har), math.cos(har) * math.sin(latr) - math.tan(decr) * math.cos(latr))) + 180
    return az % 360, 90 - zen


def prepare(key: str, src: dict, path: Path) -> None:
    import numpy as np
    import rasterio
    from rasterio.warp import transform as warp
    from rasterio.windows import Window
    import cv2
    from PIL import Image

    out = OUT / key
    out.mkdir(parents=True, exist_ok=True)
    with rasterio.open(path) as d:
        res = d.res[0]
        tf = d.transform
        x0, y0, x1, y1 = src["aoi"]
        detail = np.moveaxis(d.read([1, 2, 3], window=Window(x0, y0, x1 - x0, y1 - y0)), 0, -1).copy()
        sw, sh = d.width // 4, d.height // 4
        surround = np.moveaxis(d.read([1, 2, 3], out_shape=(3, sh, sw)), 0, -1).copy()
        mask_valid = d.read_masks(1, out_shape=(sh, sw))
        ax, ay = src["anchor"]
        ae, an = tf * (ax + 0.5, ay + 0.5)
        lon, lat = warp(d.crs, "EPSG:4326", [ae], [an])
        lon, lat = lon[0], lat[0]
        b = d.bounds

    # parked machines out, so only the twin's machines move on the site
    for rx0, ry0, rx1, ry1, dx, dy in src["retouch"]:
        lx0, ly0, lx1, ly1 = rx0 - x0, ry0 - y0, rx1 - x0, ry1 - y0
        donor = detail[ly0 + dy : ly1 + dy, lx0 + dx : lx1 + dx].copy()
        mask = np.zeros(donor.shape[:2], np.uint8)
        cv2.ellipse(mask, ((mask.shape[1] // 2, mask.shape[0] // 2), (mask.shape[1] - 6, mask.shape[0] - 6), 0), 255, -1)
        mask[6:-6, 6:-6] = 255
        centre = ((lx0 + lx1) // 2, (ly0 + ly1) // 2)
        bgr = cv2.cvtColor(detail, cv2.COLOR_RGB2BGR)
        bgr = cv2.seamlessClone(cv2.cvtColor(donor, cv2.COLOR_RGB2BGR), bgr, mask, centre, cv2.NORMAL_CLONE)
        detail = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        # the same patch in the surround, at its scale
        s = 4
        sm = cv2.resize(detail[ly0:ly1, lx0:lx1], ((lx1 - lx0) // s, (ly1 - ly0) // s), interpolation=cv2.INTER_AREA)
        surround[ry0 // s : ry0 // s + sm.shape[0], rx0 // s : rx0 // s + sm.shape[1]] = sm
    # the surround shows the whole capture at a quarter of the resolution, under the detail
    sx0, sy0 = x0 // 4, y0 // 4
    small = cv2.resize(detail, ((x1 - x0) // 4, (y1 - y0) // 4), interpolation=cv2.INTER_AREA)
    surround[sy0 : sy0 + small.shape[0], sx0 : sx0 + small.shape[1]] = small
    surround[mask_valid == 0] = (58, 66, 52)
    Image.fromarray(detail).save(out / "detail.jpg", quality=90, optimize=True)
    Image.fromarray(surround).save(out / "surround.jpg", quality=88, optimize=True)

    t0, t1 = (datetime.fromisoformat(s.replace("Z", "+00:00")) for s in src["capture_utc"])
    mid = t0 + (t1 - t0) / 2
    az, el = sun_position(mid, lat, lon)
    az0, el0 = sun_position(t0, lat, lon)
    az1, el1 = sun_position(t1, lat, lon)

    def rect(px0, py0, px1, py1):
        e0, n0 = tf * (px0, py0)
        e1, n1 = tf * (px1, py1)
        return [round(e0 - ae, 3), round(n1 - an, 3), round(e1 - ae, 3), round(n0 - an, 3)]

    meta = {
        "site": key,
        "title": src["title"],
        "attribution": src["attribution"],
        "licence": src["licence"],
        "licence_url": src["licence_url"],
        "page": src["page"],
        "capture_utc": src["capture_utc"],
        "sensor": src["sensor"],
        "gsd_m": round(res, 4),
        "anchor": {"lat": round(lat, 6), "lon": round(lon, 6), "utm": [round(ae, 2), round(an, 2)]},
        # west, south, east, north in metres from the anchor, east and north positive
        "detail": {"file": "detail.jpg", "rect": rect(x0, y0, x1, y1), "px": [x1 - x0, y1 - y0]},
        "surround": {"file": "surround.jpg", "rect": rect(0, 0, sw * 4, sh * 4), "px": [sw, sh]},
        "bounds_utm": [b.left, b.bottom, b.right, b.top],
        "sun": {
            "azimuth_deg": round(az, 2),
            "elevation_deg": round(el, 2),
            "at_utc": mid.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "range": {"start": [round(az0, 2), round(el0, 2)], "end": [round(az1, 2), round(el1, 2)]},
            "method": "NOAA solar position, capture midpoint, anchor lat/lon",
        },
        "shadow_ratio": [round(c ** 2.2, 3) for c in src["shadow_ratio_srgb"]],
        "retouched": "three parked machines and their shadows cloned out from nearby ground",
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=2))
    print(f"{key}: detail {x1 - x0}x{y1 - y0} at {res:.4f} m, surround {sw}x{sh}, sun az {az:.1f} el {el:.1f} at {meta['sun']['at_utc']}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    for key, src in SOURCES.items():
        if a.only and key != a.only:
            continue
        if a.check:
            p = OUT / "src" / f"{key}.tif"
            ok = p.exists() and sha256(p) == src["sha256"]
            print(f"{key}: {'ok' if ok else 'missing or changed'}")
            continue
        prepare(key, src, fetch(key, src))


if __name__ == "__main__":
    main()
