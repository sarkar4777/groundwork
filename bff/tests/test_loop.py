"""The closed loop as the site hears it: one record per firing, joined from platform events in any order they arrive."""

import asyncio

from gwbff.loop import Loop, summary


def _loop():
    sent = []

    async def emit(f):
        sent.append(f)

    lp = Loop(None, emit)
    lp.rule_agent = {"r1": "a-maint"}
    lp.agent_names = {"a-maint": "gw-maintenance-tech"}
    return lp, sent


def test_rule_agent_approval_command_answer_join_into_one_record():
    async def go():
        lp, sent = _loop()
        await lp.on_event("telemetry.rule_fired", {"firing_id": "f1", "rule_id": "r1", "rule": "EX1 hydraulics running hot", "group": "groundwork",
                                                   "node": "ipc-ex1", "device": "hydraulics", "signal": "Hydraulics/OilTemp_C", "value": 71.2,
                                                   "detail": "ran 18% above its level", "at": 1000})
        r = lp.view()[0]
        assert r["agent"]["state"] == "running" and r["agent"]["name"] == "gw-maintenance-tech"
        await lp.on_event("approval.requested", {"approval_id": "ap1", "gate_kind": "telemetry.command", "agent_id": "a-maint", "execution_id": "e1",
                                                 "command": {"node": "ipc-ex1", "device": "safety", "signal": "Mode/Set", "value": "safe", "reason": "oil 71 C"}})
        assert r["action"]["state"] == "waiting" and r["agent"]["execution_id"] == "e1"
        await lp.on_event("approval.resolved", {"approval_id": "ap1", "status": "approved", "decided_by": "ops@groundwork"})
        assert r["action"]["state"] == "approved"
        await lp.on_event("telemetry.command_sent", {"group": "groundwork", "node": "ipc-ex1", "device": "safety", "signal": "Mode/Set", "value": "safe",
                                                     "execution_id": "e1", "approved_by": "ops@groundwork", "confirmed": True, "timings": {"checks_ms": 9}})
        assert r["action"]["state"] == "confirmed" and r["action"]["approved_by"] == "ops@groundwork"
        await lp.on_event("execution.completed", {"execution_id": "e1", "agent_id": "a-maint", "output": {"finding": "Oil 71 C, up 14 C in 5 min"}})
        assert r["agent"]["state"] == "answered" and r["agent"]["answer"] == "Oil 71 C, up 14 C in 5 min"
        await lp.on_event("telemetry.firing_completed", {"firing_id": "f1", "steps": [{"kind": "run", "status": "ok", "execution_id": "e1"}]})
        assert r["state"] == "done" and len(sent) == 6 and all(x["type"] == "loop" and x["id"] == "f1" for x in sent)
    asyncio.run(go())


def test_other_groups_and_other_approvals_are_ignored():
    async def go():
        lp, sent = _loop()
        await lp.on_event("telemetry.rule_fired", {"firing_id": "x", "rule_id": "r9", "group": "edge-demo", "node": "truck-7"})
        await lp.on_event("approval.requested", {"approval_id": "p", "gate_kind": "decision_publish"})
        assert not lp.view() and not sent
    asyncio.run(go())


def test_an_answer_without_a_command_says_so():
    async def go():
        lp, _ = _loop()
        await lp.on_event("telemetry.rule_fired", {"firing_id": "f2", "rule_id": "r1", "group": "groundwork", "node": "ipc-ex1"})
        await lp.on_event("execution.completed", {"execution_id": "e2", "agent_id": "a-maint", "output": {"summary": "Within limits"}})
        r = lp.view()[0]
        assert r["action"]["state"] == "no_command" and r["agent"]["answer"] == "Within limits"
    asyncio.run(go())


def test_summary_reads_each_agents_answer():
    assert summary({"finding": "a"}) == "a" and summary({"summary": "b"}) == "b" and summary("plain text") == "plain text"
