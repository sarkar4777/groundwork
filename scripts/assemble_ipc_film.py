"""Joins the industrial PC story cut with the Abenix telemetry clip into the finished film.

    python scripts/assemble_ipc_film.py --abenix .run/ipc/abenix-telemetry-1920x1080.mp4 [--size 1920x1080]

The cut comes from node scripts/capture.mjs --ipc --out .run/ipc. The Abenix clip goes in where the story
cuts to Abenix, at 50 s on the story clock. Writes docs/media/groundwork-ipc-story-<size>.mp4 and .srt and
never replaces a file that is there.
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
    args = ap.parse_args()
    cut = Path(args.cut) if args.cut else ROOT / ".run" / "ipc" / "media" / f"groundwork-ipc-story-cut-{args.size}.mp4"
    clip = Path(args.abenix)
    out = Path(args.out_dir) / f"groundwork-ipc-story-{args.size}.mp4"
    srt_out = out.with_suffix(".srt")
    for p in (cut, clip):
        if not p.exists():
            sys.exit(f"missing {p}")
    for p in (out, srt_out):
        if p.exists():
            sys.exit(f"{p} is already there, it is never replaced. Move it away first if you mean to")
    join = OPENING + (CUT_AT - STORY_IN)
    clip_len = probe(clip)
    w, h = args.size.split("x")
    fc = (f"[0:v]trim=0:{join},setpts=PTS-STARTPTS[a];"
          f"[1:v]scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=0x04122b,fps=60,setsar=1,setpts=PTS-STARTPTS[b];"
          f"[0:v]trim=start={join},setpts=PTS-STARTPTS[c];[a][b][c]concat=n=3:v=1:a=0[v]")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(cut), "-i", str(clip), "-filter_complex", fc, "-map", "[v]",
                    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "60", "-movflags", "+faststart", str(out)],
                   check=True)
    cues = parse_srt(cut.with_suffix(".srt").read_text(encoding="utf-8"))
    fixed = []
    for a, b, text in cues:
        if a >= join:
            a, b = a + clip_len, b + clip_len
        elif b > join:
            b = join
        fixed.append((a, b, text))
    fixed.append((join, join + clip_len, ABENIX_CAPTION))
    fixed.sort()
    srt_out.write_text("\n".join(f"{i + 1}\n{srt_time(a)} --> {srt_time(b)}\n{t}\n" for i, (a, b, t) in enumerate(fixed)), encoding="utf-8")
    print(f"wrote {out} ({probe(out):.2f} s) and {srt_out}, Abenix from {join:.2f} s for {clip_len:.2f} s")


if __name__ == "__main__":
    main()
