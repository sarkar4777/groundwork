# Architecture

Groundwork is a browser UI and a thin backend. Everything that computes runs in Abenix, reached through the public API and the Python SDK the way any customer would reach it.

```mermaid
flowchart LR
  subgraph Browser
    W[web, port 5710<br/>drone feed, twin, panels]
  end
  subgraph Groundwork bff, port 8710
    C[clock and fan-out<br/>holds the Abenix key<br/>keeps the last frame]
  end
  subgraph Abenix
    T[gw-site-twin code asset<br/>warm runner, handler mode<br/>45 vECUs at 100 Hz, J1939, Sparkplug<br/>safety rules every tick]
    D[Decisions<br/>gw.safety.exclusion, gw.crane.limits<br/>gw.truck.speed, gw.simplex.switch]
    M[ML models<br/>six ONNX models]
    P[Pipelines<br/>dispatch, near miss, fault triage,<br/>weather hold, shift start, end of shift, training]
    A[Agents<br/>superintendent, safety officer, crane coordinator,<br/>dispatcher, maintenance, surveyor, reporter,<br/>foreman voice, vECU builder]
    G[Governance<br/>Earned Autonomy, approvals, kill switch, lessons]
    K[Knowledge<br/>site safety plan, machine manuals]
  end
  W <-- ws frames, HTTP --> C
  C -- code_assets.run every step --> T
  D -- published rules, versioned --> C
  C -- rules travel into each step --> T
  C -- ml_models.predict --> M
  C -- decisions.evaluate_batch --> D
  C -- execute --> P
  C -- execute --> A
  C -- actions.propose, approvals --> G
  P --> A
  A --> K
  A --> D
```

## Who does what

| Part | Where it runs | What it does |
|---|---|---|
| Site twin | Abenix code asset `gw-site-twin`, warm runner in handler mode | Kinematics of 15 machines and 14 workers, terrain cut and fill, haul cycles, crane lifts with the load moment indicator, wind with gusts, 45 vECUs at 100 Hz, J1939 and Sparkplug B encoding, fault codes, the behaviour tree, the safety rules every tick |
| Safety rules | Abenix decision tables, evaluated inside every twin tick | Exclusion zones, crane limits, truck speed caps, the Simplex switch |
| Prediction | Abenix ML models | Worker path, crane collision, hydraulic anomaly, payload, gust nowcast, cycle time |
| Coordination | Abenix pipelines and code assets | Truck dispatch with `gw-dispatch-optimiser`, near miss write-ups, fault triage, weather holds |
| Supervision | Abenix agents | The shift plan as a behaviour tree, replans, diagnoses, reports, the AI-written telehandler controller |
| People | Abenix approvals, Earned Autonomy, kill switch | Approve plan changes, review the dispatcher's moves, stop every agent |
| Training | Abenix pipeline `gw-train-models` | The twin generates data, `gw-model-trainer` trains and exports ONNX, provision registers it |
| bff | Groundwork, Python | The clock, SDK calls, websocket fan-out. No domain code |
| web | Groundwork, browser | The ground station |

## The step

Abenix has no fixed-rate loop today, so the bff is the metronome. Each step it sends the whole site state into the twin and gets the next state back:

```
in:  {"op": "step", "state_z": <zlib+base64 JSON, about 14 KB>, "ticks": n, "rules": <changed tables>,
      "ml_results": {...}, "faults": [...], "plan": {...}, "dispatch": [...], "clear_simplex": ...}
out: {"state_z": ..., "frame": <the contract state frame>, "bus": [...], "events": [...], "plan": {...},
      "ml": <feature rows the models should score>, "audit_facts": [...], "outcomes": [...], "stats": {...}}
```

The step is a pure function of its input. Any warm runner replica can serve any step, two takes with the same seed and the same inputs are identical (tested across processes), and nothing about the site lives in Groundwork except the last state blob Abenix returned.

Inside a step the twin runs `n` controller ticks of 10 ms, so the controllers and the safety rules really do run at 100 Hz of site time. The bff asks for as many ticks as wall time has passed since the last step, so site time keeps pace with the clock as long as Abenix answers in under half a second. In Story mode every step is 5 ticks, so takes are identical.

### Where the safety rules run, and why

