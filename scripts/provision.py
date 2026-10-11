"""Load everything in abenix/ into an Abenix instance, through the SDK and the public API only.

Idempotent: what exists is updated, what matches is left alone. Run it again after any change in abenix/.

    python scripts/provision.py               # everything
    python scripts/provision.py --only agents,pipelines
    python scripts/provision.py --retrain     # train the six models again in Abenix
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import io
import json
import os
import sys
import time
import zipfile
from pathlib import Path

import httpx
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "bff" / "vendor"))
from abenix_sdk import Abenix, AbenixDecisionError, AbenixError, bootstrap_key  # noqa: E402

AB = ROOT / "abenix"
ENV = ROOT / ".env"
MODELS = {
    "gw-worker-path": "worker_path",
    "gw-crane-collision": "crane_collision",
    "gw-hydraulic-anomaly": "hydraulic",
    "gw-payload": "payload",
    "gw-gust-nowcast": "gust",
    "gw-cycle-time": "cycle_time",
}
STEPS = ("key", "assets", "decisions", "agents", "pipelines", "kb", "autonomy", "models", "rules", "check")


def read_env() -> dict:
    out = {}
    if ENV.exists():
        for line in ENV.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip()
    return out


def write_env(updates: dict) -> None:
    cur = ENV.read_text().splitlines() if ENV.exists() else []
    seen = set()
    out = []
    for line in cur:
        k = line.split("=", 1)[0].strip() if "=" in line else None
        if k in updates:
            out.append(f"{k}={updates[k]}")
            seen.add(k)
        else:
            out.append(line)
    for k, v in updates.items():
        if k not in seen:
            out.append(f"{k}={v}")
    ENV.write_text("\n".join(out) + "\n")


class Report:
    def __init__(self, web: str):
        self.web = web.rstrip("/")
        self.rows = []

    def add(self, kind, name, status, link="", note=""):
        self.rows.append((kind, name, status, link, note))
        print(f"  {kind:<10} {name:<28} {status:<10} {note}")

    def show(self):
        print("\nIn the Abenix UI:")
        for kind, name, status, link, note in self.rows:
            if link:
                print(f"  {kind:<10} {name:<28} {self.web}{link}")


def env(name, default=""):
    return os.environ.get(name) or read_env().get(name) or default


# the API key

async def mint_key(base: str) -> str:
    have = env("ABENIX_API_KEY")
    if have:
        async with Abenix(api_key=have, base_url=base) as f:
            try:
                await f.me()
                print(f"  key        {key_name():<28} kept       the key in .env works")
                return have
            except AbenixError as e:
                # only a refused key is replaced, a platform blip must not revoke a key a running bff uses
                if e.status not in (401, 403):
                    raise SystemExit(f"Abenix did not answer cleanly ({e.status}: {e}), try again")
    email = env("ABENIX_ADMIN_EMAIL", "admin@abenix.dev")
    password = env("ABENIX_ADMIN_PASSWORD", "Admin123456")
    name = key_name()
    key = await bootstrap_key(base, email, password, name)
    # only this install's older key is revoked, another clone on the same Abenix keeps working
    async with Abenix(api_key=key, base_url=base) as f:
        for k in await f.api_keys.list():
            if k.get("name") == name and not key.endswith(str(k.get("key_prefix", ""))[-4:]):
                await f.api_keys.revoke(k["id"])
    write_env({"ABENIX_URL": base, "ABENIX_API_KEY": key})
    print(f"  key        {name:<28} minted     written to .env")
    return key


def key_name() -> str:
    """groundwork-<host>-<folder>, so each clone owns exactly one key."""
    import socket

    host = "".join(c for c in socket.gethostname().lower() if c.isalnum())[:16] or "host"
    return f"groundwork-{host}-{hashlib.sha1(str(ROOT).encode()).hexdigest()[:6]}"


# code assets

def zip_dir(d: Path) -> tuple[bytes, str]:
    buf = io.BytesIO()
    h = hashlib.sha256()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(d.rglob("*")):
            if p.is_dir() or "__pycache__" in p.parts or p.suffix == ".pyc":
                continue
            rel = p.relative_to(d).as_posix()
            data = p.read_bytes()
            h.update(rel.encode() + b"\0" + data)
            info = zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    return buf.getvalue(), h.hexdigest()[:16]


async def assets(f: Abenix, rep: Report) -> dict:
    ids = {}
    existing = {a["name"]: a for a in await f.code_assets.list()}
    for d in sorted((AB / "code-assets").iterdir()):
        if not d.is_dir():
            continue
        blob, digest = zip_dir(d)
        name = d.name
        readme = (d / "README.md").read_text().strip().splitlines()[0].lstrip("# ") if (d / "README.md").exists() else name
        desc = f"Groundwork: {readme} [src {digest}]"
        a = existing.get(name)
        if a and digest in (a.get("description") or ""):
            ids[name] = a["id"]
            rep.add("code", name, "same", f"/code-runner?asset={a['id']}", f"v{a.get('version')}")
            continue
        if a:
            v = await f.code_assets.new_version(a["id"], blob, filename=f"{name}.zip")
            await f.code_assets.update(a["id"], description=desc)
            ids[name] = a["id"]
            rep.add("code", name, "updated", f"/code-runner?asset={a['id']}", f"v{(v or {}).get('version')}")
        else:
            c = await f.code_assets.create(name, blob, description=desc, filename=f"{name}.zip")
            ids[name] = c["id"]
            rep.add("code", name, "created", f"/code-runner?asset={ids[name]}")
    # first call starts the warm runner
    t0 = time.perf_counter()
    r = await f.code_assets.run(ids["gw-site-twin"], {"op": "site"}, timeout=180)
    rep.add("code", "gw-site-twin", "warm", note=f"first call {1000 * (time.perf_counter() - t0):.0f} ms, runner {(r.get('metadata') or {}).get('runner')}")
    return ids


# decisions

SOLE_REASON = "Installed from the Groundwork repo by the only admin in this workspace"


def _canon(rules):
    return json.dumps([{k: r.get(k) for k in ("ruleKey", "when", "then")} for r in rules], sort_keys=True)


async def _sync_tests(f: Abenix, key: str, tests: list) -> None:
    have = {t["name"]: t for t in await f.decisions.tests(key)}
    for t in tests:
        h = have.get(t["name"])
        if h is None:
            await f.decisions.add_test(key, t["name"], t["facts"], expected=t.get("expected"))
        elif h.get("expected") != t.get("expected") or h.get("facts") != t["facts"]:
            await f.decisions.update_test(key, h["id"], facts=t["facts"], expected=t.get("expected"))


def _live(cur: dict) -> int | None:
    return max((p["version"] for p in cur.get("published") or [] if p.get("state") == "published"), default=None)


async def _settle(f: Abenix, rep: Report, key: str, n: int, state: str) -> None:
    """Publish a version once its tier's sign-off is in. Sign alone only when nobody else can."""
    link = f"/decisions/{key}"
    if state == "approved":
        await f.decisions.publish(key, n)
        rep.add("decision", key, "published", link, f"v{n} in force, its tier needed no sign-off")
        return
    info = await f.decisions.sign_off_info(key, n)
    if info.get("status") == "approved":
        await f.decisions.publish(key, n)
        rep.add("decision", key, "published", link, f"v{n} in force, signed off in Abenix")
        return
    if info.get("sole_operator_available") and info.get("approval_id"):
        await f.approvals.signoff(info["approval_id"], "approve", reason=SOLE_REASON, sole_operator=True)
        await f.decisions.publish(key, n)
        rep.add("decision", key, "published", link, f"v{n} in force, {info.get('tier')} tier")
        print(f"             This was a recorded self-approval: you are the only person in this workspace who can approve "
              f"{info.get('tier')} risk decisions, so you signed it alone with the reason \"{SOLE_REASON}\". "
              "Every admin was told and the audit log shows approval.self_approved.")
        return
    people = info.get("eligible_approvers") or []
    who = ", ".join(f"{p.get('name')} <{p.get('email')}>" for p in people) or "nobody yet, an admin can grant approvals.sign and decisions.review"
    rep.add("decision", key, "waiting", link, f"v{n} needs {info.get('required')} sign-off: {info.get('policy_text')}")
    print(f"             Can approve: {who}")
    print("             It waits in Abenix under Approvals. Run this script again after it is approved to publish it. "
          "Until then the bff keeps using the version in force, or has none for this decision if nothing is published yet.")


