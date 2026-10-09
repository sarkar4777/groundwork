"""Record a live run of Story mode so later takes replay the same agent and model answers.

Every agent, pipeline and model answer in the recording comes from a real Abenix call made during
this run. The bff writes them to bff/story_cache/story.json when the story finishes.

    python scripts/record_story.py             # you approve on the phone view or in Abenix
    python scripts/record_story.py --approve   # you approve now, from this script, as the operator
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time

import httpx
import websockets

BFF = "http://localhost:8710"


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--approve", action="store_true", help="approve each request as the operator running the recording")
    ap.add_argument("--bff", default=BFF)
    args = ap.parse_args()
    ws_url = args.bff.replace("http", "ws", 1) + "/ws"
    async with httpx.AsyncClient(base_url=args.bff, timeout=60) as h, websockets.connect(ws_url, max_size=None) as ws:
        r = await h.post("/story/start", json={"mode": "record"})
        print("start", r.status_code, r.text)
        t0 = time.time()
        while time.time() - t0 < 600:
            m = json.loads(await ws.recv())
            kind = m["type"]
            if kind in ("caption", "event", "agent"):
                text = m.get("text") or m.get("title") or ""
                print(f"{m.get('t', 0):7.2f} {kind:<8} {m.get('kind') or m.get('agent') or ''} {m.get('phase', '')} {text[:140]}")
            if kind == "agent" and m.get("phase") == "waiting_approval" and args.approve:
                await asyncio.sleep(2.0)
                r = await h.post("/approve", json={"execution_id": m.get("execution_id"), "decision": "approve", "approved": True,
                                                    "by": "the operator running scripts/record_story.py --approve"})
                print("         approve", r.status_code, r.text[:200])
            if kind == "event" and m.get("kind") == "story" and m.get("title") == "Recording saved":
                print("recorded to bff/story_cache/story.json")
                return
    print("story did not finish within 10 minutes")


if __name__ == "__main__":
    asyncio.run(main())
