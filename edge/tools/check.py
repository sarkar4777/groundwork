"""Checks the industrial PCs from the broker side, the way Abenix will see them.

    python -m tools.check --url mqtt://host:1883 [--seconds 20] [--hold ipc-ex1] [--json out.json]

Counts births, deaths and data per node and device, decodes Sparkplug metrics and raw J1939 frames, checks seq,
and with --hold sends Safety/Hold true then false as a DCMD and times the hold through to the bus.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import paho.mqtt.client as mqtt  # noqa: E402

from ipc import sparkplug as SP  # noqa: E402
from ipc.frames import J  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="mqtt://abenix-mosquitto.abenix.svc.cluster.local:1883")
    ap.add_argument("--seconds", type=float, default=20)
    ap.add_argument("--hold", default="")
    ap.add_argument("--json", default="")
    ap.add_argument("--fault", default="", help="node to raise a safety fault on, then clear")
    ap.add_argument("--print-json", action="store_true")
    ap.add_argument("--noise", default="", help="node whose CAN harness gets noisy for 6 s")
    a = ap.parse_args()
    u = urlparse(a.url)
    msgs = Counter()
    per_dev = Counter()
    raw_frames = Counter()
    pgn_count = defaultdict(Counter)
    latest: dict = defaultdict(dict)
    births = []
    deaths = []
    seq_last: dict = {}
    seq_gaps = Counter()
    samples: dict = defaultdict(list)
    hold_log = []
    noise_log = []
    mqtt_lat = defaultdict(list)
    bus_log = []
    t0 = time.time()

    def on_message(cl, ud, m):
        now = time.time()
        if m.topic.startswith("groundwork/"):
            node = m.topic.split("/")[1]
            batch = json.loads(m.payload)
            raw_frames[node] += len(batch)
            msgs[(node, "raw")] += 1
            for f in batch:
                _, pgn, sa, da = J.parse_can_id(int(f["id"]))
                p = J.PGNS.get(pgn)
                pgn_count[node][p.acronym if p else hex(pgn)] += 1
                if len(samples[node]) < 400:
                    samples[node].append(f)
                if a.hold and node == a.hold and p and p.acronym in ("EEC1", "SWB1", "SPLC1", "TSC1", "PROPA", "ACKM", "GNSS2", "SLEW1", "DM1", "TP.CM", "TP.DT", "AC", "RQST") and f["t"] > t0:
                    v = J.decode(pgn, bytes.fromhex(f["data"])) if p.spns else {}
                    bus_log.append((round(f["t"] - t0, 3), p.acronym, sa, da, f["data"], {k: v[k] for k in list(v)[:4]}))
            return
        parts = m.topic.split("/")
        kind, node = parts[2], parts[3]
        dev = parts[4] if len(parts) > 4 else ""
        msgs[(node, kind)] += 1
        p = SP.parse(m.payload)
        if kind in ("DDATA", "NDATA") and p.timestamp:
            mqtt_lat[node].append(now * 1000 - p.timestamp)
        if kind in ("NBIRTH", "NDATA", "DBIRTH", "DDATA"):
            last = seq_last.get(node)
            if kind != "NBIRTH" and last is not None and p.seq != (last + 1) % 256:
                seq_gaps[node] += 1
            seq_last[node] = p.seq
        if kind in ("NBIRTH", "DBIRTH"):
            births.append((round(now - t0, 3), kind, node, dev, len(p.metrics)))
        if kind == "NDEATH":
            deaths.append((round(now - t0, 3), node))
        if kind in ("DDATA", "DBIRTH"):
            per_dev[(node, dev)] += 1
        for met in p.metrics:
            if met.name:
                latest[(node, dev)][met.name] = SP.value_of(met)
        if a.noise and node == a.noise:
            for met in p.metrics:
                if met.name in ("Bus/State", "Bus/ErrorFrames", "ECU/TEC", "ECU/ErrorState"):
                    noise_log.append((round(now - t0, 3), dev or "node", met.name, SP.value_of(met)))
        if a.hold and node == a.hold and dev == "safety":
            for met in p.metrics:
                if met.name in ("Safety/Mode", "Safety/Hold", "Safety/Holding", "Diagnostics/DTCs", "Diagnostics/InjectFault"):
                    hold_log.append((round(now - t0, 3), met.name, SP.value_of(met)))

    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"gw-check-{int(t0)}")
    c.on_message = on_message
    c.connect(u.hostname, u.port or 1883, 10)
    c.subscribe([("spBv1.0/groundwork/#", 0), ("groundwork/+/can/raw", 0)])
    c.loop_start()
    # ask every node for a rebirth so the births land inside the window
    time.sleep(1.0)
    for n in ("ipc-ex1", "ipc-tc1", "ipc-ht1", "ipc-dz1"):
        c.publish(f"spBv1.0/groundwork/NCMD/{n}", SP.payload([("Node Control/Rebirth", True, SP.T.Boolean, None, False)], None))
    hold_sent = []

    def dcmd(node, metric, value, dt):
        hold_sent.append((metric, value, round(time.time() - t0, 3)))
        if metric.startswith("NCMD:"):
            c.publish(f"spBv1.0/groundwork/NCMD/{node}", SP.payload([(metric[5:], value, dt, None, False)], None))
            return
        c.publish(f"spBv1.0/groundwork/DCMD/{node}/safety", SP.payload([(metric, value, dt, None, False)], None))

    plan = []
    if a.noise:
        plan.append((0.1, a.noise, "NCMD:Bus/InjectNoise_s", 6.0, SP.T.Double))
    if a.hold:
        plan += [(0.3, a.hold, "Safety/Hold", True, SP.T.Boolean), (0.5, a.hold, "Safety/Hold", False, SP.T.Boolean)]
    if a.fault:
        plan += [(0.65, a.fault, "Diagnostics/InjectFault", 2, SP.T.Int32), (0.85, a.fault, "Diagnostics/InjectFault", 0, SP.T.Int32)]
    for frac, node, metric, value, dt in sorted(plan, key=lambda x: x[0]):
        wait = t0 + 1.0 + a.seconds * frac - time.time()
        if wait > 0:
            time.sleep(wait)
        dcmd(node, metric, value, dt)
    rest = t0 + 1.0 + a.seconds - time.time()
    if rest > 0:
        time.sleep(rest)
    c.loop_stop()
    span = time.time() - t0
    nodes = sorted({k[0] for k in msgs})
    out = {"seconds": round(span, 1), "nodes": {}}
    for n in nodes:
        out["nodes"][n] = {
            "mqtt_msgs_per_s": round(sum(v for k, v in msgs.items() if k[0] == n) / span, 1),
            "by_kind": {k[1]: v for k, v in msgs.items() if k[0] == n},
            "can_frames_per_s": round(raw_frames[n] / span, 1),
            "ddata_per_s_by_device": {k[1]: round(v / span, 1) for k, v in per_dev.items() if k[0] == n},
            "frames_by_pgn": dict(pgn_count[n].most_common()),
            "seq_gaps": seq_gaps[n],
            "gateway_to_subscriber_ms": {"p50": round(sorted(mqtt_lat[n])[len(mqtt_lat[n]) // 2], 2), "p99": round(sorted(mqtt_lat[n])[int(len(mqtt_lat[n]) * 0.99)], 2)} if mqtt_lat[n] else None,
            "node_metrics": {k: v for k, v in latest[(n, "")].items() if k.startswith(("Bus/", "Latency/", "Properties/", "bdSeq", "Uplink/"))},
        }
    out["births"] = births
    out["deaths"] = deaths
    out["hold"] = {"sent": hold_sent, "log": hold_log, "bus": bus_log}
    out["noise"] = noise_log
    out["latest"] = {f"{k[0]}/{k[1]}": v for k, v in latest.items() if k[1]}
    out["samples"] = {k: v[:40] for k, v in samples.items()}
    print(json.dumps({k: v for k, v in out.items() if k not in ("latest", "samples")}, indent=1, default=str))
    if a.json:
        Path(a.json).write_text(json.dumps(out, indent=1, default=str))
    if a.print_json:
        print("=====JSON=====")
        print(json.dumps(out, default=str))


if __name__ == "__main__":
    main()