The four decision tables are written, versioned, tested and published in Abenix Decisions. The bff fetches the published version with `decisions.export` every 30 s and sends a table into the twin whenever its version changes. The twin compiles the typed JSON rules once and evaluates them in every 10 ms tick, first matching rule wins, exactly as Abenix does. If no table has arrived, every machine holds.

They run inside the step and not as a decision API call per tick because a call costs 3 to 30 ms and there are about 30 evaluations per tick. Once a second the bff sends the excavators' live facts to `decisions.evaluate_batch` and the twin compares the two answers, so `l2_ms` is a real Abenix evaluation and any disagreement shows up as a fault event. Plan checks (every crane lift in a proposed plan against `gw.crane.limits`) and the pipelines use the decision API directly.

A change to a rule therefore goes: rule builder in Abenix, golden tests, sign-off by a second person (the tables are high risk), publish, picked up by the next step.

### Safety never waits for the AI

Agents, models and pipelines are called from background tasks with their own timeouts and circuit breakers. The step never waits for them. Their answers are queued and go into the next step. "AI offline" on the fault deck stops every one of those calls, the twin switches to the fallback plan through `gw.simplex.switch`, and the safety rules carry on unchanged. The kill switch sets real Abenix kill switches on every Groundwork agent and pipeline, so their next runs are refused by Abenix.

## Lanes

Every Abenix call goes through a lane with a timeout and a circuit breaker: three failures open it, it fails fast for a cool-down, then lets one trial call through.

| Lane | Timeout | Used for |
|---|---|---|
| twin | 5 s | The step, brief, terrain, plan checks |
| ml | 3 s | Predictions |
| decisions | 3 s | Rule audits and plan checks |
| pipelines | 300 s | The six pipelines |
| agents | 300 s | Agent runs |
| platform | 15 s | Rules fetch, Earned Autonomy, approvals, lessons |

`GET /health` shows each lane's state, call count, errors and latency.

## Earned Autonomy and approvals

| Action type | Agent | What happens at each level |
|---|---|---|
| `gw.plan.change` | Site Superintendent, vECU Builder | Watching: Groundwork opens an Abenix approval and waits for a person. Asks first: the action's own approval. Acts within limits: applied at once |
| `gw.truck.reroute` | Fleet Dispatcher | Watching: recorded for review, not applied. Asks first: waits for approval. Acts within limits: applied, executed reported, the cycle time reported as the outcome |
| `gw.crane.slew_plan` | Crane Coordinator | Enrolled, reviewed in Abenix |
| `gw.machine.safe_mode` | Maintenance Technician | Enrolled, reviewed in Abenix |

Every grant starts at Watching. Promotion needs the record Abenix asks for (20 reviews with 70 percent agreement for Asks first) and a person who did not build the agent. Groundwork never promotes anything itself. The phone mock-up's Approve button calls `POST /approve` on the bff, which signs the real Abenix approval.

## Story mode

See [story.md](story.md).

## Measured

All numbers from a laptop running Abenix on local Kubernetes (minikube), see the README for the run commands.

| What | Number |
|---|---|
| Twin step compute, 5 ticks, in process | p50 2.2 ms, p99 4.1 ms (0.8 ms per tick) |
| Safety rules per 10 ms tick, in process | p99 0.50 ms |
| Twin step through Abenix (SDK, warm runner, 16 KB in, 26 KB out), bff in the cluster | p50 18.4 ms, a fixed 20 Hz step with 5 ticks, so site time is wall time |
| Same, bff on a Windows host through `kubectl port-forward` | p50 64 ms, p99 183 ms. The forward stalls request bodies over about 6 KB by about 44 ms |
| Decision evaluate (single, warm) | about 3 ms server side, 11 ms p50 through the SDK |
| ML predict through the SDK | p50 8 ms in the cluster, 10 to 19 ms from the host |
| Pipeline with an agent step | 15 to 30 s |
| Agent run | 15 to 20 s for the superintendent |

## What changes when Abenix gains a fixed-rate runner

Abenix 2.5.6 is adding a fixed-rate execution primitive for code assets. When it lands the loop that calls the twin moves into Abenix, the bff stops being the metronome and only fans frames out. Nothing in the twin or the web changes.
