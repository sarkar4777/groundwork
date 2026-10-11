"""The closed loop as the site's app hears it: a rule fires in Abenix, an agent reads the machine and answers,
a person approves its command, the PC takes it. All from forge.events.stream, joined into one record per firing.
Nothing here decides anything.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any

log = logging.getLogger("gw.loop")

TYPES = ["telemetry.rule_fired", "telemetry.firing_completed", "telemetry.command_sent", "execution.completed", "execution.failed",
         "approval.requested", "approval.resolved"]
KEEP = 20
GROUP = "groundwork"


def _short(v: Any, n: int = 160) -> str:
    s = v if isinstance(v, str) else ("" if v is None else str(v))
    return s if len(s) <= n else s[: n - 1] + "…"


def summary(output: Any) -> str:
    """One line from an agent's answer, whichever of the Groundwork agents gave it."""
    if isinstance(output, dict):
        for k in ("finding", "summary", "what_happened", "meaning", "headline"):
            if output.get(k):
                return _short(output[k])
        return _short(", ".join(f"{k}: {v}" for k, v in list(output.items())[:3]))
    return _short(output)


class Loop:
    def __init__(self, forge, emit, on_answer=None, clock=None):
        self.forge = forge
        self.emit = emit
        self.on_answer = on_answer
        self.clock = clock
        self.records: dict[str, dict] = {}
        self.order: list[str] = []
        self.by_exec: dict[str, str] = {}
        self.by_approval: dict[str, str] = {}
        self.rule_agent: dict[str, str] = {}
        self.agent_names: dict[str, str] = {}
        self.last_id: str | None = None
        self.stream_up = False
        self.task: asyncio.Task | None = None

    async def start(self, agent_ids: dict) -> None:
        self.agent_names = {v: k for k, v in agent_ids.items()}
        await self._rules()
        await self._backfill()
        self.task = asyncio.create_task(self._run())

    def stop(self) -> None:
        if self.task:
            self.task.cancel()

    async def _rules(self) -> None:
        try:
            for r in await self.forge.telemetry.rules():
                for a in r.get("actions") or []:
                    if a.get("kind") == "run" and a.get("agent_id"):
                        self.rule_agent[str(r["id"])] = str(a["agent_id"])
                        break
        except Exception as e:  # noqa: BLE001
            log.info("rules not readable: %s", e)

    async def _backfill(self) -> None:
        # the last hour of firings, so a fresh ground station shows what already happened
        since = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        try:
            rows = await self.forge.telemetry.firings(since=since, limit=KEEP)
        except Exception as e:  # noqa: BLE001
            log.info("firings not readable: %s", e)
            return
        for f in rows or []:
            if (f.get("group") or GROUP) != GROUP and GROUP not in str(f.get("asset_key") or f.get("node") or ""):
                continue
            await self._fired({**f, "firing_id": f.get("id") or f.get("firing_id")}, quiet=True)
            await self._completed({**f, "firing_id": f.get("id") or f.get("firing_id")}, quiet=True)

    async def _run(self) -> None:
        while True:
            try:
                async for ev in self.forge.events.stream(TYPES, self.last_id):
                    self.stream_up = True
                    self.last_id = str(ev.get("id") or self.last_id or "") or None
                    await self.on_event(ev.get("type") or "", ev.get("data") or {})
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                log.warning("events stream: %s", e)
            self.stream_up = False
            await asyncio.sleep(3)

    # joining

    async def on_event(self, kind: str, d: dict) -> None:
        if kind == "telemetry.rule_fired":
            await self._fired(d)
        elif kind == "approval.requested" and d.get("gate_kind") == "telemetry.command":
            await self._approval(d)
        elif kind == "approval.resolved" and d.get("approval_id") in self.by_approval:
            await self._resolved(d)
        elif kind == "telemetry.command_sent":
            await self._sent(d)
        elif kind in ("execution.completed", "execution.failed"):
            await self._answered(d, kind == "execution.failed")
        elif kind == "telemetry.firing_completed":
            await self._completed(d)

    def _rec(self, fid: str) -> dict | None:
        return self.records.get(fid)

    async def _push(self, rec: dict, quiet: bool = False) -> None:
        rec["updated"] = time.time()
        if not quiet:
            # the site time too, so a recorded take plays each step when it happened
            await self.emit({"type": "loop", **rec, **({"t": round(self.clock(), 3)} if self.clock else {})})

    async def _fired(self, d: dict, quiet: bool = False) -> None:
        if (d.get("group") or GROUP) != GROUP:
            return
        fid = str(d.get("firing_id") or "")
        if not fid or fid in self.records:
            return
        rid = str(d.get("rule_id") or "")
        aid = self.rule_agent.get(rid)
        rec = {
            "id": fid, "rule_id": rid, "rule": d.get("rule"), "severity": d.get("severity"), "node": d.get("node"),
            "device": d.get("device"), "asset": d.get("asset"), "signal": d.get("signal"), "value": d.get("value"),
            "detail": _short(d.get("detail"), 220), "fired_at": d.get("at") or d.get("fired_at"),
            "agent": {"id": aid, "name": self.agent_names.get(aid or "", "") , "state": "running" if aid else "none",
                      "execution_id": None, "answer": None},
            "action": {"state": "none"}, "state": "running" if aid else "done",
        }
        self.records[fid] = rec
        self.order = ([fid] + [x for x in self.order if x != fid])[:KEEP]
        for x in list(self.records):
            if x not in self.order:
                self.records.pop(x, None)
        await self._push(rec, quiet)
        if not quiet and rec["signal"] and self.forge is not None:
            asyncio.create_task(self._spark(rec))

    async def _spark(self, rec: dict) -> None:
        """The 15 minutes the rule looked at, for the card's sparkline."""
        try:
            h = await self.forge.telemetry.history(GROUP, rec["node"], rec.get("device") or "", rec["signal"], from_="-15m", step="30s")
        except Exception as e:  # noqa: BLE001
            log.debug("spark %s: %s", rec["id"], e)
            return
        pts = ((h or {}).get("series") or [{}])[0].get("points") or []
        rec["spark"] = [round(float(p["avg"]), 2) for p in pts if p.get("avg") is not None][-30:]
        await self._push(rec)

    def _open_for(self, agent_id: str | None, node: str | None) -> dict | None:
        for fid in self.order:
            r = self.records.get(fid)
            if r and r["state"] == "running" and (not agent_id or r["agent"]["id"] == agent_id) and (not node or r["node"] == node or not r["node"]):
                return r
        return None

    def _link_exec(self, rec: dict, eid: str | None) -> None:
        if eid:
            rec["agent"]["execution_id"] = eid
            self.by_exec[eid] = rec["id"]

    async def _approval(self, d: dict) -> None:
        eid = d.get("execution_id")
        cmd = d.get("command") or {}
        rec = self._rec(self.by_exec.get(eid, "")) if eid else None
        rec = rec or self._open_for(d.get("agent_id"), cmd.get("node"))
        if rec is None:
            return
        self._link_exec(rec, eid)
        self.by_approval[d.get("approval_id")] = rec["id"]
        rec["agent"]["state"] = "waiting"
        rec["action"] = {"state": "waiting", "approval_id": d.get("approval_id"), "signal": cmd.get("signal"), "value": cmd.get("value"),
                         "node": cmd.get("node"), "device": cmd.get("device"), "reason": _short(cmd.get("reason")), "asked_at": time.time()}
        await self._push(rec)

    async def _resolved(self, d: dict) -> None:
        rec = self._rec(self.by_approval.get(d.get("approval_id"), ""))
        if rec is None:
            return
        st = d.get("status") or "approved"
        rec["action"]["state"] = "approved" if st == "approved" else "denied" if st in ("denied", "rejected") else st
        rec["action"]["decided_by"] = d.get("decided_by") or d.get("approved_by")
        rec["agent"]["state"] = "sending" if rec["action"]["state"] == "approved" else "running"
        await self._push(rec)

    async def _sent(self, d: dict) -> None:
        if (d.get("group") or GROUP) != GROUP:
            return
        eid = d.get("execution_id")
        rec = self._rec(self.by_exec.get(eid, "")) if eid else None
        rec = rec or self._open_for(None, d.get("node"))
        if rec is None:
            return
        self._link_exec(rec, eid)
        rec["action"].update({"state": "confirmed" if d.get("confirmed") else "sent", "signal": d.get("signal"), "value": d.get("value"),
                              "node": d.get("node"), "device": d.get("device"), "approved_by": d.get("approved_by"),
                              "confirmed": d.get("confirmed"), "timings": d.get("timings") or {}, "reason": _short(d.get("reason"))})
        await self._push(rec)

    async def _answered(self, d: dict, failed: bool) -> None:
        eid = d.get("execution_id")
        rec = self._rec(self.by_exec.get(eid, "")) if eid else None
        if rec is None and d.get("agent_id"):
            rec = self._open_for(d.get("agent_id"), None)
            if rec is not None:
                self._link_exec(rec, eid)
        if rec is None:
            return
        rec["agent"]["state"] = "failed" if failed else "answered"
        rec["agent"]["answer"] = summary(d.get("output")) if not failed else _short(d.get("failure_code") or d.get("error") or "failed")
        rec["agent"]["output"] = d.get("output") if isinstance(d.get("output"), dict) else None
        rec["agent"]["duration_ms"] = d.get("duration_ms")
        if rec["action"]["state"] == "none":
            rec["action"]["state"] = "no_command"
        await self._push(rec)
        if self.on_answer and not failed:
            await self.on_answer(rec)

    async def _completed(self, d: dict, quiet: bool = False) -> None:
        rec = self._rec(str(d.get("firing_id") or ""))
        if rec is None:
            return
        for s in d.get("steps") or []:
            if s.get("kind") == "run":
                self._link_exec(rec, s.get("execution_id"))
                if rec["agent"]["answer"] is None and s.get("output") is not None:
                    rec["agent"]["answer"] = summary(s.get("output"))
                    rec["agent"]["output"] = s.get("output") if isinstance(s.get("output"), dict) else None
                    rec["agent"]["state"] = "answered" if s.get("status") in ("ok", "done", "completed") else str(s.get("status") or "answered")
        if rec["action"]["state"] == "none":
            rec["action"]["state"] = "no_command"
        rec["state"] = "done"
        await self._push(rec, quiet)

    def view(self) -> list:
        return [self.records[f] for f in self.order if f in self.records]
