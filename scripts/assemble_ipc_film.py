"""Joins the industrial PC story cut with the Abenix telemetry clip into the finished film.

    python scripts/assemble_ipc_film.py --abenix .run/ipc/abenix-telemetry-1920x1080.mp4 [--loop auto] [--size 1920x1080]

The cut comes from node scripts/capture.mjs --ipc --out .run/ipc, the loop clip from capture.mjs --loop. Both go in
where the story cuts away at 50 s on the story clock: the closed loop first, then Abenix, each join a short dip through black.
Writes docs/media/<name>-<size>.mp4 and .srt, groundwork-ipc-story unless --name says otherwise, and never replaces a
file that is there.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OPENING = 6.3 - 1.0
STORY_IN = 0.3
CUT_AT = 50.0
ABENIX_CAPTION = "In Abenix every PC is a device, with live graphs, history and the raw frames."
# a dip through black, so two scenes' cards and captions never sit on top of each other
DISSOLVE = 0.6


def probe(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
                         capture_output=True, text=True, check=True).stdout
    return float(json.loads(out)["format"]["duration"])


def srt_time(s: float) -> str:
    ms = int(round(s * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def parse_srt(text: str) -> list[tuple[float, float, str]]:
    cues = []
    for block in text.strip().split("\n\n"):
        lines = block.splitlines()
        if len(lines) < 3:
            continue
        a, b = (re.sub(r"[,.]", ".", x.strip()) for x in lines[1].split("-->"))
        t = [sum(float(p) * m for p, m in zip(x.split(":"), (3600, 60, 1))) for x in (a, b)]
        cues.append((t[0], t[1], "\n".join(lines[2:])))
    return cues


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--abenix", required=True, help="the Abenix telemetry clip, same size as the cut")
    ap.add_argument("--size", default="1920x1080")
    ap.add_argument("--cut", default="")
    ap.add_argument("--out-dir", default=str(ROOT / "docs" / "media"))
    ap.add_argument("--loop", default="", help="the closed loop clip, auto for .run/ipc/media/<cut-name>-<size>.mp4")
    ap.add_argument("--name", default="groundwork-ipc-story", help="the film's name, groundwork-ipc-real-story for the real-ground cut")
    args = ap.parse_args()
    stem = args.name.replace("-story", "")
    media = ROOT / ".run" / "ipc" / "media"
    cut = Path(args.cut) if args.cut else media / f"{stem}-story-cut-{args.size}.mp4"
    clip = Path(args.abenix)
    loop = Path(args.loop) if args.loop and args.loop != "auto" else (media / f"{stem}-loop-cut-{args.size}.mp4" if args.loop else None)
    out = Path(args.out_dir) / f"{args.name}-{args.size}.mp4"
    srt_out = out.with_suffix(".srt")
    for p in (cut, clip) + ((loop,) if loop else ()):
        if not p.exists():
            sys.exit(f"missing {p}")
    for p in (out, srt_out):
        if p.exists():
            sys.exit(f"{p} is already there, it is never replaced. Move it away first if you mean to")
    join = OPENING + (CUT_AT - STORY_IN)
    cut_len = probe(cut)
    clip_len = probe(clip)
    loop_len = probe(loop) if loop else 0.0
    w, h = args.size.split("x")
    fit = f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=0x04122b,fps=60,setsar=1,format=yuv420p,setpts=PTS-STARTPTS"
    # the parts in order with their lengths, each dissolves into the next
    parts = [("a", join)] + ([("l", loop_len)] if loop else []) + [("b", clip_len), ("c", cut_len - join)]
    fc = f"[0:v]trim=0:{join},fps=60,format=yuv420p,setpts=PTS-STARTPTS[a];[0:v]trim=start={join},fps=60,format=yuv420p,setpts=PTS-STARTPTS[c];"
    fc += (f"[2:v]{fit}[l];" if loop else "") + f"[1:v]{fit}[b];"
    starts, at, prev = {}, 0.0, "a"
    starts["a"] = 0.0
    for i, (name, length) in enumerate(parts[1:], 1):
        at += parts[i - 1][1] - DISSOLVE
        starts[name] = at
        tag = "v" if i == len(parts) - 1 else f"x{i}"
        fc += f"[{prev}][{name}]xfade=transition=fadeblack:duration={DISSOLVE}:offset={at:.3f}[{tag}];"
        prev = tag
    inputs = ["-i", str(cut), "-i", str(clip)] + (["-i", str(loop)] if loop else [])
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", fc.rstrip(";"), "-map", "[v]",
                    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "60", "-movflags", "+faststart", str(out)],
                   check=True)
    fixed = []
    for a, b, text in parse_srt(cut.with_suffix(".srt").read_text(encoding="utf-8")):
        if a >= join:
            a, b = starts["c"] + a - join, starts["c"] + b - join
        else:
            b = min(b, join - DISSOLVE)
        fixed.append((a, b, text))
    if loop:
        for a, b, text in parse_srt(loop.with_suffix(".srt").read_text(encoding="utf-8")):
            fixed.append((starts["l"] + a, starts["l"] + min(b, loop_len - DISSOLVE), text))
    fixed.append((starts["b"] + DISSOLVE, starts["b"] + clip_len - DISSOLVE, ABENIX_CAPTION))
    fixed.sort()
    # one caption at a time
    for i in range(len(fixed) - 1):
        a, b, t = fixed[i]
        fixed[i] = (a, min(b, fixed[i + 1][0]), t)
    fixed = [c for c in fixed if c[1] - c[0] > 0.2]
    srt_out.write_text("\n".join(f"{i + 1}\n{srt_time(a)} --> {srt_time(b)}\n{t}\n" for i, (a, b, t) in enumerate(fixed)), encoding="utf-8")
    print(f"wrote {out} ({probe(out):.2f} s) and {srt_out}, loop {loop_len:.2f} s from {starts.get('l', 0):.2f} s, Abenix {clip_len:.2f} s from {starts['b']:.2f} s")


if __name__ == "__main__":
    main()
