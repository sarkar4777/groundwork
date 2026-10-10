"""Story mode: the 60 s day from PLAN.md section 13.

The bff only keeps the script clock and the captions. Every beat is a real Abenix call. With a
recording from scripts/record_story.py the agent and model answers of that recorded run are
replayed at fixed times, so every take is identical, and the frames say they are recorded.
"""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

CACHE = Path(__file__).resolve().parents[1] / "story_cache" / "story.json"
SPEC = Path(__file__).resolve().parents[2] / "abenix" / "specs"
SEED = 2026

CAPTIONS = [
    (0.0, 4.0, "A construction site that runs itself. Every machine, every decision, on Abenix."),
    (4.0, 9.0, "A worker walks into the swing zone. The safety layer stops the excavator in {stop_ms} ms."),
    (9.0, 14.0, "Seconds later the AI replans the site and asks a person to approve."),
    (14.0, 21.0, "Underneath, {vecus} machine controllers talk on real machine buses at 100 times a second."),
    (21.0, 28.0, "A gust is forecast. The crane holds. The plan changes around it."),
    (28.0, 35.0, "We switch the AI off. The site stays safe, because safety never waits for the AI."),
    (35.0, 44.0, "A new machine arrives. The AI writes its controller, tests it, and puts it to work."),
    (44.0, 52.0, "Agents earn trust from their record. Mistakes become lessons a person approves."),
    (52.0, 60.0, "Groundwork. Built on Abenix, open source."),
]

# replay times for recorded answers, inside the caption windows they belong to
CACHED_TIMES = {
    "replan": {"thinking": 5.0, "answer": 9.2, "waiting": 9.6, "approved": 12.2},
    "weather": {"thinking": 22.0, "answer": 25.5},
    "vecu": {"thinking": 35.4, "answer": 39.0, "approved": 39.6},
    "autonomy": {"event": 45.0},
    "near_miss": {"answer": 47.0, "lesson": 48.5},
}


