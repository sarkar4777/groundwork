"""HTTP and websocket surface of the bff, port 8710."""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "bff" / "vendor"))

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from .engine import Engine  # noqa: E402
from .hub import Hub  # noqa: E402
from .story import Story  # noqa: E402

logging.basicConfig(level=os.environ.get("GW_LOG", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)


def load_env() -> None:
    p = ROOT / ".env"
    if p.exists():
        for line in p.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def config() -> dict:
    load_env()
    return {
        "abenix_url": os.environ.get("ABENIX_URL", "http://localhost:8000").rstrip("/"),
        "abenix_web": os.environ.get("ABENIX_WEB_URL", "http://localhost:3000").rstrip("/"),
        "api_key": os.environ.get("ABENIX_API_KEY", ""),
        "seed": int(os.environ.get("GW_SEED", "42")),
        # northgate is the rendered site, nh108 the same work on a real orthophoto
        "site": os.environ.get("GW_SITE", "northgate"),
        "rate_hz": float(os.environ.get("GW_RATE_HZ", "20")),
        "dispatch_s": float(os.environ.get("GW_DISPATCH_S", "10")),
        "shift_minutes": float(os.environ.get("GW_SHIFT_MINUTES", "60")),
        "shift_start": os.environ.get("GW_SHIFT_START", "1") == "1",
        "bus_budget": int(os.environ.get("GW_BUS_PER_STEP", "12")),
        # in-cluster the step keeps up with 20 Hz, so every step is 5 ticks of 10 ms
        "fixed_ticks": int(os.environ.get("GW_FIXED_TICKS", "0")),
    }


hub = Hub()
engine: Engine | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global engine
    cfg = config()
    if not cfg["api_key"]:
        logging.error("ABENIX_API_KEY is not set. Run python scripts/provision.py first.")
    engine = Engine(cfg, hub)
    engine.task = asyncio.create_task(engine.run())
    yield
    engine.task.cancel()
    await engine.forge.close()


app = FastAPI(title="Groundwork bff", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _err(msg: str, code: int = 503) -> JSONResponse:
    return JSONResponse({"ok": False, "error": msg}, status_code=code)


@app.websocket("/ws")
async def ws(sock: WebSocket):
    await hub.add(sock)
    try:
        if engine and engine.site:
            pass
        if engine and engine.plan:
            await sock.send_json(engine.plan)
        while True:
            await sock.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        hub.drop(sock)


@app.get("/health")
async def health():
    if engine is None:
        return _err("starting")
    h = engine.health()
    try:
        r = await engine.forge.http.get("/api/health", timeout=3)
        h["abenix"] = r.status_code == 200
    except Exception as e:  # noqa: BLE001
        h["abenix"] = False
        h["abenix_error"] = str(e)[:200]
    h["clients"] = len(hub.clients)
    return h


@app.get("/site")
async def site():
    if not engine or not engine.ready:
        return _err("twin not running yet")
    if engine.site is None:
        engine.site = await engine.twin({"op": "site"})
    return engine.site


@app.get("/terrain")
async def terrain(rev: int | None = None):
    if not engine or not engine.ready:
        return _err("twin not running yet")
    try:
        return await engine.terrain(rev)
    except Exception as e:  # noqa: BLE001
        return _err(str(e)[:300])


@app.get("/fleet")
async def fleet():
    if not engine or not engine.ready:
        return _err("twin not running yet")
    if engine.aemp is None:
        engine.aemp = await engine.twin({"op": "aemp", "state_z": engine.state_z})
    return engine.aemp


@app.post("/fault")
async def fault(req: Request):
    if not engine or not engine.ready:
        return _err("twin not running yet")
    body = await req.json()
    extra = {k: v for k, v in body.items() if k not in ("kind", "target")}
    return await engine.fault(body.get("kind", ""), body.get("target"), extra)



SITES = ("northgate", "nh108")

@app.post("/story/start")
async def story_start(req: Request):
    if not engine or not engine.ready:
        return _err("twin not running yet")
    try:
        body = await req.json()
    except Exception:  # noqa: BLE001
        body = {}
    mode = body.get("mode") or ("cached" if Story.available() and body.get("cached", True) else "live")
    if mode == "cached" and not Story.available():
        return _err("no recorded story, run python scripts/record_story.py or start with mode live", 409)
    site = body.get("site") or engine.cfg.get("site") or "northgate"
    if site not in SITES:
        return _err(f"unknown site {site}, one of {', '.join(SITES)}", 400)
    s = Story(mode, int(body.get("ticks") or os.environ.get("GW_STORY_TICKS", "5")), site)
    try:
        await s.start(engine)
    except Exception as e:  # noqa: BLE001
        return _err(f"could not start the story in Abenix: {e}"[:300], 502)
    return {"ok": True, "mode": mode, "seed": 2026, "site": site}


@app.post("/story/stop")
async def story_stop():
    if engine and engine.story:
        engine.story = None
        await engine.event("story", "Story stopped", "Back to the live site")
    return {"ok": True}


@app.post("/approve")
async def approve(req: Request):
    if not engine:
        return _err("starting")
    body = await req.json()
    key = body.get("execution_id") or body.get("approval_id") or ""
    ok = body.get("approved")
    if ok is None:
        ok = body.get("decision", "approve") in ("approve", "approved")
    try:
        return await engine.decide(key, bool(ok), str(body.get("by") or "a person on the Groundwork phone view")[:120])
    except Exception as e:  # noqa: BLE001
        return _err(str(e)[:300], 502)


@app.get("/agents")
async def agents():
    if not engine or not engine.ready:
        return _err("twin not running yet")
    try:
        return {"agents": await engine.agents_view()}
    except Exception as e:  # noqa: BLE001
        return _err(str(e)[:300], 502)
