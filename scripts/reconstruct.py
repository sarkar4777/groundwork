#!/usr/bin/env python3
"""Drone photos in, a site the web can stand machines on out: orthophoto, DSM, DTM, mesh, camera poses and a splat.

    python scripts/reconstruct.py caliterra                 # every stage, the photos from fetch-real-imagery.py
    python scripts/reconstruct.py nh108 --photos D:/flight  # your own photos, any folder of geotagged JPEGs
    python scripts/reconstruct.py caliterra --from splat    # pick up from a stage
    python scripts/reconstruct.py caliterra --only dem
    python scripts/reconstruct.py caliterra --no-splat      # macOS and Linux: the splat step needs Brush's Windows build

Stages, in order:
  odm      OpenDroneMap in Docker (opendronemap/odm): SfM, dense cloud, DSM, DTM, orthophoto, textured mesh
  colmap   the undistorted cameras and points as a COLMAP text model, for the splat trainer
  splat    Brush (WebGPU, no CUDA) trains a Gaussian splat on the GPU, exported as PLY
  dem      DSM, DTM and orthophoto resampled onto the site grid the web reads, plus meta.json
  pack     the splat as a compact .splat file in the same frame, cropped to the site

Everything lands in data/real/<site>/, which git ignores. See docs/real-imagery.md.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "real"
TOOLS = ROOT / "data" / "tools"
STAGES = ["odm", "colmap", "splat", "dem", "pack"]
ODM_IMAGE = "opendronemap/odm:latest"
BRUSH_URL = "https://github.com/ArthurBrussee/brush/releases/download/v0.3.0/brush-app-x86_64-pc-windows-msvc.zip"
BRUSH_SHA256 = "b68e3e9cf052d51bf3ee30776fa5a364de7f2ba13b58443128ff797bb7bcfcd6"

# what each known site credits, the web prints it on screen
CREDITS = {
    "caliterra": {
        "title": "Caliterra test flight",
        "attribution": "Aerial photos of Caliterra, Dennis Baldwin, CC0 1.0, via OpenDroneMap",
        "licence": "CC0 1.0",
        "licence_url": "https://creativecommons.org/publicdomain/zero/1.0/",
        "page": "https://github.com/OpenDroneMap/odm_data_caliterra",
    },
}


def log(*a):
    print("[reconstruct]", *a, flush=True)


def run(cmd: list[str], **kw) -> None:
    log(" ".join(str(c) for c in cmd))
    r = subprocess.run([str(c) for c in cmd], **kw)
    if r.returncode != 0:
        sys.exit(f"failed: {cmd[0]} exited {r.returncode}")


def docker_path(p: Path) -> str:
    return p.resolve().as_posix()


# ---------- odm

def docker_cpus() -> int:
    try:
        return int(subprocess.run(["docker", "info", "--format", "{{.NCPU}}"], capture_output=True, text=True).stdout.strip())
    except Exception:  # noqa: BLE001
        return 4


def stage_odm(site: str, photos: Path, out: Path, quality: str, rerun: str | None = None) -> None:
    n = len([p for p in photos.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".tif", ".tiff", ".png")])
    if n < 5:
        sys.exit(f"{photos} holds {n} photos, run python scripts/fetch-real-imagery.py --only {site} first")
    out.mkdir(parents=True, exist_ok=True)
    fast = quality == "fast"
    args = [
        "--dsm", "--dtm", "--cog", "--build-overviews",
        "--dem-resolution", "4" if not fast else "10",
        "--orthophoto-resolution", "2" if not fast else "5",
        "--pc-quality", "high" if quality == "high" else "medium",
        "--feature-quality", "high" if not fast else "medium",
        "--mesh-size", "300000",
        # PoissonRecon crashes at octree depth 11 in Docker Desktop, 10 holds
        "--mesh-octree-depth", "10",
        # the Docker VM's CPUs, not the host's, or PoissonRecon runs out of memory
        "--max-concurrency", str(docker_cpus()),
    ]
    if rerun:
        args += ["--rerun-from", rerun]
    run(["docker", "run", "--rm",
         "-v", f"{docker_path(photos)}:/datasets/{site}/images:ro",
         "-v", f"{docker_path(out)}:/datasets/{site}",
         ODM_IMAGE, "--project-path", "/datasets", site, *args])
    for f in ("odm_orthophoto/odm_orthophoto.tif", "odm_dem/dsm.tif", "odm_dem/dtm.tif", "opensfm/reconstruction.json"):
        if not (out / f).exists():
            sys.exit(f"OpenDroneMap finished without {f}")


# ---------- colmap

def _quat(rx: float, ry: float, rz: float) -> tuple[float, float, float, float]:
    th = math.sqrt(rx * rx + ry * ry + rz * rz)
    if th < 1e-12:
        return 1.0, 0.0, 0.0, 0.0
    s = math.sin(th / 2) / th
    return math.cos(th / 2), rx * s, ry * s, rz * s


def stage_colmap(odm: Path, data: Path) -> None:
    """Undistorted OpenSfM shots as a COLMAP PINHOLE model: images/, sparse/0/{cameras,images,points3D}.txt."""
    recs = json.loads((odm / "opensfm" / "undistorted" / "reconstruction.json").read_text())
    rec = max(recs, key=lambda r: len(r["shots"]))
    src = odm / "opensfm" / "undistorted" / "images"
    if data.exists():
        shutil.rmtree(data)
    (data / "images").mkdir(parents=True)
    (data / "sparse" / "0").mkdir(parents=True)
    cams, cam_id = {}, {}
    lines_c, lines_i = [], []
    for i, (cname, c) in enumerate(rec["cameras"].items(), 1):
        w, h = int(c["width"]), int(c["height"])
        f = float(c.get("focal", c.get("focal_x", 0.85))) * max(w, h)
        cams[cname] = (w, h, f)
        cam_id[cname] = i
        lines_c.append(f"{i} PINHOLE {w} {h} {f:.4f} {f:.4f} {w / 2:.4f} {h / 2:.4f}")
    for k, (name, s) in enumerate(sorted(rec["shots"].items()), 1):
        img = src / name
        if not img.exists():
            cands = list(src.glob(Path(name).stem + ".*"))
            if not cands:
                continue
            img = cands[0]
        # the trainer reads JPEG and PNG, OpenSfM undistorts to TIFF
        from PIL import Image
        out_name = Path(name).stem + ".jpg"
        Image.open(img).convert("RGB").save(data / "images" / out_name, quality=95)
        qw, qx, qy, qz = _quat(*s["rotation"])
        tx, ty, tz = s["translation"]
        lines_i.append(f"{k} {qw:.9f} {qx:.9f} {qy:.9f} {qz:.9f} {tx:.6f} {ty:.6f} {tz:.6f} {cam_id[s['camera']]} {out_name}\n\n")
    lines_p = []
    for j, (pid, p) in enumerate(rec["points"].items(), 1):
        x, y, z = p["coordinates"]
        r, g, b = (int(v) for v in p["color"])
        lines_p.append(f"{j} {x:.5f} {y:.5f} {z:.5f} {r} {g} {b} 0")
    (data / "sparse" / "0" / "cameras.txt").write_text("\n".join(lines_c) + "\n")
    (data / "sparse" / "0" / "images.txt").write_text("".join(lines_i))
    (data / "sparse" / "0" / "points3D.txt").write_text("\n".join(lines_p) + "\n")
    (data / "reference_lla.json").write_text((odm / "opensfm" / "reference_lla.json").read_text())
    log(f"colmap model: {len(lines_i)} images, {len(lines_p)} points, {len(lines_c)} cameras")


# ---------- splat

def brush_exe() -> Path:
    exe = TOOLS / "brush" / "brush_app.exe"
    if exe.exists():
        return exe
    TOOLS.mkdir(parents=True, exist_ok=True)
    z = TOOLS / "brush.zip"
    log("downloading Brush", BRUSH_URL)
    urllib.request.urlretrieve(BRUSH_URL, z)
    import hashlib
    if hashlib.sha256(z.read_bytes()).hexdigest() != BRUSH_SHA256:
        sys.exit("Brush download checksum mismatch")
    with zipfile.ZipFile(z) as f:
        f.extractall(TOOLS / "brush")
    return exe


def stage_splat(data: Path, out: Path, steps: int, max_splats: int) -> None:
    out.mkdir(parents=True, exist_ok=True)
    run([brush_exe(), str(data), "--total-steps", str(steps), "--max-splats", str(max_splats), "--max-resolution", "1600",
         "--sh-degree", "1", "--export-every", str(steps), "--export-path", str(out), "--export-name", "splat_{iter}.ply"],
        cwd=TOOLS)  # Brush keeps its GPU autotune cache in the working directory
    plys = sorted(out.glob("splat_*.ply"), key=lambda p: p.stat().st_mtime)
    if not plys:
        sys.exit("Brush exported no splat")
    shutil.copy2(plys[-1], out / "splat.ply")


# ---------- pack

def read_ply(path: Path):
    import numpy as np
    with path.open("rb") as f:
        header = b""
        while not header.endswith(b"end_header\n"):
            header += f.readline()
        props, n = [], 0
        for line in header.decode().splitlines():
            if line.startswith("element vertex"):
                n = int(line.split()[-1])
            elif line.startswith("property"):
                _, t, name = line.split()
                props.append((name, {"float": "<f4", "double": "<f8", "uchar": "u1", "int": "<i4"}[t]))
        arr = np.frombuffer(f.read(), dtype=np.dtype(props), count=n)
    return arr


def stage_pack(splat_dir: Path, out: Path, meta: dict, max_out: int) -> None:
    """Brush PLY to the 32-byte .splat layout drei's <Splat> reads, in the site frame (x east, y up, z south)."""
    import numpy as np
    v = read_ply(splat_dir / "splat.ply")
    lv = meta["levelling"]
    R, c, ground = np.array(lv["R"]), np.array(lv["centre_topocentric"]), lv["ground_z"]
    half = meta["grid"]["extent"] / 2
    pos = (np.stack([v["x"], v["y"], v["z"]], 1).astype(np.float64) - c) @ R.T
    e, n_, u = pos[:, 0], pos[:, 1], pos[:, 2] - ground
    keep = (np.abs(e) < half) & (np.abs(n_) < half) & (u > -20) & (u < 60)
    scale = np.exp(np.stack([v["scale_0"], v["scale_1"], v["scale_2"]], 1))
    opac = 1 / (1 + np.exp(-v["opacity"]))
    keep &= (opac > 0.04) & (scale.max(1) < 4.0)
    idx = np.nonzero(keep)[0]
    vol = np.prod(scale[idx], 1) ** (1 / 3) * opac[idx]
    idx = idx[np.argsort(-vol)][:max_out]
    C0 = 0.28209479177387814
    rgb = np.clip((0.5 + C0 * np.stack([v["f_dc_0"], v["f_dc_1"], v["f_dc_2"]], 1)[idx]) * 255, 0, 255).astype(np.uint8)
    a = np.clip(opac[idx] * 255, 0, 255).astype(np.uint8)

    def mat_to_quat(M):
        w = math.sqrt(max(0.0, 1 + M[0, 0] + M[1, 1] + M[2, 2])) / 2
        return np.array([w, (M[2, 1] - M[1, 2]) / (4 * w), (M[0, 2] - M[2, 0]) / (4 * w), (M[1, 0] - M[0, 1]) / (4 * w)])

    def qmul(q1, q2):
        w1, x1, y1, z1 = q1
        w2, x2, y2, z2 = q2.T
        return np.stack([w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2, w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
                         w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2], 1)

    q = np.stack([v["rot_0"], v["rot_1"], v["rot_2"], v["rot_3"]], 1)[idx].astype(np.float64)
    q /= np.linalg.norm(q, axis=1, keepdims=True)
    # levelling, then (east, north, up) to three's (x east, y up, z south)
    to_three = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)
    q = qmul(mat_to_quat(to_three @ R), q)
    q /= np.linalg.norm(q, axis=1, keepdims=True)
    p3 = np.stack([e[idx], u[idx], -n_[idx]], 1).astype(np.float32)
    s3 = scale[idx].astype(np.float32)
    rot = np.clip(q * 128 + 128, 0, 255).astype(np.uint8)
    buf = np.zeros(len(idx), dtype=[("p", "<f4", 3), ("s", "<f4", 3), ("c", "u1", 4), ("r", "u1", 4)])
    buf["p"], buf["s"] = p3, s3
    buf["c"] = np.concatenate([rgb, a[:, None]], 1)
    buf["r"] = rot
    out.write_bytes(buf.tobytes())
    log(f"splat: {len(idx)} of {len(v)} gaussians kept, {out.stat().st_size / 1e6:.1f} MB")