class Story:
    def __init__(self, mode: str, ticks: int = 5, site: str = "northgate"):
        self.mode = mode          # live, cached or record
        self.site = site
        self.cache = json.loads(CACHE.read_text()) if mode == "cached" else None
        # ticks of 10 ms per step, a recording replays with the ticks it was made with
        self.ticks = int((self.cache or {}).get("ticks") or ticks)
        self.rec = {"seed": SEED, "ticks": self.ticks, "ml": {}, "beats": {}} if mode == "record" else None
        self.step0 = None
        self.k = 0
        self.done_caps: set = set()
        self.fired: set = set()
        self.stop_ms = None
        self.vecus = 45
        self.started = time.monotonic()
        self.finished = False
        self.tasks: list = []
        self.gust_forecast = None

    def info(self) -> dict:
        return {"mode": self.mode, "step": self.k, "ticks": self.ticks, "recorded_at": (self.cache or {}).get("recorded_at"), "finished": self.finished}

    @staticmethod
    def available() -> bool:
        return CACHE.exists()

    def st(self, eng) -> float:
        return eng.t()

    async def start(self, eng) -> None:
        eng.paused = True
        try:
            await eng.init_twin(SEED, self.site)
            eng.frame = None
            eng.plan = None
            eng.story = self
        finally:
            eng.paused = False
        note = "live Abenix calls"
        if self.mode == "cached":
            note = f"agent and model answers replayed from a recorded run on {self.cache.get('recorded_at', '?')}"
        elif self.mode == "record":
            note = "live Abenix calls, recorded for identical takes"
        await eng.emit({"type": "event", "t": 0.0, "kind": "story", "title": "Story started", "detail": f"Seed {SEED}, {note}",
                        "mode": self.mode, "recorded": self.mode == "cached", "site": self.site})

    async def before_step(self, eng, inp: dict) -> None:
        # the twin's own clock, it only moves when a step really ran in Abenix
        t = round(eng.t(), 3)
        self.k = int(round(t / (self.ticks * 0.01)))
        if self.mode == "cached":
            ml = (self.cache.get("ml") or {}).get(str(self.k))
            if ml:
                inp.setdefault("ml_results", {}).update(ml)
        for start, until, text in CAPTIONS:
            if t >= start - 1e-6 and start not in self.done_caps:
                if "{stop_ms}" in text and self.stop_ms is None and t < start + 2.0:
                    continue
                self.done_caps.add(start)
                if "{stop_ms}" in text:
                    text = text.replace("in {stop_ms} ms", f"in {self.stop_ms:.1f} ms" if self.stop_ms is not None else "in milliseconds")
                text = text.format(vecus=self.vecus)
                await eng.emit({"type": "caption", "t": t, "text": text, "until": until, "recorded": self.mode == "cached"})
        await self.beats(eng, t, inp)

    def once(self, name: str, t: float, at: float) -> bool:
        if name in self.fired or t < at:
            return False
        self.fired.add(name)
        return True

    async def beats(self, eng, t: float, inp: dict) -> None:
        if self.once("worker", t, 1.9):
            eng.queue("faults", {"kind": "worker_in_swing", "target": "EX1", "worker": "W07", "start_m": 17.5, "speed": 1.6})
        if self.once("nervous", t, 14.0):
            await eng.event("story", "Nervous system view", f"{self.vecus} vECUs at 100 Hz, J1939 and Sparkplug B")
        if self.once("gust", t, 18.0):
            eng.queue("faults", {"kind": "gust", "build_s": 5.0, "hold_s": 6.0, "peak_ms": 11.5})
        if self.once("ai_off", t, 28.0):
            await eng.fault("ai_offline", None, {"on": True})
        if self.once("ai_on", t, 34.6):
            await eng.fault("ai_offline", None, {"on": False})
        if self.mode == "cached":
            await self.cached_beats(eng, t)
        else:
            if "replan_live" not in self.fired and self.stop_ms is not None:
                self.fired.add("replan_live")
                self.track(eng, self.live_replan(eng))
            if self.once("weather_live", t, 21.5):
                self.track(eng, self.live_weather(eng))
            if self.once("vecu_live", t, 35.2):
                self.track(eng, self.live_vecu(eng))
            if self.once("autonomy_live", t, 44.5):
                self.track(eng, self.live_autonomy(eng))
        if self.once("end", t, 60.0):
            self.finished = True
            await eng.event("story", "Story finished", "Groundwork on Abenix, open source")
            if self.rec is not None:
                eng.spawn(self.finalize(eng))
            eng.story = None
            eng.wall0 = time.monotonic()
            eng.sim0 = eng.t()

    async def after_step(self, eng, out: dict) -> None:
        for e in out.get("events") or []:
            if e.get("kind") == "safety_stop" and e.get("machine") == "EX1" and self.stop_ms is None:
                self.stop_ms = float(e.get("ms") or 0)
                self.stop_event = e
            if e.get("kind") == "gust" and e.get("forecast_ms") and self.gust_forecast is None:
                self.gust_forecast = float(e["forecast_ms"])
        self.vecus = (out.get("stats") or {}).get("vecus", self.vecus) if self.k < 50 else self.vecus

    def track(self, eng, coro) -> None:
        t = asyncio.create_task(coro)
        self.tasks.append(t)
        eng.bg.add(t)
        t.add_done_callback(eng._done)

    async def finalize(self, eng) -> None:
        """Agent runs can outlast the 60 s, the recording waits for them."""
        pending = [t for t in self.tasks if not t.done()]
        if pending:
            await eng.event("story", "Waiting for Abenix runs to finish before saving", f"{len(pending)} still running")
            await asyncio.wait(pending, timeout=600)
        # an approval asked for during the take is part of it, give the person time to answer
        for _ in range(240):
            waiting = [b for b in (self.rec["beats"].get("replan"), self.rec["beats"].get("vecu"))
                       if b and (eng.approvals.get(b.get("execution_id")) or {}).get("status") == "pending"]
            if not waiting:
                break
            await asyncio.sleep(0.5)
        for name in ("replan", "vecu"):
            b = self.rec["beats"].get(name)
            if b:
                r = eng.approvals.get(b.get("execution_id")) or {}
                b["approval"] = r.get("status")
                b["approved_by"] = r.get("approved_by") or ("Approved by a person in Abenix" if r.get("status") == "approved" else None)
        self.save()
        await eng.event("story", "Recording saved", f"{len(self.rec['beats'])} beats, {len(self.rec['ml'])} steps with model answers")

    def record_ml(self, eng, name: str, res: dict) -> None:
        if self.rec is not None and not self.finished:
            self.rec["ml"].setdefault(str(self.k), {})[name] = res

    def save(self) -> None:
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        self.rec["recorded_at"] = time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())
        CACHE.write_text(json.dumps(self.rec, indent=1))

    # live beats, every one a real Abenix run

    async def live_replan(self, eng) -> None:
        e = getattr(self, "stop_event", {}) or {}
        self.track(eng, self.live_near_miss(eng, e))
        br = await eng.brief()
        msg = json.dumps({"reason": "safety_stop", "event": {k: e.get(k) for k in ("machine", "title", "detail", "worker", "ms")},
                          "brief": br, "plan": (br or {}).get("plan_tree")})
        out, res = await eng.run_agent("gw-site-superintendent", msg, label="Replanning after the safety stop")
        if not isinstance(out, dict) or "tree" not in out:
            return
        await eng.agent_frame("gw-site-superintendent", "answer", out.get("summary", ""), res.execution_id, changes=out.get("changes"))
        if self.rec is not None:
            self.rec["beats"]["replan"] = {"out": out, "execution_id": res.execution_id, "duration_ms": res.duration_ms, "cost": res.cost,
                                           "tools": [tc.get("name") for tc in res.tool_calls or []]}
        await eng.propose_plan(out, res.execution_id, "gw-site-superintendent")

    async def live_near_miss(self, eng, e: dict) -> None:
        out = await eng.near_miss(e)
        if self.rec is not None and isinstance(out, dict):
            self.rec["beats"]["near_miss"] = {"out": out}

    async def live_weather(self, eng) -> None:
        # the gust nowcast model's own forecast, or the measured crane wind when the model has not called it yet
        fc = self.gust_forecast
        if fc is None:
            br = await eng.brief()
            fc = ((br or {}).get("weather") or {}).get("gust_forecast_ms")
        if fc is None:
            tc = next((c for c in (eng.frame or {}).get("cranes", []) if c["id"] == "TC1"), {})
            fc = tc.get("wind_ms")
        out = await eng.weather_hold({"forecast_ms": fc})
        if self.rec is not None and isinstance(out, dict):
            self.rec["beats"]["weather"] = {"out": out}

    async def live_vecu(self, eng) -> None:
        spec = (SPEC / "telehandler.md").read_text()
        tests = json.loads((SPEC / "telehandler_tests.json").read_text())
        out, res = await eng.run_agent("gw-vecu-builder", json.dumps({"spec": spec, "tests": tests}), label="Writing the TH1 boom controller")
        if not isinstance(out, dict) or not out.get("source"):
            return
        passed = out.get("tests_passed") == out.get("tests_total") and out.get("tests_total")
        await eng.agent_frame("gw-vecu-builder", "answer", f"TH1 boom controller, {out.get('tests_passed')} of {out.get('tests_total')} golden tests pass",
                              res.execution_id, source=out.get("source"))
        if self.rec is not None:
            self.rec["beats"]["vecu"] = {"out": out, "execution_id": res.execution_id}
        if passed:
            await self.propose_telehandler(eng, out, res.execution_id)

    async def propose_telehandler(self, eng, out: dict, execution_id: str | None) -> None:
        d = await eng.forge.actions.propose("gw.plan.change", {"topic": "gw/plan/add-machine", "machine": "TH1", "summary": "Put TH1 to work"},
                                            agent_id=eng.ids.get("gw-vecu-builder"), target="TH1", intent="New telehandler, controller passed its golden tests")
        rec = {"kind": "telehandler", "agent": "gw-vecu-builder", "code": out["source"], "action_id": d.get("action_id"),
               "approval_id": d.get("approval_id"), "status": "pending", "plan": {"summary": "Put TH1 to work", "execution_id": execution_id}}
        if d.get("decision") == "run":
            await eng.apply_plan(rec, "Earned Autonomy")
            return
        if d.get("decision") == "watching":
            ap = await eng.forge.approvals.create("Put TH1 to work with its AI-written controller", {"tests": f"{out.get('tests_passed')}/{out.get('tests_total')}"},
                                                  gate_kind="gw.plan.change", agent_id=eng.ids.get("gw-vecu-builder"), agent_execution_id=execution_id)
            rec["approval_id"] = ap.get("id") or ap.get("approval_id")
        key = execution_id or rec["approval_id"]
        eng.approvals[key] = rec
        await eng.agent_frame("gw-vecu-builder", "waiting_approval", "Put TH1 to work? Controller passed its golden tests", key, approval_id=rec["approval_id"])
        eng.spawn(eng.wait_approval(key))

    async def live_autonomy(self, eng) -> None:
        try:
            view = await eng.agents_view()
        except Exception as e:  # noqa: BLE001
            await eng.event("autonomy", "Autonomy ladder unavailable", str(e)[:200])
            return
        d = next((a for a in view if a["name"] == "gw-fleet-dispatcher"), None)
        if d:
            act = (d.get("actions") or [{}])[0]
            detail = f"{d['level']}. {d.get('record') or ''}. Next step needs: {', '.join(act.get('requirements') or []) or 'nothing more'}"
            await eng.event("autonomy", f"Fleet Dispatcher: {d['level']}", detail, agent="gw-fleet-dispatcher", level=d["level"])
            if self.rec is not None:
                self.rec["beats"]["autonomy"] = {"title": f"Fleet Dispatcher: {d['level']}", "detail": detail, "level": d["level"]}

    # cached beats, recorded answers at fixed times

    async def cached_beats(self, eng, t: float) -> None:
        b = (self.cache or {}).get("beats") or {}
        tag = {"recorded": True}
        r = b.get("replan")
        T = CACHED_TIMES
        if r:
            ex = r.get("execution_id")
            if self.once("c_replan_think", t, T["replan"]["thinking"]):
                await eng.agent_frame("gw-site-superintendent", "thinking", "Replanning after the safety stop (recorded run)", ex, **tag)
                for name in r.get("tools") or []:
                    await eng.agent_frame("gw-site-superintendent", "tool", f"{name} (recorded run)", ex, **tag)
            if self.once("c_replan_answer", t, T["replan"]["answer"]):
                await eng.agent_frame("gw-site-superintendent", "answer", r["out"].get("summary", ""), ex, changes=r["out"].get("changes"),
                                      duration_ms=r.get("duration_ms"), cost_usd=r.get("cost"), **tag)
            if self.once("c_replan_wait", t, T["replan"]["waiting"]):
                await eng.agent_frame("gw-site-superintendent", "waiting_approval", f"{r['out'].get('summary', '')}. Approve?", ex, **tag)
            if r.get("approval") == "approved" and self.once("c_replan_ok", t, T["replan"]["approved"]):
                eng.queue("plan", {"tree": r["out"]["tree"], "summary": r["out"].get("summary", ""), "approved_by": f"{r.get('approved_by') or 'not approved'} (recorded run)", "execution_id": ex})
                eng.queue("clear_simplex", "all")
                await eng.event("approval", "Approved", f"{r['out'].get('summary', '')}. {r.get('approved_by') or 'Not approved'} in the recorded run", execution_id=ex, **tag)
        w = b.get("weather")
        if w:
            if self.once("c_w_think", t, T["weather"]["thinking"]):
                await eng.agent_frame("gw-crane-coordinator", "thinking", "Holding lifts for the gust (recorded run)", None, **tag)
            if self.once("c_w_answer", t, T["weather"]["answer"]):
                await eng.agent_frame("gw-crane-coordinator", "answer", w["out"].get("summary", ""), None, decision=w["out"], **tag)
        v = b.get("vecu")
        if v:
            if self.once("c_v_think", t, T["vecu"]["thinking"]):
                await eng.agent_frame("gw-vecu-builder", "thinking", "Writing the TH1 boom controller (recorded run)", v.get("execution_id"), **tag)
                await eng.agent_frame("gw-vecu-builder", "tool", "code_executor, golden tests (recorded run)", v.get("execution_id"), **tag)
            if self.once("c_v_answer", t, T["vecu"]["answer"]):
                await eng.agent_frame("gw-vecu-builder", "answer", f"TH1 boom controller, {v['out'].get('tests_passed')} of {v['out'].get('tests_total')} golden tests pass",
                                      v.get("execution_id"), source=v["out"].get("source"), **tag)
            if v.get("approval") == "approved" and self.once("c_v_ok", t, T["vecu"]["approved"]):
                eng.queue("telehandler_code", v["out"]["source"])
                await eng.event("approval", "TH1 put to work", f"{v.get('approved_by') or 'Not approved'} in the recorded run", execution_id=v.get("execution_id"), **tag)
        a = b.get("autonomy")
        if a and self.once("c_auto", t, T["autonomy"]["event"]):
            await eng.event("autonomy", a["title"], a["detail"], agent="gw-fleet-dispatcher", level=a.get("level"), **tag)
        n = b.get("near_miss")
        if n:
            if self.once("c_nm", t, T["near_miss"]["answer"]):
                await eng.agent_frame("gw-safety-officer", "answer", n["out"].get("lesson") or n["out"].get("title", ""), None, write_up=n["out"], **tag)
            if self.once("c_nm_lesson", t, T["near_miss"]["lesson"]):
                await eng.event("autonomy", "Near miss turned into a lesson", n["out"].get("lesson", ""), **tag)
