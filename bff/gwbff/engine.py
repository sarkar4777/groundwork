"""The metronome. Calls the site twin in Abenix as fast as Abenix answers, and routes what it says.

The bff holds the Abenix key, the clock and the last frame. Every computation, from the 100 Hz
controllers to the agents, runs in Abenix. Nothing here knows how a machine works.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from abenix_sdk import Abenix

from .lanes import Lane, Open, Rolling

log = logging.getLogger("gw.bff")

AGENTS = ["gw-site-superintendent", "gw-safety-officer", "gw-crane-coordinator", "gw-fleet-dispatcher", "gw-maintenance-tech",
          "gw-earthworks-surveyor", "gw-compliance-reporter", "gw-foreman-voice", "gw-vecu-builder"]
PIPELINES = ["gw-shift-start", "gw-near-miss", "gw-dispatch-loop", "gw-fault-triage", "gw-weather-hold", "gw-end-of-shift", "gw-train-models"]
RULE_KEYS = ["gw.safety.exclusion", "gw.crane.limits", "gw.truck.speed", "gw.simplex.switch"]
MODELS = ["gw-worker-path", "gw-crane-collision", "gw-hydraulic-anomaly", "gw-payload", "gw-gust-nowcast", "gw-cycle-time"]
# which Abenix pipeline hears which twin event, the twin decides what is worth routing
ROUTES = {"near_miss": "gw-near-miss", "fault_triage": "gw-fault-triage", "weather_hold": "gw-weather-hold"}


def parse_json(text: Any) -> Any:
    """Agent answers are JSON, sometimes fenced or wrapped."""
    if isinstance(text, (dict, list)):
        return text
    if not isinstance(text, str):
        return None
    s = text.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s
        s = s.rsplit("```", 1)[0]
    try:
        return json.loads(s)
    except ValueError:
        a, b = s.find("{"), s.rfind("}")
        if a >= 0 and b > a:
            try:
                return json.loads(s[a:b + 1])
            except ValueError:
                return None
    return None


def unwrap(out: Any) -> Any:
    """A pipeline answer can be {"response": "<prose and json>", "cost": ...} or {"result": {...}}, look through both."""
    for _ in range(5):
        if isinstance(out, str):
            parsed = parse_json(out)
            if parsed is None:
                return {"text": out}
            out = parsed
        if not isinstance(out, dict):
            return out
        if isinstance(out.get("response"), (str, dict)) and not any(k in out for k in ("tree", "summary", "assignments", "lesson")):
            out = out["response"]
        elif isinstance(out.get("result"), (str, dict)) and len(out) <= 4 and "summary" not in out:
            out = out["result"]
        else:
            return out
    return out


class Engine:
    def __init__(self, cfg: dict, hub):
        self.cfg = cfg
        self.hub = hub
        self.forge = Abenix(api_key=cfg["api_key"], base_url=cfg["abenix_url"], timeout=900)
        self.ids: dict[str, str] = {}
        self.lanes = {
            "twin": Lane("twin", 5.0, threshold=3, cooldown_s=5.0),
            "ml": Lane("ml", 3.0),
            "decisions": Lane("decisions", 3.0),
            "pipelines": Lane("pipelines", 300.0, threshold=3, cooldown_s=30.0),
            "agents": Lane("agents", 300.0, threshold=3, cooldown_s=30.0),
            "platform": Lane("platform", 15.0),
        }
        self.l1 = Rolling(400, window_s=1.0)
        self.l1_all = Rolling(2000)
        self.l2 = Rolling(50)
        self.l2_tick = Rolling(200)
        self.l3 = Rolling(20)
        self.l4: float | None = None
        self.l5: float | None = None
        self.l4w = Rolling(20)
        self.l5w = Rolling(20)
        self.state_z: str | None = None
        self.frame: dict | None = None
        self.plan: dict | None = None
        self.site: dict | None = None
        self.terrain_cache: dict = {}
        self.aemp: dict | None = None
        self.pending: dict = {}
        self.ml_inflight: set = set()
        self.ai_offline = False
        self.killed = False
        self.kill_ids: list = []
        self.cost = 0.0
        self.rules: dict = {}
        self.last_rules_check = 0.0
        self.last_audit = 0.0
        self.last_dispatch_t = -999.0
        self.last_replan = -999.0
        self.replan_inflight = False
        self.route_last: dict = {}
        self.approvals: dict = {}
        self.agents_cache: tuple = (0.0, None)
        self.wall0 = time.monotonic()
        self.sim0 = 0.0
        self.story = None
        self.task: asyncio.Task | None = None
        self.bg: set = set()
        self.ready = False
        self.status = "starting"
        self.step_n = 0
        self.epoch = 0
        self.billing = "unknown"
        self.paused = False
        self.incidents: list = []
        self.faults_seen: list = []
        self.plan_changes: list = []
        self.agent_runs: list = []
        self.shift_started = time.monotonic()
        self.shift_report_sent = False
        self.stats_last: dict = {}

    # plumbing

    def spawn(self, coro) -> None:
        t = asyncio.create_task(coro)
        self.bg.add(t)
        t.add_done_callback(self._done)

    def _done(self, t: asyncio.Task) -> None:
        self.bg.discard(t)
        if not t.cancelled() and t.exception() is not None:
            log.warning("background task failed: %r", t.exception(), exc_info=t.exception())

    def t(self) -> float:
        return (self.frame or {}).get("t", 0.0)

    async def emit(self, frame: dict) -> None:
        await self.hub.send(frame)

    async def event(self, kind: str, title: str, detail: str = "", **kw) -> None:
        await self.emit({"type": "event", "t": self.t(), "kind": kind, "title": title, "detail": detail, **kw})

    async def agent_frame(self, agent: str, phase: str, text: str, execution_id: str | None = None, **kw) -> None:
        await self.emit({"type": "agent", "t": self.t(), "agent": agent, "phase": phase, "text": text, "execution_id": execution_id, **kw})

    def queue(self, key: str, value: Any) -> None:
        if key in ("faults", "dispatch", "audit"):
            self.pending.setdefault(key, []).extend(value if isinstance(value, list) else [value])
        elif key == "ml_results":
            self.pending.setdefault("ml_results", {}).update(value)
        elif key == "rules":
            self.pending.setdefault("rules", {}).update(value)
        else:
            self.pending[key] = value

    def ai_allowed(self) -> bool:
        return not self.ai_offline

    # start up

    async def resolve(self) -> None:
        for a in await self.forge.code_assets.list():
            if a.get("name", "").startswith("gw-"):
                self.ids[a["name"]] = a["id"]
        for slug in AGENTS + PIPELINES:
            a = await self.forge.agents.by_slug(slug)
            if a:
                self.ids[slug] = a["id"]
        await self.billing_mode()
        missing = [x for x in ["gw-site-twin"] + AGENTS[:7] + PIPELINES[:6] if x not in self.ids]
        if missing:
            raise RuntimeError(f"Not provisioned in Abenix: {', '.join(missing)}. Run python scripts/provision.py")

    async def billing_mode(self) -> None:
        """A Claude subscription serving every run reports no cost, the web says so instead of showing $0."""
        try:
            self.billing = await self.forge.llm_models.billing()
        except Exception as e:  # noqa: BLE001
            log.debug("billing: %s", e)
            self.billing = "unknown"

    async def twin(self, inp: dict, timeout_s: float | None = None) -> dict:
        async def go():
            r = await self.forge.code_assets.run(self.ids["gw-site-twin"], inp, timeout=timeout_s or 30)
            c = r.get("content")
            c = json.loads(c) if isinstance(c, str) else c
            if r.get("is_error") or not isinstance(c, dict) or "result" not in c:
                raise RuntimeError(f"twin step failed: {str(c)[:300]}")
            self.stats_last = {k: (r.get("metadata") or {}).get(k) for k in ("runner", "runner_mode", "duration_ms", "run_ms", "queue_ms", "cache")}
            return c["result"]
        return await self.lanes["twin"].call(go, timeout_s)

    async def fetch_rules(self, force: bool = False) -> None:
        changed = {}
        for key in RULE_KEYS:
            try:
                d = await self.lanes["platform"].call(lambda k=key: self.forge.decisions.get(k))
                pub = d.get("published") or []
                v = max((p["version"] for p in pub if p.get("state") == "published"), default=None)
                if v is None:
                    continue
                if force or (self.rules.get(key) or {}).get("version") != v:
                    exp = await self.lanes["platform"].call(lambda k=key: self.forge.decisions.export(k))
                    self.rules[key] = {"key": key, "version": exp.get("version", v), "rules": exp.get("rules") or []}
                    changed[key] = self.rules[key]
            except Exception as e:  # noqa: BLE001
                log.warning("rules %s: %s", key, e)
        if changed:
            self.queue("rules", changed)
        self.last_rules_check = time.monotonic()

    async def init_twin(self, seed: int) -> None:
        self.epoch += 1
        out = await self.twin({"op": "init", "seed": seed}, 300)
        self.state_z = out["state_z"]
        self.site = out.get("site")
        self.terrain_cache = {}
        self.pending = {}
        await self.fetch_rules(force=True)
        self.wall0 = time.monotonic()
        self.sim0 = 0.0

    # the loop

    async def run(self) -> None:
        while True:
            try:
                await asyncio.wait_for(self.resolve(), 20)
                await self.init_twin(int(self.cfg.get("seed", 42)))
                break
            except Exception as e:  # noqa: BLE001
                self.status = f"waiting for Abenix: {e}"
                log.warning(self.status)
                await self.emit({"type": "event", "t": 0.0, "kind": "fault", "title": "Abenix unreachable", "detail": str(e)[:300]})
                await asyncio.sleep(5)
        self.ready = True
        self.status = "running"
        await self.event("story", "Site twin running in Abenix", f"gw-site-twin code asset, {len(self.ids)} Abenix resources resolved")
        if self.cfg.get("shift_start", True):
            self.spawn(self.shift_start())
        target = 1.0 / float(self.cfg.get("rate_hz", 20))
        while True:
            t0 = time.monotonic()
            if self.paused:
                await asyncio.sleep(0.05)
                continue
            try:
                await self.step()
            except Open as e:
                self.status = str(e)
                await asyncio.sleep(1.0)
            except Exception as e:  # noqa: BLE001
                self.status = f"twin step failed: {e}"
                log.warning(self.status)
                await self.event("fault", "Twin step failed in Abenix", str(e)[:300])
                await asyncio.sleep(1.0)
            spent = time.monotonic() - t0
            await asyncio.sleep(max(0.0, target - spent))

    def ticks_due(self) -> int:
        if self.story is not None:
            return self.story.ticks
        if self.cfg.get("fixed_ticks"):
            return int(self.cfg["fixed_ticks"])
        owed = (time.monotonic() - self.wall0) - (self.t() - self.sim0)
        n = int(round(owed / 0.01))
        if n > 50:
            # Abenix fell behind real time, do not try to catch up more than half a second
            self.wall0 = time.monotonic() - (self.t() - self.sim0) - 0.5
            n = 50
        return max(1, n)

    async def step(self) -> None:
        inp = {"op": "step", "state_z": self.state_z, "ticks": self.ticks_due(), "bus_budget": int(self.cfg.get("bus_budget", 12))}
        if self.story is not None:
            await self.story.before_step(self, inp)
        taken = self.pending
        inp.update(taken)
        self.pending = {}
        if time.monotonic() - self.last_rules_check > 30:
            self.spawn(self.fetch_rules())
        sim_t = self.t()
        if self.story is None and sim_t - self.last_dispatch_t >= float(self.cfg.get("dispatch_s", 10)) and self.ai_allowed():
            inp["want_dispatch"] = True
            self.last_dispatch_t = sim_t
        t0 = time.perf_counter()
        epoch = self.epoch
        try:
            try:
                out = await self.twin(inp)
            except Exception as e:  # noqa: BLE001
                # one quick retry for a refused or dropped call, the step is a pure function so it is safe to repeat
                if "429" not in str(e) and "disconnected" not in str(e).lower():
                    raise
                await asyncio.sleep(0.05)
                out = await self.twin(inp)
        except Exception:
            # nothing reached the twin, so what this step carried goes with the next one
            for k, v in taken.items():
                self.queue(k, v)
            raise
        rtt = (time.perf_counter() - t0) * 1000
        if epoch != self.epoch:
            # a new twin was started while this step was in flight, its answer belongs to the old site
            return
        self.l1.add(rtt)
        self.l1_all.add(rtt)
        self.step_n += 1
        self.state_z = out["state_z"]
        st = out.get("stats") or {}
        if st.get("safety_us_p99") is not None:
            self.l2_tick.add(st["safety_us_p99"] / 1000)
        frame = out["frame"]
        frame["latency"] = {
            "l1_ms": self.l1.pct(0.99), "l2_ms": self.l2.pct(0.99, 20), "l3_ms": self.l3.pct(0.5, 20),
            "l4_ms": self.l4, "l5_ms": self.l5,
            "l1_twin_run_ms": st.get("run_ms"), "l2_tick_ms": self.l2_tick.pct(0.99, 100),
            "step_hz": round(len(self.l1.values()), 1), "ticks_per_step": st.get("ticks"),
            "l1_p50_ms": self.l1.pct(0.5), "l2_p50_ms": self.l2.pct(0.5, 20), "l3_p50_ms": self.l3.pct(0.5, 20),
            "l4_p50_ms": self.l4w.pct(0.5), "l5_p50_ms": self.l5w.pct(0.5),
        }
        frame["kpi"]["ai_cost_usd"] = round(self.cost, 4)
        frame["kpi"]["ai_billing"] = self.billing
        frame["ai_offline"] = self.ai_offline
        frame["killed"] = self.killed
        self.frame = frame
        await self.emit(frame)
        for b in out.get("bus") or []:
            await self.emit(b)
        if out.get("plan"):
            self.plan = out["plan"]
            await self.emit(out["plan"])
        if out.get("aemp"):
            self.aemp = out["aemp"]
        for e in out.get("events") or []:
            await self.emit(e)
            await self.route(e)
        if out.get("ml") and self.ai_allowed():
            for name, req in out["ml"].items():
                if name not in self.ml_inflight:
                    self.ml_inflight.add(name)
                    self.spawn(self.predict(name, req))
        if out.get("dispatch_facts"):
            self.spawn(self.dispatch(out["dispatch_facts"]))
        for o in out.get("outcomes") or []:
            self.spawn(self.report_outcome(o))
        if out.get("audit_facts") and time.monotonic() - self.last_audit >= 1.0:
            self.last_audit = time.monotonic()
            self.spawn(self.audit(out["audit_facts"]))
        if out.get("brief") is not None and self.story is None:
            self._brief = out["brief"]
        if self.story is not None:
            await self.story.after_step(self, out)
        minutes = float(self.cfg.get("shift_minutes", 60))
        if self.story is None and not self.shift_report_sent and time.monotonic() - self.shift_started > minutes * 60:
            self.shift_report_sent = True
            self.spawn(self.end_of_shift())

    # fast lanes

    async def predict(self, name: str, req: dict) -> None:
        try:
            t0 = time.perf_counter()
            r = await self.lanes["ml"].call(lambda: self.forge.ml_models.predict(name, req["rows"], timeout=3))
            self.l3.add((time.perf_counter() - t0) * 1000)
            res = {"ids": req.get("ids"), "predictions": r.get("predictions")}
            self.queue("ml_results", {name: res})
            if self.story is not None:
                self.story.record_ml(self, name, res)
        except Exception as e:  # noqa: BLE001
            log.debug("predict %s: %s", name, e)
        finally:
            self.ml_inflight.discard(name)

    async def audit(self, items: list) -> None:
        """The same facts through Abenix decisions, to show l2 and prove the twin applies the published rules."""
        try:
            t0 = time.perf_counter()
            r = await self.lanes["decisions"].call(lambda: self.forge.decisions.evaluate_batch("gw.safety.exclusion", [{"facts": i["facts"]} for i in items]))
            self.l2.add((time.perf_counter() - t0) * 1000)
            results = r.get("results") or r.get("items") or []
            checked = []
            for i, res in zip(items, results):
                ab = (res.get("result") or {}).get("action")
                checked.append({"machine": i["machine"], "twin": i.get("twin"), "abenix": ab})
            self.queue("audit", checked)
        except Exception as e:  # noqa: BLE001
            log.debug("audit: %s", e)

    async def report_outcome(self, o: dict) -> None:
        try:
            await self.lanes["platform"].call(lambda: self.forge.actions.report_outcome(o["action_id"], o["cycle_min"], note=f"{o['truck']} cycle"))
        except Exception as e:  # noqa: BLE001
            log.debug("outcome: %s", e)

    # agents and pipelines

    async def run_agent(self, slug: str, message: str, *, lane: str = "agents", context: dict | None = None, label: str | None = None,
                        speak_as: str | None = None) -> tuple[Any, Any]:
        """One real Abenix run. Emits thinking, tool and answer frames from what Abenix returns."""
        who = speak_as or slug
        if not self.ai_allowed():
            await self.agent_frame(who, "answer", "AI offline, not called. The site runs on the fallback plan.")
            return None, None
        await self.agent_frame(who, "thinking", label or "Working on it")
        t0 = time.perf_counter()
        try:
            kw = {"context": context} if context is not None else {}
            res = await self.lanes[lane].call(lambda: self.forge.execute(self.ids.get(slug, slug), message, **kw))
        except Exception as e:  # noqa: BLE001
            msg = str(e)
            if "KILL" in msg.upper() or "kill switch" in msg.lower():
                await self.agent_frame(who, "answer", "Stopped by the Abenix kill switch")
            else:
                await self.agent_frame(who, "answer", f"Run failed: {msg[:200]}")
            return None, None
        dur = (time.perf_counter() - t0) * 1000
        if lane == "pipelines":
            self.l4 = round(dur, 1)
            self.l4w.add(self.l4)
        else:
            self.l5 = round(dur, 1)
            self.l5w.add(self.l5)
        self.cost += float(res.cost or 0)
        self.agent_runs.append({"agent": slug, "execution_id": res.execution_id, "status": res.status, "ms": round(dur), "cost": res.cost})
        for tc in (res.tool_calls or [])[:6]:
            name = tc.get("name") or tc.get("tool_name") or tc.get("tool") or "tool"
            await self.agent_frame(who, "tool", f"{name}", res.execution_id)
        if res.status == "failed" or (res.errors and not res.output):
            text = "; ".join(str(e.get("message") or e) for e in res.errors)[:300] if res.errors else str(res.output)[:300]
            if "kill" in text.lower():
                text = "Stopped by the Abenix kill switch. " + text
            await self.agent_frame(who, "answer", f"Run {res.status}: {text}", res.execution_id, duration_ms=round(dur), cost_usd=res.cost)
            return None, res
        return unwrap(res.output), res

    async def replan(self, reason: str, event: dict | None = None) -> None:
        if self.replan_inflight or not self.ai_allowed():
            return
        self.replan_inflight = True
        self.last_replan = time.monotonic()
        try:
            br = await self.brief()
            msg = json.dumps({"reason": reason, "event": event, "brief": br, "plan": (br or {}).get("plan_tree") or (self.plan or {}).get("tree")})
            out, res = await self.run_agent("gw-site-superintendent", msg, label=f"Replanning after {reason.replace('_', ' ')}")
            if not isinstance(out, dict) or "tree" not in out:
                if res is not None and out is not None:
                    await self.agent_frame("gw-site-superintendent", "answer", "No plan in the answer", res.execution_id)
                return
            await self.agent_frame("gw-site-superintendent", "answer", out.get("summary", ""), res.execution_id,
                                   changes=out.get("changes"), duration_ms=res.duration_ms, cost_usd=res.cost)
            await self.propose_plan(out, res.execution_id, "gw-site-superintendent")
        finally:
            self.replan_inflight = False

    async def brief(self) -> dict | None:
        for attempt in range(3):
            out = await self._brief_once()
            if out is not None:
                return out
            await asyncio.sleep(0.3 * (attempt + 1))
        return None

    async def _brief_once(self) -> dict | None:
        try:
            out = await self.twin({"op": "brief", "state_z": self.state_z})
            out.pop("op", None)
            out.pop("run_ms", None)
            if self.plan:
                out["plan_tree"] = _strip_status(self.plan.get("tree"))
            return out
        except Exception as e:  # noqa: BLE001
            log.warning("brief: %s", e)
            return None

    async def propose_plan(self, out: dict, execution_id: str | None, agent: str) -> None:
        waiting = next((r for r in self.approvals.values() if r.get("kind") == "plan" and r.get("status") == "pending"), None)
        if waiting:
            # one plan change waits for a person at a time, a newer one is held, not stacked
            await self.event("plan_change", "Plan change held", f"Waiting on: {waiting['plan']['summary']}", agent=agent)
            return
        tree = out.get("tree")
        chk = await self.twin({"op": "check_plan", "state_z": self.state_z, "tree": tree})
        if not chk.get("ok"):
            await self.event("plan_change", "Plan refused by the twin", "; ".join(chk.get("problems") or [])[:300], agent=agent)
            return
        facts = chk.get("lift_facts") or []
        if facts:
            t0 = time.perf_counter()
            try:
                r = await self.lanes["decisions"].call(lambda: self.forge.decisions.evaluate_batch("gw.crane.limits", [{"facts": f["facts"]} for f in facts]))
                self.l4 = round((time.perf_counter() - t0) * 1000, 1)
                self.l4w.add(self.l4)
                bad = [f["id"] for f, x in zip(facts, r.get("results") or []) if (x.get("result") or {}).get("action") in ("stop_slew", "stop_hoist")]
                if bad:
                    await self.event("plan_change", "Plan refused by gw.crane.limits", f"Lifts over the limits: {', '.join(bad)}", agent=agent)
                    return
            except Exception as e:  # noqa: BLE001
                log.warning("plan crane check: %s", e)
        summary = out.get("summary", "Plan change")
        try:
            d = await self.lanes["platform"].call(lambda: self.forge.actions.propose(
                "gw.plan.change", {"topic": "gw/plan/change", "summary": summary, "changes": out.get("changes") or []},
                agent_id=self.ids.get(agent), target="northgate-yard", intent=summary))
        except Exception as e:  # noqa: BLE001
            await self.event("plan_change", "Earned Autonomy check failed", str(e)[:200], agent=agent)
            return
        decision = d.get("decision")
        rec = {"kind": "plan", "agent": agent, "plan": {"tree": tree, "summary": summary, "execution_id": execution_id},
               "action_id": d.get("action_id"), "approval_id": d.get("approval_id"), "status": "pending"}
        if decision == "run":
            await self.apply_plan(rec, "Earned Autonomy: acts within limits")
            return
        if decision == "blocked":
            await self.event("plan_change", "Plan change blocked", d.get("message", ""), agent=agent)
            return
        if decision == "watching":
            # the grant only watches, so a person approves this change through an Abenix approval
            ap = await self.lanes["platform"].call(lambda: self.forge.approvals.create(
                f"Approve plan change: {summary}", {"summary": summary, "changes": out.get("changes"), "action_id": d.get("action_id"),
                                                    "why": "The superintendent's plan changes are at Watching, a person decides"},
                gate_kind="gw.plan.change", agent_id=self.ids.get(agent), agent_execution_id=execution_id, expires_seconds=3600))
            rec["approval_id"] = ap.get("id") or ap.get("approval_id")
        key = execution_id or rec["approval_id"] or rec["action_id"]
        self.approvals[key] = rec
        await self.agent_frame(agent, "waiting_approval", f"{summary}. Approve?", key, changes=out.get("changes"),
                               approval_id=rec["approval_id"], action_id=rec["action_id"])
        await self.event("approval", "Approval requested in Abenix", summary, execution_id=key, approval_id=rec["approval_id"])
        self.spawn(self.wait_approval(key))

    async def wait_approval(self, key: str) -> None:
        rec = self.approvals.get(key)
        if not rec:
            return
        try:
            if rec.get("approval_id"):
                r = await self.forge.approvals.wait_for(rec["approval_id"], timeout_seconds=3600, poll_seconds=1.0)
                status = r.get("status")
                ok = status == "approved"
            else:
                r = await self.forge.actions.wait(rec["action_id"], timeout_seconds=3600)
                ok = r.get("decision") == "run"
                status = "approved" if ok else r.get("decision")
        except Exception as e:  # noqa: BLE001
            log.warning("approval wait: %s", e)
            if rec.get("status") == "pending":
                rec["status"] = "lost"
            return
        if rec.get("status") != "pending":
            return
        if status in (None, "pending", "wait"):
            status = "expired"
        if ok:
            await self.apply_plan(rec, rec.get("approved_by") or "Approved by a person in Abenix")
        else:
            rec["status"] = status or "rejected"
            await self.event("approval", f"Plan change {status or 'rejected'}", rec["plan"]["summary"], execution_id=key)
            await self.agent_frame(rec["agent"], "answer", f"Rejected: {rec['plan']['summary']}", key)

    async def apply_plan(self, rec: dict, who: str) -> None:
        rec["status"] = "approved"
        if rec["kind"] == "telehandler":
            self.queue("telehandler_code", rec["code"])
        else:
            self.queue("plan", {**rec["plan"], "approved_by": who})
            self.queue("clear_simplex", "all")
            self.queue("cleared_by", who)
        self.plan_changes.append({"summary": rec["plan"]["summary"], "who": who, "t": self.t()})
        key = rec["plan"].get("execution_id") or rec.get("approval_id")
        await self.event("approval", "Approved", f"{rec['plan']['summary']}. {who}", execution_id=key)
        await self.agent_frame(rec["agent"], "answer", f"Approved: {rec['plan']['summary']}", key)
        if rec.get("action_id"):
            self.spawn(self._executed(rec["action_id"], rec["plan"]["summary"]))

    async def _executed(self, action_id: str, preview: str) -> None:
        try:
            await self.forge.actions.executed(action_id, True, result_preview=preview[:500])
        except Exception as e:  # noqa: BLE001
            log.debug("executed: %s", e)

    async def decide(self, key: str, approve: bool, by: str = "a person on the Groundwork phone view") -> dict:
        """The phone mock-up. A real person's decision, forwarded to the Abenix approval."""
        rec = self.approvals.get(key)
        if rec is None:
            for k, r in self.approvals.items():
                if r.get("approval_id") == key or r.get("action_id") == key:
                    rec, key = r, k
                    break
        if rec is None:
            return {"ok": False, "error": "no such approval"}
        aid = rec.get("approval_id")
        if not aid and rec.get("action_id"):
            a = await self.forge.actions.get(rec["action_id"])
            aid = a.get("approval_id") or (a.get("approval") or {}).get("id")
        if not aid:
            return {"ok": False, "error": "this change has no Abenix approval to sign"}
        rec["approved_by"] = f"Approved by {by}" if approve else None
        if approve:
            await self.forge.approvals.approve(aid, reason=f"Approved by {by}")
        else:
            await self.forge.approvals.deny(aid, reason="Rejected from the Groundwork phone view")
        return {"ok": True, "approval_id": aid}

    async def route(self, e: dict) -> None:
        if self.story is not None:
            return
        r = e.get("route")
        if not r or not self.ai_allowed():
            return
        key = f"{r}:{e.get('machine')}"
        gap = {"near_miss": 60, "fault_triage": 300, "weather_hold": 120}.get(r, 60)
        if time.monotonic() - self.route_last.get(key, -1e9) < gap:
            return
        self.route_last[key] = time.monotonic()
        if r == "near_miss":
            self.incidents.append({k: e.get(k) for k in ("t", "machine", "title", "detail", "ms", "worker")})
            self.spawn(self.near_miss(e))
            if time.monotonic() - self.last_replan > 90:
                self.spawn(self.replan("safety_stop", {k: e.get(k) for k in ("machine", "title", "detail", "worker", "ms")}))
        elif r == "fault_triage":
            self.faults_seen.append({k: e.get(k) for k in ("t", "machine", "title", "spn", "fmi")})
            self.spawn(self.fault_triage(e))
        elif r == "weather_hold":
            self.spawn(self.weather_hold(e))

    async def near_miss(self, e: dict, cached: dict | None = None) -> Any:
        br = await self.brief()
        ctx = {"event": {k: e.get(k) for k in ("machine", "worker", "rule", "ms", "title", "detail", "t")}, "facts": e.get("facts") or {},
               "recent": (br or {}).get("recent", [])[-20:]}
        out, res = await self.run_agent("gw-near-miss", f"Near miss at {e.get('machine')}", lane="pipelines", context=ctx,
                                        label="Writing up the safety stop", speak_as="gw-safety-officer")
        if isinstance(out, dict):
            if self.incidents:
                self.incidents[-1]["write_up"] = out
            await self.agent_frame("gw-safety-officer", "answer", out.get("lesson") or out.get("title") or str(out.get("text", out))[:300],
                                   res.execution_id if res else None, write_up=out)
            if out.get("lesson") and res is not None:
                self.spawn(self.lesson(out, res.execution_id))
        return out

    async def lesson(self, out: dict, execution_id: str | None) -> None:
        try:
            await self.lanes["platform"].call(lambda: self.forge.lessons.report(
                self.ids["gw-site-superintendent"], out["lesson"], execution_id=None,
                input=json.dumps({"near_miss": out.get("title")}), output=out.get("root_cause", "")))
            await self.event("autonomy", "Near miss turned into a lesson", out["lesson"])
        except Exception as e:  # noqa: BLE001
            log.debug("lesson: %s", e)

    async def fault_triage(self, e: dict) -> None:
        br = await self.brief()
        m = ((br or {}).get("machines") or {}).get(e.get("machine"), {})
        fault = {"machine": e.get("machine"), "kind": m.get("kind"), "spn": e.get("spn"), "fmi": e.get("fmi"), "title": e.get("title"),
                 "detail": e.get("detail"), "dtcs": m.get("dtcs")}
        out, res = await self.run_agent("gw-fault-triage", json.dumps(fault), lane="pipelines", context={"fault": fault},
                                        label=f"Diagnosing {e.get('title')}", speak_as="gw-maintenance-tech")
        if isinstance(out, dict):
            dg = unwrap(out.get("diagnosis")) if "diagnosis" in out else out
            mode = out.get("mode") or {}
            text = f"{(dg or {}).get('code', '')}: {(dg or {}).get('likely_cause') or (dg or {}).get('meaning', '')}. Safe mode {mode.get('mode', (dg or {}).get('safe_mode'))}"
            await self.agent_frame("gw-maintenance-tech", "answer", text[:300], res.execution_id, diagnosis=dg, mode=mode)
            if self.faults_seen:
                self.faults_seen[-1]["diagnosis"] = dg

    async def weather_hold(self, e: dict) -> Any:
        fr = self.frame or {}
        tc = next((c for c in fr.get("cranes", []) if c["id"] == "TC1"), {})
        ctx = {"forecast_ms": e.get("forecast_ms") or 0, "wind_ms": tc.get("wind_ms", 0), "lmi_pct": tc.get("lmi_pct", 0),
               "cranes": {c["id"]: {k: c.get(k) for k in ("wind_ms", "lmi_pct", "load_t")} for c in fr.get("cranes", [])}}
        out, res = await self.run_agent("gw-weather-hold", f"Gust forecast {ctx['forecast_ms']} m/s", lane="pipelines", context=ctx,
                                        label="Holding lifts for the gust", speak_as="gw-crane-coordinator")
        if isinstance(out, dict):
            await self.agent_frame("gw-crane-coordinator", "answer", out.get("summary") or json.dumps(out)[:200], res.execution_id, decision=out)
            if self.story is None and time.monotonic() - self.last_replan > 90:
                self.spawn(self.replan("gust", {"forecast_ms": ctx["forecast_ms"], "coordinator": out}))
        return out

    async def dispatch(self, facts: dict) -> None:
        if not self.ai_allowed():
            return
        t0 = time.perf_counter()
        try:
            res = await self.lanes["pipelines"].call(lambda: self.forge.execute(self.ids["gw-dispatch-loop"], "Dispatch",
                                                                                context={"facts": facts, "cycle_rows": facts["cycle_rows"]}))
        except Exception as e:  # noqa: BLE001
            log.debug("dispatch: %s", e)
            return
        self.l4 = round((time.perf_counter() - t0) * 1000, 1)
        self.l4w.add(self.l4)
        out = unwrap(res.output)
        if res.status == "failed" or (isinstance(out, dict) and out.get("error")):
            msg = str((out or {}).get("error") if isinstance(out, dict) else res.errors)[:200]
            if "kill switch" in msg.lower():
                await self.agent_frame("gw-fleet-dispatcher", "answer", "Dispatch loop stopped by the Abenix kill switch", res.execution_id)
            return
        if not isinstance(out, dict):
            return
        moves = []
        for a in out.get("assignments") or []:
            k = (a.get("truck"), a.get("ex"))
            if a.get("changed") and time.monotonic() - self.route_last.get(k, -1e9) > 120:
                self.route_last[k] = time.monotonic()
                moves.append(a)
        moves = moves[:2]
        for a in moves:
            try:
                d = await self.lanes["platform"].call(lambda a=a: self.forge.actions.propose(
                    "gw.truck.reroute", {"topic": f"gw/truck/{a['truck']}", "truck": a["truck"], "ex": a["ex"], "dest": a.get("dest", "spoil")},
                    agent_id=self.ids.get("gw-fleet-dispatcher"), target=a["truck"],
                    intent=f"{a['truck']} to {a['ex']}, predicted {a.get('minutes')} min cycle",
                    prediction={"metric": "cycle_min", "value": a.get("minutes"), "low": round(a.get("minutes", 6) * 0.8, 2), "high": round(a.get("minutes", 6) * 1.2, 2)}))
            except Exception as e:  # noqa: BLE001
                log.debug("reroute propose: %s", e)
                continue
            dec = d.get("decision")
            if dec == "run":
                self.queue("dispatch", [{"truck": a["truck"], "ex": a["ex"], "dest": a.get("dest", "spoil"), "action_id": d.get("action_id")}])
                self.spawn(self._executed(d["action_id"], f"{a['truck']} to {a['ex']}"))
                await self.agent_frame("gw-fleet-dispatcher", "answer", f"{a['truck']} to {a['ex']}, acts within limits", res.execution_id)
            elif dec == "watching":
                await self.agent_frame("gw-fleet-dispatcher", "answer", f"Would send {a['truck']} to {a['ex']} ({a.get('minutes')} min). Watching, a person reviews it", res.execution_id)
            elif dec == "wait":
                await self.agent_frame("gw-fleet-dispatcher", "waiting_approval", f"Send {a['truck']} to {a['ex']}?", d.get("action_id"))

    async def shift_start(self) -> None:
        await asyncio.sleep(3)
        br = await self.brief()
        if br is None:
            return
        tc = next((c for c in (self.frame or {}).get("cranes", []) if c["id"] == "TC1"), {})
        out, res = await self.run_agent("gw-shift-start", "Start of shift", lane="pipelines",
                                        context={"brief": br, "plan": br.get("plan_tree") or {}, "wind_ms": tc.get("wind_ms", 8)},
                                        label="Drafting the shift plan", speak_as="gw-site-superintendent")
        if isinstance(out, dict) and "tree" in out:
            await self.agent_frame("gw-site-superintendent", "answer", out.get("summary", ""), res.execution_id, changes=out.get("changes"))
            await self.propose_plan(out, res.execution_id, "gw-site-superintendent")

    async def end_of_shift(self) -> None:
        report = {"kpi": (self.frame or {}).get("kpi"), "incidents": self.incidents[-20:], "faults": self.faults_seen[-20:],
                  "aemp": self.aemp, "ai": {"runs": len(self.agent_runs), "cost_usd": round(self.cost, 4)}, "plan": self.plan_changes[-20:]}
        out, res = await self.run_agent("gw-end-of-shift", "End of shift", lane="pipelines", context={"report": report},
                                        label="Writing the shift report", speak_as="gw-compliance-reporter")
        if isinstance(out, dict):
            await self.agent_frame("gw-compliance-reporter", "answer", out.get("headline", ""), res.execution_id, report=out)

    # faults from the deck

    async def fault(self, kind: str, target: str | None, extra: dict | None = None) -> dict:
        extra = extra or {}
        if kind == "ai_offline":
            on = bool(extra.get("on", True))
            self.ai_offline = on
            self.queue("faults", [{"kind": "ai_offline", "on": on}])
            await self.event("fault", "AI offline, site safe" if on else "AI back online",
                             "Groundwork stopped calling Abenix agents, models and pipelines. The twin and its safety rules keep running." if on
                             else "Agents, models and pipelines back in use", ai_offline=on)
            return {"ok": True}
        if kind == "kill_switch":
            return await self.kill(bool(extra.get("on", True)))
        if kind == "clear":
            self.ai_offline = False
            self.queue("faults", [{"kind": "clear"}])
            if self.killed:
                await self.kill(False)
            await self.event("fault", "Faults cleared", "AI back online, CAN and GNSS restored", ai_offline=False)
            return {"ok": True}
        if kind in ("cut_can", "drop_gnss", "gust", "worker_in_swing", "hydraulic_wear"):
            self.queue("faults", [{"kind": kind, "target": target, **extra}])
            return {"ok": True}
        return {"ok": False, "error": f"unknown fault {kind}"}

    async def kill(self, on: bool) -> dict:
        """The Abenix kill switch, set on every Groundwork agent and pipeline."""
        done, errors = [], []
        if on:
            for slug in AGENTS + PIPELINES:
                aid = self.ids.get(slug)
                if not aid:
                    continue
                scope = "pipeline" if slug in PIPELINES else "agent"
                try:
                    k = await self.forge.kill_switches.set(scope, aid, "Groundwork fault deck: kill switch")
                    if k.get("id"):
                        self.kill_ids.append(k["id"])
                    done.append(slug)
                except Exception as e:  # noqa: BLE001
                    errors.append(f"{slug}: {str(e)[:120]}")
            self.killed = True
            self.queue("faults", [{"kind": "kill_switch", "on": True}])
            await self.event("fault", "Kill switch set in Abenix", f"{len(done)} agents and pipelines stopped. Machines carry on under the rules and the fallback plan." + (f" Errors: {'; '.join(errors)}" if errors else ""))
        else:
            for sid in self.kill_ids:
                try:
                    await self.forge.kill_switches.clear(sid)
                except Exception as e:  # noqa: BLE001
                    log.warning("kill switch clear: %s", e)
            self.kill_ids = []
            self.killed = False
            self.queue("faults", [{"kind": "kill_switch", "on": False}])
            await self.event("fault", "Kill switch cleared", "AI back online", ai_offline=False)
        return {"ok": not errors, "stopped": done, "errors": errors}

    # reads for the routes

    async def terrain(self, rev: int | None) -> dict:
        cur = ((self.frame or {}).get("terrain") or {}).get("rev")
        for k, v in list(self.terrain_cache.items()):
            if k != cur and k != rev:
                self.terrain_cache.pop(k, None)
        if cur in self.terrain_cache:
            return self.terrain_cache[cur]
        out = await self.twin({"op": "terrain", "state_z": self.state_z}, 30)
        out.pop("op", None)
        self.terrain_cache[out.get("rev")] = out
        return out

    async def agents_view(self) -> list:
        at, cached = self.agents_cache
        if cached is not None and time.monotonic() - at < 10:
            return cached
        ov = await self.forge.autonomy.overview()
        grants: dict = {}
        for g in ov.get("grants") or []:
            grants.setdefault((g.get("agent") or {}).get("id"), []).append(g)
        out = []
        for slug in AGENTS:
            aid = self.ids.get(slug)
            gs = grants.get(aid, [])
            level = max(gs, key=lambda g: g.get("level", 0)) if gs else None
            rec = None
            if level:
                st = level.get("stats") or {}
                nx = level.get("next") or {}
                rec = f"{st.get('reviews', 0)} reviews, {st.get('executed', 0)} executed" + (f", next: {nx.get('next_label')}" if nx.get("next_label") else "")
            out.append({"name": slug, "id": aid, "level": level.get("level_label") if level else "Not enrolled",
                        "level_index": max(0, (level.get("level", 1) - 1)) if level else 0,
                        "actions": [{"type": (g.get("action_type") or {}).get("key"), "level": g.get("level_label"),
                                     "requirements": [r.get("label") for r in (g.get("next") or {}).get("requirements") or []]} for g in gs],
                        "record": rec, "url": f"{self.cfg['abenix_web']}/agents/{aid}" if aid else None})
        self.agents_cache = (time.monotonic(), out)
        return out

    def health(self) -> dict:
        return {"ok": self.ready, "status": self.status, "abenix_url": self.cfg["abenix_url"], "steps": self.step_n,
                "t": self.t(), "lanes": {k: v.info() for k, v in self.lanes.items()}, "last_step_runner": self.stats_last,
                "ai_offline": self.ai_offline, "killed": self.killed, "story": self.story.info() if self.story else None,
                "l1_p50_ms": self.l1_all.pct(0.5), "l1_p99_ms": self.l1_all.pct(0.99)}


def _strip_status(node):
    if not isinstance(node, dict):
        return node
    out = {k: v for k, v in node.items() if k not in ("status", "mode", "source", "version", "summary")}
    if node.get("children"):
        out["children"] = [_strip_status(c) for c in node["children"]]
    return out