async def decisions(f: Abenix, rep: Report) -> None:
    for p in sorted((AB / "decisions").glob("*.json")):
        spec = json.loads(p.read_text())
        key = spec["key"]
        link = f"/decisions/{key}"
        tier = spec.get("risk_tier", "high")
        try:
            cur = await f.decisions.get(key)
        except AbenixDecisionError as e:
            if e.status != 404:
                raise
            cur = None
        if cur is not None:
            waiting = [v for v in cur.get("proposed") or [] if v.get("state") in ("proposed", "approved")]
            if waiting:
                # a version from an earlier run still waits, finish that before proposing another
                v = max(waiting, key=lambda x: x["version"])
                await _settle(f, rep, key, v["version"], v["state"])
                continue
            live = _live(cur)
            if live is not None:
                exp = await f.decisions.export(key, live)
                if _canon(exp.get("rules") or []) == _canon(spec["rules"]):
                    await _sync_tests(f, key, spec.get("tests", []))
                    rep.add("decision", key, "same", link, f"v{live} in force")
                    if cur.get("risk_tier") != tier:
                        print(f"             The repo says {tier} risk, Abenix has {cur.get('risk_tier')}. Change it on the decision page if that is wrong.")
                    continue
        preview = await f.decisions.import_file(spec, preview=True)
        errors = [x for x in preview.get("problems") or [] if x.get("severity") == "error"]
        if errors:
            rep.add("decision", key, "refused", link, "; ".join(f"{x.get('path')}: {x.get('message')}" for x in errors)[:300])
            continue
        imp = await f.decisions.import_file(spec)
        if imp.get("no_changes") or not imp.get("created", True) and imp.get("version") is None:
            # the latest version already holds these rules, nothing new to propose
            rep.add("decision", key, "same", link, "the latest version already has these rules")
            continue
        n = imp["version"]
        rep.add("decision", key, "imported", link, f"v{n} draft at {imp.get('risk_tier')} risk, {imp.get('tests_added', 0)} tests added, "
                f"{imp.get('tests_updated', 0)} updated")
        if imp.get("tier_note"):
            print(f"             {imp['tier_note']}")
        note = "Initial rules from the Groundwork repo" if cur is None else "Rules changed in the Groundwork repo"
        try:
            v = await f.decisions.propose(key, n, note=note)
        except AbenixDecisionError as e:
            rep.add("decision", key, "not ready", link, f"v{n} stays a draft: {e}"[:300])
            continue
        await _settle(f, rep, key, n, v.get("state"))


