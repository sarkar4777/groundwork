#!/usr/bin/env python3
"""Package the prepared real-site tiles for a GitHub Release or a Hugging Face dataset. Uploads nothing.

    python scripts/publish-real-assets.py                  # every prepared site, tag real-assets-v1
    python scripts/publish-real-assets.py --tag real-assets-v2 --sites nh108

Writes dist/real-assets/<tag>/: the files flat (GitHub Releases has no folders), manifest.json with each
file's site, path, size, SHA-256, licence and attribution, SHA256SUMS, and UPLOAD.md with the commands the
owner can run. scripts/fetch-real-imagery.py reads the manifest from the release URL and falls back to the
original sources when there is no release yet.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "real"
REPO = "sarkar4777/groundwork"

# what each site ships, relative to data/real/<site>/
SHIPS = {
    "nh108": ["meta.json", "detail.jpg", "surround.jpg", "scale.jpg"],
    "caliterra": ["site/meta.json", "site/dsm.f32", "site/dtm.f32", "site/ortho.jpg", "site/site.splat"],
}


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def credit(site: str) -> dict:
    for meta in (DATA / site / "meta.json", DATA / site / "site" / "meta.json"):
        if meta.exists():
            m = json.loads(meta.read_text())
            return {k: m.get(k) for k in ("title", "attribution", "licence", "licence_url", "page")}
    return {}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tag", default="real-assets-v1")
    ap.add_argument("--sites", default=",".join(SHIPS))
    ap.add_argument("--out", default=str(ROOT / "dist" / "real-assets"))
    a = ap.parse_args()
    out = Path(a.out) / a.tag
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    files, sites, missing = [], {}, []
    for site in a.sites.split(","):
        sites[site] = credit(site)
        for rel in SHIPS[site]:
            src = DATA / site / rel
            if not src.exists():
                missing.append(f"{site}/{rel}")
                continue
            flat = f"{site}__{rel.replace('/', '__')}"
            shutil.copy2(src, out / flat)
            files.append({"name": flat, "site": site, "path": rel, "bytes": src.stat().st_size, "sha256": sha256(src)})
    manifest = {
        "tag": a.tag,
        "created_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "note": "Prepared tiles for Groundwork's real ground. Each site keeps the licence and attribution of its source.",
        "sites": sites,
        "files": files,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8", newline="\n")
    (out / "SHA256SUMS").write_text("".join(f"{f['sha256']}  {f['name']}\n" for f in files), encoding="utf-8", newline="\n")
    total = sum(f["bytes"] for f in files)
    (out / "UPLOAD.md").write_text(f"""# Upload {a.tag}

Nothing has been uploaded. These are the commands, for the owner to run.

GitHub Release, which the fetch script reads by default:

    gh release create {a.tag} --repo {REPO} --title "Real ground tiles {a.tag}" --notes-file manifest.json \\
      {' '.join(f['name'] for f in files)} manifest.json SHA256SUMS

Hugging Face dataset, as an alternative:

    huggingface-cli upload {REPO.split('/')[0]}/groundwork-real-assets . . --repo-type dataset

Then fetch from it:

    python scripts/fetch-real-imagery.py --release https://github.com/{REPO}/releases/download/{a.tag}

{len(files)} files, {total / 1e6:.1f} MB.
""", encoding="utf-8", newline="\n")
    print(f"packaged {len(files)} files, {total / 1e6:.1f} MB, into {out}")
    for m in missing:
        print("  not prepared yet, skipped:", m)


if __name__ == "__main__":
    main()