# ---------- dem

def exif_time_and_place(photos: Path):
    from PIL import Image
    from PIL.ExifTags import GPSTAGS, TAGS
    for p in sorted(photos.iterdir()):
        try:
            ex = Image.open(p)._getexif() or {}
        except Exception:  # noqa: BLE001
            continue
        d = {TAGS.get(k, k): v for k, v in ex.items()}
        g = {GPSTAGS.get(k, k): v for k, v in (d.get("GPSInfo") or {}).items()}
        if g.get("GPSDateStamp") and g.get("GPSTimeStamp"):
            hh, mm, ss = (float(x) for x in g["GPSTimeStamp"])
            day = datetime.strptime(g["GPSDateStamp"], "%Y:%m:%d").replace(tzinfo=timezone.utc)
            t = day.replace(hour=int(hh), minute=int(mm), second=int(ss))
            return t, p.name
    return None, None


def level_frame(odm: Path):
    """A consumer camera's GPS altitude can tilt the whole reconstruction. Fit the ground plane and level it.

    Returns the rotation R, the centre c in OpenSfM's topocentric frame, the levelled points and their colours,
    so p_site = R @ (p - c). Height 0 is then the ground plane through the middle of the data."""
    import numpy as np
    pts = read_ply(odm / "odm_filterpoints" / "point_cloud.ply")
    P = np.stack([pts["x"], pts["y"], pts["z"]], 1).astype(np.float64)
    C = np.stack([pts["red"], pts["green"], pts["blue"]], 1).astype(np.uint8)
    # the lowest points per 2 m cell stand for the ground
    key = np.floor(P[:, :2] / 2.0).astype(np.int64)
    order = np.lexsort((P[:, 2], key[:, 1], key[:, 0]))
    k = key[order]
    first = np.ones(len(k), bool)
    first[1:] = (k[1:] != k[:-1]).any(1)
    low = P[order][first]
    A = np.c_[low[:, 0], low[:, 1], np.ones(len(low))]
    keep = np.ones(len(low), bool)
    for _ in range(4):
        coef, *_ = np.linalg.lstsq(A[keep], low[keep, 2], rcond=None)
        r = low[:, 2] - A @ coef
        keep = np.abs(r - np.median(r[keep])) < max(1.0, 2.5 * np.std(r[keep]))
    a, b, _ = coef
    n = np.array([-a, -b, 1.0])
    n /= np.linalg.norm(n)
    z = np.array([0.0, 0.0, 1.0])
    v = np.cross(n, z)
    sn, cs = np.linalg.norm(v), float(n @ z)
    if sn < 1e-9:
        R = np.eye(3)
    else:
        vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
        R = np.eye(3) + vx + vx @ vx * ((1 - cs) / sn ** 2)
    lo, hi = np.percentile(P[:, :2], 1, axis=0), np.percentile(P[:, :2], 99, axis=0)
    cxy = (lo + hi) / 2
    c = np.array([cxy[0], cxy[1], a * cxy[0] + b * cxy[1] + coef[2]])
    L = (P - c) @ R.T
    tilt = math.degrees(math.acos(min(1.0, cs)))
    return R, c, L, C, tilt