# agents and pipelines

def _model_config(spec: dict, asset_ids: dict) -> dict:
    mc = dict(spec.get("model_config") or {})
    for k in ("output_schema", "input_variables", "example_prompts", "tool_config"):
        if k in spec:
            mc[k] = spec[k]
    if spec.get("mode") == "pipeline":
        raw = json.dumps(spec["pipeline_config"])
        for name, aid in asset_ids.items():
            raw = raw.replace("${asset:" + name + "}", aid)
        if "${asset:" in raw:
            raise SystemExit(f"{spec['slug']}: a code asset it names was not provisioned")
        mc["pipeline_config"] = json.loads(raw)
        mc["mode"] = "pipeline"
        mc.setdefault("model", "claude-haiku-4-5-20251001")
    return mc


async def upsert_agent(f: Abenix, spec: dict, asset_ids: dict, rep: Report, kind: str) -> str:
    mc = _model_config(spec, asset_ids)
    slug = spec["slug"]
    body = {"description": spec.get("description", ""), "system_prompt": spec.get("system_prompt", ""), "model_config": mc,
            "category": spec.get("category", "construction")}
    a = await f.agents.by_slug(slug)
    link = "/builder?agent={}"
    if a is None:
        a = await f.agents.create({"name": spec["name"], "slug": slug, "agent_type": "custom", **body})
        rep.add(kind, slug, "created", link.format(a["id"]))
    else:
        old = a.get("model_config") or {}
        same = (old.get("tools") == mc.get("tools") and a.get("system_prompt") == body["system_prompt"]
                and a.get("description") == body["description"]
                and json.dumps(old.get("tool_config"), sort_keys=True) == json.dumps(mc.get("tool_config"), sort_keys=True)
                and json.dumps(old.get("pipeline_config"), sort_keys=True) == json.dumps(mc.get("pipeline_config"), sort_keys=True)
                and old.get("model") == mc.get("model") and json.dumps(old.get("output_schema"), sort_keys=True) == json.dumps(mc.get("output_schema"), sort_keys=True))
        if same:
            rep.add(kind, slug, "same", link.format(a["id"]))
        else:
            a = await f.agents.update(a["id"], body) or a
            rep.add(kind, slug, "updated", link.format(a["id"]))
    if (a.get("status") or "active") != "active":
        await f.agents.update(a["id"], {"status": "active"})
    return a["id"]


