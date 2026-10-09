"""Terrain: a procedural base plus an editable cut and fill grid the machines really change."""

from __future__ import annotations

import base64
import math
import struct
import zlib
from array import array

from . import layout as L

N = 64                 # edit grid, 3.125 m cells
CELL = L.SIZE / N
OUT_N = 256            # heightmap served to the browser
HALF = L.SIZE / 2

_base_cache: dict[int, list] = {}


def base_height(x: float, y: float) -> float:
    return 0.35 * math.sin(x / 37.0) * math.cos(y / 41.0) + 0.2 * math.sin((x + y) / 23.0) + 0.004 * (x - y)


def idx(x: float, y: float) -> tuple[int, int]:
    i = int((x + HALF) / CELL)
    j = int((y + HALF) / CELL)
    return min(N - 1, max(0, i)), min(N - 1, max(0, j))


def cell_centre(i: int, j: int) -> tuple[float, float]:
    return -HALF + (i + 0.5) * CELL, -HALF + (j + 0.5) * CELL


def initial_delta() -> array:
    """Shift start: the pit already 3 m down with a ramp up to the south-east."""
    d = array("h", [0] * (N * N))
    x0, y0, x1, y1 = L.PIT
    for j in range(N):
        for i in range(N):
            x, y = cell_centre(i, j)
            if x0 <= x <= x1 and y0 <= y <= y1:
                depth = -3.0 - base_height(x, y)
                if x < -20 and y > 0:
                    depth -= 1.2
                d[j * N + i] = int(depth * 100)
            # ramp from the pit floor up to the haul road
            rx, ry = L.NODES["ramp_bot"]
            tx, ty = L.NODES["ramp_top"]
            vx, vy = tx - rx, ty - ry
            ln = math.hypot(vx, vy)
            u = ((x - rx) * vx + (y - ry) * vy) / (ln * ln)
            px, py = rx + u * vx, ry + u * vy
            if -0.05 <= u <= 1.0 and math.hypot(x - px, y - py) < 6.0:
                z = -3.0 * (1.0 - max(0.0, u))
                d[j * N + i] = int((z - base_height(x, y)) * 100)
    return d


def encode(d: array) -> str:
    return base64.b64encode(zlib.compress(d.tobytes(), 6)).decode()


def decode(s: str) -> array:
    d = array("h")
    d.frombytes(zlib.decompress(base64.b64decode(s)))
    return d


def height(d: array, x: float, y: float) -> float:
    fx = (x + HALF) / CELL - 0.5
    fy = (y + HALF) / CELL - 0.5
    i0 = min(N - 2, max(0, int(fx)))
    j0 = min(N - 2, max(0, int(fy)))
    tx = min(1.0, max(0.0, fx - i0))
    ty = min(1.0, max(0.0, fy - j0))
    a = d[j0 * N + i0]
    b = d[j0 * N + i0 + 1]
    c = d[(j0 + 1) * N + i0]
    e = d[(j0 + 1) * N + i0 + 1]
    v = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty
    return base_height(x, y) + v / 100.0


def cut(d: array, x: float, y: float, m3: float) -> float:
    """Remove up to m3 at (x, y), never below the design surface. Returns what was removed."""
    i, j = idx(x, y)
    cx, cy = cell_centre(i, j)
    z = base_height(cx, cy) + d[j * N + i] / 100.0
    room = z - L.DESIGN_Z
    if room <= 0.01:
        return 0.0
    dz = min(room, m3 / (CELL * CELL))
    d[j * N + i] -= int(round(dz * 100))
    return dz * CELL * CELL


def fill(d: array, x: float, y: float, m3: float, spread: int = 1) -> None:
    i, j = idx(x, y)
    cells = [(a, b) for a in range(i - spread, i + spread + 1) for b in range(j - spread, j + spread + 1) if 0 <= a < N and 0 <= b < N]
    dz = m3 / (CELL * CELL * len(cells))
    for a, b in cells:
        d[b * N + a] += int(round(dz * 100))


def level(d: array, x: float, y: float, target_z: float, rate: float) -> bool:
    """Dozer blade: move material from a high cell to its lowest neighbour toward target_z."""
    i, j = idx(x, y)
    k = j * N + i
    cx, cy = cell_centre(i, j)
    z = base_height(cx, cy) + d[k] / 100.0
    if z <= target_z + 0.05:
        return False
    best = None
    for a, b in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)):
        if 0 <= a < N and 0 <= b < N and L.in_rect(L.SPOIL, *cell_centre(a, b)):
            kk = b * N + a
            zz = base_height(*cell_centre(a, b)) + d[kk] / 100.0
            if best is None or zz < best[0]:
                best = (zz, kk)
    if best is None or best[0] >= z - 0.05:
        return False
    move = int(min(rate, (z - best[0]) / 2) * 100)
    if move <= 0:
        return False
    d[k] -= move
    d[best[1]] += move
    return True


def base_grid() -> list:
    g = _base_cache.get(OUT_N)
    if g is None:
        step = L.SIZE / OUT_N
        g = [base_height(-HALF + (i + 0.5) * step, -HALF + (j + 0.5) * step) for j in range(OUT_N) for i in range(OUT_N)]
        _base_cache[OUT_N] = g
    return g


def _upsample(d: array) -> list:
    out = [0.0] * (OUT_N * OUT_N)
    r = OUT_N // N
    for j in range(OUT_N):
        fy = (j + 0.5) / r - 0.5
        j0 = min(N - 2, max(0, int(fy)))
        ty = min(1.0, max(0.0, fy - j0))
        row0 = j0 * N
        row1 = row0 + N
        base = j * OUT_N
        for i in range(OUT_N):
            fx = (i + 0.5) / r - 0.5
            i0 = min(N - 2, max(0, int(fx)))
            tx = min(1.0, max(0.0, fx - i0))
            out[base + i] = ((d[row0 + i0] * (1 - tx) + d[row0 + i0 + 1] * tx) * (1 - ty)
                             + (d[row1 + i0] * (1 - tx) + d[row1 + i0 + 1] * tx) * ty) / 100.0
    return out


def export(d: array, initial: array) -> dict:
    """256 x 256 float16 little-endian heights and the cut and fill since shift start."""
    up = _upsample(d)
    up0 = _upsample(initial)
    base = base_grid()
    heights = [b + u for b, u in zip(base, up)]
    delta = [u - u0 for u, u0 in zip(up, up0)]
    hb = struct.pack(f"<{len(heights)}e", *heights)
    db = struct.pack(f"<{len(delta)}e", *delta)
    cut_m3 = -sum(min(0.0, (d[k] - initial[k]) / 100.0) for k in range(N * N)) * CELL * CELL
    fill_m3 = sum(max(0.0, (d[k] - initial[k]) / 100.0) for k in range(N * N)) * CELL * CELL
    return {
        "n": OUT_N,
        "extent": L.SIZE,
        "encoding": "float16 little-endian, row-major from the south-west corner, base64",
        "heights": base64.b64encode(hb).decode(),
        "delta": base64.b64encode(db).decode(),
        "cut_m3": round(cut_m3, 1),
        "fill_m3": round(fill_m3, 1),
        "design_z": L.DESIGN_Z,
    }