def stage_dem(site: str, odm: Path, out: Path, photos: Path, half: float, grid: int, tex: int) -> dict:
    import numpy as np
    import rasterio
    from rasterio.warp import transform as warp
    from scipy import ndimage
    from PIL import Image
    lla = json.loads((odm / "opensfm" / "reference_lla.json").read_text())
    lat0, lon0 = lla["latitude"], lla["longitude"]
    R_EARTH = 6378137.0
    R, c, L, C, tilt = level_frame(odm)
    span = np.percentile(np.abs(L[:, :2]), 99.5, axis=0).max()
    half = float(min(half, math.ceil(span + 4)))
    cell = 2 * half / grid
    ij = np.floor((L[:, :2] + half) / cell).astype(np.int64)
    ok = (ij >= 0).all(1) & (ij < grid).all(1)
    ij, z = ij[ok], L[ok, 2]
    flat = ij[:, 1] * grid + ij[:, 0]
    dsm = np.full(grid * grid, -np.inf)
    np.maximum.at(dsm, flat, z)
    dtm = np.full(grid * grid, np.inf)
    np.minimum.at(dtm, flat, z)
    dsm, dtm = dsm.reshape(grid, grid), dtm.reshape(grid, grid)
    seen = np.isfinite(dsm)
    # holes take their nearest neighbour, outside the data the ground carries on flat
    idx = ndimage.distance_transform_edt(~seen, return_distances=False, return_indices=True)
    dsm, dtm = dsm[tuple(idx)], dtm[tuple(idx)]
    dist = ndimage.distance_transform_edt(~seen) * cell
    # bare earth: the lowest surface under a window wider than the widest tree or roof
    w = max(3, int(round(12.0 / cell)) | 1)
    dtm = ndimage.grey_opening(dtm, size=(w, w))
    dtm = ndimage.gaussian_filter(dtm, 2)
    dsm = ndimage.median_filter(dsm, 3)
    fade = np.clip(1 - (dist - 2) / 10, 0, 1)
    ground = float(np.percentile(dtm[seen], 10))
    dsm = ground + (dsm - ground) * fade
    dtm = ground + (dtm - ground) * fade
    out.mkdir(parents=True, exist_ok=True)
    # row 0 is the south edge, west to east, the way the web's height lookup counts
    (out / "dsm.f32").write_bytes((dsm - ground).astype("<f4").tobytes())
    (out / "dtm.f32").write_bytes((dtm - ground).astype("<f4").tobytes())

    # the orthophoto pulled into the levelled frame: each output pixel finds its ground point, then its pixel
    xs = (np.arange(tex) + 0.5) / tex * 2 * half - half
    X, Y = np.meshgrid(xs, xs[::-1])
    hz = ndimage.map_coordinates(dsm, [(Y + half) / cell - 0.5, (X + half) / cell - 0.5], order=1, mode="nearest")
    Q = np.stack([X, Y, hz], -1).reshape(-1, 3) @ R + c
    lon = lon0 + np.degrees(Q[:, 0] / (R_EARTH * math.cos(math.radians(lat0))))
    lat = lat0 + np.degrees(Q[:, 1] / R_EARTH)
    with rasterio.open(odm / "odm_orthophoto" / "odm_orthophoto.tif") as d:
        E, N = warp("EPSG:4326", d.crs, lon.tolist(), lat.tolist())
        col, row = ~d.transform * (np.asarray(E), np.asarray(N))
        bands = d.read([1, 2, 3, 4] if d.count >= 4 else [1, 2, 3])
    img = np.zeros((tex * tex, 3), np.uint8)
    inside = (col >= 0) & (row >= 0) & (col < bands.shape[2] - 1) & (row < bands.shape[1] - 1)
    for k in range(3):
        img[inside, k] = ndimage.map_coordinates(bands[k].astype(np.float32), [row[inside], col[inside]], order=1).clip(0, 255).astype(np.uint8)
    if bands.shape[0] == 4:
        alpha = np.zeros(tex * tex, np.float32)
        alpha[inside] = ndimage.map_coordinates(bands[3].astype(np.float32), [row[inside], col[inside]], order=1)
        inside &= alpha > 127
    img[~inside] = (58, 66, 52)
    Image.fromarray(img.reshape(tex, tex, 3)).save(out / "ortho.jpg", quality=90, optimize=True)

    when, from_photo = exif_time_and_place(photos)
    import importlib.util
    spec = importlib.util.spec_from_file_location("fri", ROOT / "scripts" / "fetch-real-imagery.py")
    fri = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fri)
    sun = None
    if when:
        az, el = fri.sun_position(when, lat0, lon0)
        sun = {"azimuth_deg": round(az, 2), "elevation_deg": round(el, 2), "at_utc": when.strftime("%Y-%m-%dT%H:%M:%SZ"),
               "method": f"NOAA solar position, EXIF GPS time of {from_photo}, the reference point"}
    meta = {
        "site": site,
        **CREDITS.get(site, {"title": site, "attribution": "your own photos", "licence": "yours"}),
        "kind": "reconstruction",
        "capture_utc": [when.strftime("%Y-%m-%dT%H:%M:%SZ")] * 2 if when else None,
        "frame": "metres from the middle of the data, levelled on the fitted ground plane, x east, y north, height above the ground",
        "levelling": {"tilt_deg": round(tilt, 2), "R": R.round(8).tolist(), "centre_topocentric": c.round(4).tolist(), "ground_z": ground},
        "grid": {"n": grid, "extent": 2 * half, "dsm": "dsm.f32", "dtm": "dtm.f32", "dtype": "float32 little endian, row 0 south, west to east"},
        "ortho": {"file": "ortho.jpg", "rect": [-half, -half, half, half], "px": [tex, tex]},
        "splat": None,
        "sun": sun,
        "shadow_ratio": [0.18, 0.22, 0.30],
        "dsm_range_m": [round(float(dsm.min() - ground), 2), round(float(dsm.max() - ground), 2)],
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=2))
    log(f"dem: levelled a {tilt:.1f} degree tilt, {grid}x{grid} over {2 * half:.0f} m, relief {meta['dsm_range_m'][0]:.1f} to {meta['dsm_range_m'][1]:.1f} m, ortho {tex} px")
    return meta


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("site")
    ap.add_argument("--photos", help="folder of geotagged photos, default data/real/<site>/photos")
    ap.add_argument("--from", dest="start", choices=STAGES, default="odm")
    ap.add_argument("--only", choices=STAGES)
    ap.add_argument("--quality", choices=["fast", "medium", "high"], default="medium")
    ap.add_argument("--odm-rerun-from", help="an OpenDroneMap stage to restart from, for example odm_meshing")
    ap.add_argument("--steps", type=int, default=12000, help="splat training steps")
    ap.add_argument("--max-splats", type=int, default=1_500_000)
    ap.add_argument("--keep", type=int, default=900_000, help="gaussians kept in the packed splat")
    ap.add_argument("--half", type=float, default=110.0, help="half size of the site square in metres")
    ap.add_argument("--no-splat", action="store_true", help="heights and orthophoto only, the way to run it on macOS and Linux")
    a = ap.parse_args()
    site_dir = DATA / a.site
    photos = Path(a.photos) if a.photos else site_dir / "photos"
    odm, colmap, splat_dir, out = site_dir / "odm", site_dir / "colmap", site_dir / "brush", site_dir / "site"
    todo = [a.only] if a.only else STAGES[STAGES.index(a.start):]
    if a.no_splat:
        todo = [st for st in todo if st not in ("splat", "pack")]
    # the pinned Brush build is Windows only, so say so before an hour of OpenDroneMap rather than after
    if ("splat" in todo or "pack" in todo) and sys.platform != "win32":
        sys.exit("The splat step uses Brush's Windows build. On macOS and Linux run with --no-splat and open ?ground=<site> without the splat layer")
    for st in todo:
        log("stage", st)
        if st == "odm":
            stage_odm(a.site, photos, odm, a.quality, a.odm_rerun_from)
        elif st == "colmap":
            stage_colmap(odm, colmap)
        elif st == "splat":
            stage_splat(colmap, splat_dir, a.steps, a.max_splats)
        elif st == "pack":
            if not (out / "meta.json").exists():
                stage_dem(a.site, odm, out, photos, a.half, 512, 4096)
            meta = json.loads((out / "meta.json").read_text())
            stage_pack(splat_dir, out / "site.splat", meta, a.keep)
            meta["splat"] = {"file": "site.splat", "bytes": (out / "site.splat").stat().st_size}
            (out / "meta.json").write_text(json.dumps(meta, indent=2))
        elif st == "dem":
            stage_dem(a.site, odm, out, photos, a.half, 512, 4096)
    log("done", out)


if __name__ == "__main__":
    main()