async def agents(f: Abenix, rep: Report, asset_ids: dict, folder: str, kind: str) -> dict:
    out = {}
    for p in sorted((AB / folder).glob("*.yaml")):
        spec = yaml.safe_load(p.read_text())
        out[spec["slug"]] = await upsert_agent(f, spec, asset_ids, rep, kind)
    return out


# signal rules on the industrial PCs

PCS = {"ipc-ex1": ("Excavator EX1", "machine"), "ipc-tc1": ("Tower crane TC1", "machine"),
       "ipc-ht1": ("Haul truck HT1", "vehicle"), "ipc-dz1": ("Dozer DZ1", "machine")}
PC_TAG = "groundwork-ipc"


def _norm(v):
    """Rules come back with whole numbers as floats, compare them as numbers."""
    if isinstance(v, bool) or v is None:
        return v
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, dict):
        return {k: _norm(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_norm(x) for x in v]
    return v


def _rule_body(spec: dict, agent_ids: dict) -> dict:
    cond = dict(spec["condition"])
    if cond.get("polygon") == "haul_corridor":
        # the polygon is the twin's own: the layout's bay, ramp, haul road and spoil area
        sys.path.insert(0, str(AB / "code-assets" / "gw-site-twin"))
        from twin import hybrid, layout
        layout.use(env("GW_SITE", "northgate"))
        cond["polygon"] = hybrid.corridor()
    acts = []
    for a in spec.get("actions") or []:
        a = dict(a)
        if a.get("kind") == "run":
            slug = a.pop("agent")
            if slug not in agent_ids:
                raise SystemExit(f"rule {spec['name']}: agent {slug} was not provisioned")
            a["agent_id"] = agent_ids[slug]
        acts.append(a)
    return {"description": spec.get("description"), "severity": spec.get("severity", "warning"),
            "cooldown_s": int(spec.get("cooldown_s", 60)), "scope": spec["scope"], "condition": cond, "actions": acts}


async def rules(f: Abenix, rep: Report, agent_ids: dict) -> None:
    for node, (label, kind) in PCS.items():
        try:
            a = await f.telemetry.asset("groundwork", node)
            tags = sorted(set((a.get("tags") or []) + [PC_TAG]))
            if a.get("display_name") != label or a.get("type") != kind or tags != sorted(a.get("tags") or []):
                await f.telemetry.update_asset("groundwork", node, display_name=label, type=kind, tags=tags)
                rep.add("asset", f"groundwork/{node}", "updated", f"/telemetry?group=groundwork&node={node}", f"{label}, tag {PC_TAG}")
            else:
                rep.add("asset", f"groundwork/{node}", "same", f"/telemetry?group=groundwork&node={node}", label)
        except AbenixError as e:
            rep.add("asset", f"groundwork/{node}", "skipped", "", f"not streaming yet ({e.message[:80]}). Deploy the PCs first")
    have = {r["name"]: r for r in await f.telemetry.rules()}
    for p in sorted((AB / "rules").glob("*.yaml")):
        spec = yaml.safe_load(p.read_text())
        body = _rule_body(spec, agent_ids)
        # evidence the rule is not tuned for a demo: what it would have done on the last hours of normal work
        try:
            pv = await f.telemetry.preview_rule(body["scope"], body["condition"], cooldown_s=body["cooldown_s"], hours=6)
            n = int(pv.get("fired") or 0)
            note = f"replayed on the last 6 h: would have fired {n} time{'' if n == 1 else 's'}"
        except AbenixError as e:
            note = f"preview: {e.message[:80]}"
        cur = have.get(spec["name"])
        if cur is None:
            r = await f.telemetry.create_rule(spec["name"], body["scope"], body["condition"], body["actions"],
                                              description=body["description"], severity=body["severity"], cooldown_s=body["cooldown_s"])
            rep.add("rule", spec["name"], "created", f"/telemetry/rules/{r['id']}", note)
        else:
            want = {k: body[k] for k in ("description", "severity", "cooldown_s", "scope", "condition", "actions")}
            keys = ("description", "severity", "cooldown_s", "scope", "condition")
            same = all(_norm(cur.get(k)) == _norm(want[k]) for k in keys) and len(cur.get("actions") or []) == len(want["actions"]) and                 all(_norm({k: v for k, v in a.items() if k in w}) == _norm(w) for a, w in zip(cur.get("actions") or [], want["actions"]))
            if same:
                rep.add("rule", spec["name"], "same", f"/telemetry/rules/{cur['id']}", note)
            else:
                await f.telemetry.update_rule(cur["id"], **want)
                rep.add("rule", spec["name"], "updated", f"/telemetry/rules/{cur['id']}", note)


# knowledge

KBS = [
    {"name": "gw-site-safety-plan", "slug": "gw-site-safety-plan", "folder": "site-safety-plan",
     "description": "Northgate Yard site safety plan and lifting plan",
     "agents": ["gw-safety-officer", "gw-site-superintendent", "gw-crane-coordinator"]},
    {"name": "gw-machine-manuals", "slug": "gw-machine-manuals", "folder": "machine-manuals",
     "description": "Machine manuals with J1939 fault code tables", "agents": ["gw-maintenance-tech"]},
]


async def kb(f: Abenix, rep: Report) -> None:
    res = await f.knowledge.bootstrap_project(
        "groundwork", "Groundwork", "Northgate Yard knowledge for the Groundwork agents",
        collections=[{"name": k["name"], "slug": k["slug"], "description": k["description"], "default_visibility": "project",
                      "vector_backend": "pgvector", "agent_slugs": k["agents"], "agent_permission": "READ"} for k in KBS])
    cols = {c.get("slug") or c.get("name"): c for c in (res.get("collections") or [])}
    for k in KBS:
        col = cols.get(k["slug"]) or cols.get(k["name"])
        if not col:
            rep.add("kb", k["name"], "missing", note=json.dumps(res)[:200])
            continue
        kid = col.get("id") or col.get("knowledge_base_id")
        docs = {d.get("filename") or d.get("original_filename") or d.get("name") for d in await f.knowledge.documents(kid)}
        added = 0
        for p in sorted((AB / "kb" / k["folder"]).glob("*.md")):
            if p.name in docs:
                continue
            await f.knowledge.upload(kid, str(p))
            added += 1
        rep.add("kb", k["name"], "updated" if added else "same", f"/knowledge/{kid}", f"{added} new documents, granted to {', '.join(k['agents'])}")


# earned autonomy

async def autonomy(f: Abenix, rep: Report, agent_ids: dict) -> None:
    spec = yaml.safe_load((AB / "autonomy" / "action_types.yaml").read_text())
    for at in spec["action_types"]:
        for slug in at["agents"]:
            body = {"agent_id": agent_ids[slug], "tool_name": at["tool_name"], "action_type": {
                "label": at["label"], "key": at["key"], "match": at.get("match"), "world_model": at.get("world_model"),
                "outcome_probe": at.get("outcome_probe"), "max_band_width": at.get("max_band_width")}}
            body["action_type"] = {k: v for k, v in body["action_type"].items() if v is not None}
            try:
                g = await f.autonomy.enrol(body["agent_id"], body["tool_name"], body["action_type"])
            except AbenixError as e:
                rep.add("autonomy", f"{at['key']} {slug}", "refused", note=str(e)[:200])
                continue
            rep.add("autonomy", at["key"], "enrolled", "/autonomy", f"{slug} at level {g.get('level', 0)}")


# ML models, trained in Abenix

async def models(f: Abenix, rep: Report, retrain: bool, only: str = "") -> None:
    have = {}
    for m in await f.ml_models.list():
        if m.get("status") == "ready" and m.get("is_active"):
            have[m["name"]] = m
    for name, kind in MODELS.items():
        if name in have and (not retrain or (only and name != only)):
            rep.add("model", name, "same", f"/ml-models?model={have[name]['id']}", f"v{have[name].get('version')}")
            continue
        t0 = time.perf_counter()
        res = await f.execute("gw-train-models", f"Train {name}", context={"kind": kind, "model": name, "seed": 11},
                              wait_timeout_seconds=900)
        out = _final(res.output)
        if not out or not out.get("onnx_b64"):
            rep.add("model", name, "failed", note=f"training run {res.execution_id}: {str(res.output)[:300]}")
            continue
        card = out["card"]
        metrics = ", ".join(f"{k} {round(v, 3) if isinstance(v, float) else v}" for k, v in out["metrics"].items())
        try:
            m = await f.ml_models.upload(name, base64.b64decode(out["onnx_b64"]), framework="onnx", filename=f"{name}.onnx",
                                         description=f"{card['type']}. {card['predicts']}. {card['data']}. Test metrics: {metrics}",
                                         input_schema=out["input_schema"], output_schema=out["output_schema"], tags=["groundwork"])
        except AbenixError as e:
            rep.add("model", name, "refused", note=str(e)[:300])
            continue
        mid = m["id"]
        rep.add("model", name, "trained", f"/ml-models?model={mid}",
                f"{out['bytes']} B onnx, {json.dumps({k: (round(v, 3) if isinstance(v, float) else v) for k, v in out['metrics'].items()})} in {time.perf_counter() - t0:.0f} s, run {res.execution_id}")


def _final(output):
    o = output
    for _ in range(4):
        if isinstance(o, str):
            try:
                o = json.loads(o)
            except ValueError:
                return None
        if isinstance(o, dict) and "onnx_b64" in o:
            return o
        if isinstance(o, dict):
            o = o.get("result") or o.get("output") or o.get("train") or o.get("response")
    return None


async def check(f: Abenix, rep: Report, asset_ids: dict) -> None:
    """One real call of each kind, so a broken install shows up here and not in the demo."""
    t0 = time.perf_counter()
    d = await f.decisions.evaluate("gw.safety.exclusion", {"machine": {"tip_speed_ms": 4.0}, "worker": {"clearance_m": 3.0}})
    rep.add("check", "decision evaluate", d.get("outcome"), note=f"{d.get('result')} in {1000 * (time.perf_counter() - t0):.0f} ms")
    try:
        t0 = time.perf_counter()
        p = await f.ml_models.predict("gw-cycle-time", [[220.0, 1, 0, 1]])
        rep.add("check", "ml predict", "ok", note=f"gw-cycle-time {p.get('predictions')} in {1000 * (time.perf_counter() - t0):.0f} ms")
    except Exception as e:  # noqa: BLE001
        rep.add("check", "ml predict", "failed", note=str(e)[:200])


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=",".join(STEPS))
    ap.add_argument("--retrain", action="store_true")
    ap.add_argument("--model", default="", help="with --retrain, only this model")
    args = ap.parse_args()
    only = set(args.only.split(","))
    base = env("ABENIX_URL", "http://localhost:8000").rstrip("/")
    web = env("ABENIX_WEB_URL", "http://localhost:3000")
    rep = Report(web)
    print(f"Provisioning Groundwork into {base}")
    key = await mint_key(base)
    async with Abenix(api_key=key, base_url=base, timeout=900) as f:
        asset_ids = await assets(f, rep) if "assets" in only or "pipelines" in only or "models" in only else {}
        if "decisions" in only:
            await decisions(f, rep)
        agent_ids = {}
        if "agents" in only or "autonomy" in only or "rules" in only:
            agent_ids = await agents(f, rep, asset_ids, "agents", "agent")
        if "pipelines" in only:
            await agents(f, rep, asset_ids, "pipelines", "pipeline")
        if "kb" in only:
            await kb(f, rep)
        if "autonomy" in only:
            await autonomy(f, rep, agent_ids)
        if "models" in only:
            await models(f, rep, args.retrain, args.model)
        if "rules" in only:
            await rules(f, rep, agent_ids)
        if "check" in only:
            await check(f, rep, asset_ids)
    rep.show()


if __name__ == "__main__":
    asyncio.run(main())
