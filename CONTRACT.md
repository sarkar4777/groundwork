# Groundwork build contract

The single source both halves of the build follow. Change it only by agreement, and say so in the change.

Groundwork is an open-source showcase: an autonomous construction site, Northgate Yard, run by Abenix. It is a separate project from Abenix and talks to it only through the public API and the Python SDK, the way any customer would. The full plan is `PLAN.md`.

## Layout

```
groundwork/
  bff/            Python 3.12, FastAPI + asyncio. Backend for the frontend: holds the Abenix key, runs the clock, calls Abenix through the SDK, fans frames out on the websocket. No domain logic
  web/            Vite + React 18 + TypeScript + react-three-fiber. The ground-station UI
  abenix/         What Groundwork puts into Abenix: the site twin and other code assets, agents, pipelines, decision tables, ML training, knowledge docs
  scripts/        dev.sh (start sim + web), provision.py (load abenix/ into an Abenix instance), capture.mjs (record the story)
  docs/           architecture, signals, story script, screenshots
  ASSETS.md       every third-party asset, source URL, licence (CC0 only)
  LICENSE         MIT
  README.md
```

Change agreed with the owner, 2026-10-10: everything runs in Abenix. The site twin (kinematics, terrain, the 45 vECUs, J1939 and Sparkplug encoding, the safety rules) is the Abenix code asset `gw-site-twin`, stepped by the bff through the SDK. `sim/` became `bff/`. Ports and every frame format below are unchanged. Fields marked additive are extra and may be ignored.

Ports: bff `8710` (HTTP + WebSocket), web `5710`. Abenix defaults to `http://localhost:8000`, set by `ABENIX_URL`. The Abenix API key comes from `ABENIX_API_KEY`, minted by `scripts/provision.py` (signs in with `ABENIX_ADMIN_EMAIL` / `ABENIX_ADMIN_PASSWORD`, creates a key named `groundwork`, writes it to `.env`).

## Coordinates and units

- Site frame: metres, origin at the site centre, `x` east, `y` north, `z` up. Site is 200 m x 200 m.
- Headings and angles in radians in the protocol, degrees only in the UI.
- Time: sim seconds as float `t`, wall clock ISO in logs.

## The live channel

`ws://localhost:8710/ws` sends JSON frames. The web never polls the sim for state.

```jsonc
// 20 Hz, the whole twin
{ "type": "state", "t": 123.45, "seq": 2469,
  "machines": [ { "id": "EX1", "kind": "excavator", "x": 10.2, "y": -4.1, "z": 0, "heading": 1.57,
                  "joints": { "swing": 0.4, "boom": 0.6, "stick": -0.9, "bucket": 0.3 },
                  "speed": 0.0, "mode": "auto|hold|fallback|manual|offline",
                  "load_t": 2.1, "fuel_pct": 71, "health": "ok|warn|fault", "task": "load truck HT3" } ],
  "workers":  [ { "id": "W07", "role": "banksman", "x": 3.1, "y": 8.0, "heading": 0.2, "zone": "ok|warn|danger" } ],
  "cranes":   [ { "id": "TC1", "slew": 1.2, "luff": 0.7, "hook": [12.0, 30.5, 18.0], "load_t": 2.4, "lmi_pct": 63, "wind_ms": 8.4 } ],
  "terrain":  { "rev": 41 },               // bump when the dig heightmap changes, fetch /terrain?rev=41
  "sensors":  { "wind_ms": 8.4, "gust_ms": 11.0, "dust_ugm3": 38, "noise_db": 74, "wall_tilt_mm": 1.2 },
  "safety":   { "envelope": "ok|warn|stop", "active_stops": [ { "machine": "EX1", "rule": "worker_in_swing", "since": 120.1 } ] },
  "latency":  { "l1_ms": 2.1, "l2_ms": 0.4, "l3_ms": 18.0, "l4_ms": 140, "l5_ms": 2800 },  // measured, see below
  "kpi":      { "m3_moved": 1840, "cycles": 212, "trucks_waiting": 1, "ai_cost_usd": 0.42 } }

// as they happen
{ "type": "bus",      "t": 123.451, "machine": "EX1", "ecu": "HYD", "pgn": 65262, "sa": 3, "data": "0011223344556677", "name": "Engine temperature", "decoded": { "coolant_c": 88 } }
{ "type": "event",    "t": 120.10,  "kind": "safety_stop|near_miss|fault|gust|plan_change|approval|autonomy|story", "machine": "EX1", "title": "Safety stop", "detail": "Worker W07 inside swing radius", "ms": 3.1 }
{ "type": "agent",    "t": 121.8,   "agent": "site-superintendent", "phase": "thinking|tool|answer|waiting_approval", "text": "Rerouting HT4...", "execution_id": "..." }
{ "type": "plan",     "t": 122.0,   "tree": { "id": "root", "label": "Shift plan", "status": "running", "children": [ ... ] } }
{ "type": "caption",  "t": 4.0,     "text": "A worker walks into the swing zone...", "until": 9.0 }  // story mode subtitles
```

`bus` frames are sampled for the browser at up to 200 per second. The sim itself runs every controller at 100 Hz.

HTTP on the sim:

| Route | Does |
|---|---|
| `GET /health` | ok plus Abenix reachability |
| `GET /terrain?rev=n` | heightmap, 256 x 256 float16, little-endian, base64 in JSON, plus cut/fill delta |
| `GET /site` | static layout: zones, haul roads, spoil area, design surface, building footprint, crane bases |
| `POST /fault` | `{ "kind": "cut_can|drop_gnss|gust|worker_in_swing|ai_offline|kill_switch|clear", "target": "EX1" }` |
| `POST /story/start` | starts the 60 s Story mode from a fixed seed, `POST /story/stop` |
| `POST /approve` | forwards a person's decision to Abenix approvals, for the on-screen phone mock-up only. Real approvals happen in the Abenix UI |
| `GET /agents` | the Groundwork agents and their autonomy level, read from Abenix |

## Measured latency

Every number in `latency` is measured, never set by hand:

- `l1_ms`: the twin step round trip into Abenix (SDK `code_assets.run` on `gw-site-twin`), p99 over the last second.
- `l2_ms`: Abenix decision evaluation round trip (`gw.safety.exclusion` on the twin's live facts, once a second), p99 of the last 20.
- `l3_ms`: Abenix ML predict round trip, p50 over the last 20 calls.
- `l4_ms`: last pipeline or decision call round trip to Abenix.
- `l5_ms`: last agent run duration in Abenix.
- Additive: `l1_twin_run_ms` (step compute inside the runner), `l2_tick_ms` (rule evaluation inside one 10 ms tick, p99), `step_hz`, `ticks_per_step`.

Additive fields elsewhere: `state.ai_offline`, `state.killed`, `state.plan {source, version}`, `state.rules {key: version}`, `state.vecus`, `machines[].ecus`, `workers[].predicted` (worker path model, 1, 2 and 3 s ahead), `cranes[].radius`, `cranes[].chart_t`, `cranes[].kind`; `bus.can_id`, `bus.acronym`, `bus.proto` (`j1939` or `sparkplug_b`), `bus.topic` (Sparkplug); `agent.recorded` and `caption.recorded` (true when Story mode replays a recorded run); `GET /fleet` returns the ISO 15143-3 (AEMP 2.0) fleet snapshot.

## Abenix touchpoints

Everything below lives in `abenix/` and is loaded by `scripts/provision.py` through the SDK and public API. Names are prefixed `gw-` so they are easy to find in Abenix.

- Code assets: `gw-site-twin` (the site, its vECUs and its safety rules), `gw-dispatch-optimiser`, `gw-model-trainer`.
- Agents: `gw-site-superintendent`, `gw-safety-officer`, `gw-crane-coordinator`, `gw-fleet-dispatcher`, `gw-maintenance-tech`, `gw-earthworks-surveyor`, `gw-compliance-reporter`, `gw-foreman-voice`, plus `gw-vecu-builder` for the AI-written telehandler controller.
- Decision tables: `gw.safety.exclusion`, `gw.crane.limits`, `gw.truck.speed`, `gw.simplex.switch`.
- ML models: `gw-worker-path`, `gw-crane-collision`, `gw-hydraulic-anomaly`, `gw-payload`, `gw-gust-nowcast`, `gw-cycle-time`. Trained in Abenix by the `gw-train-models` pipeline on data the twin generates, registered as ONNX.
- Pipelines: `gw-shift-start`, `gw-near-miss`, `gw-dispatch-loop`, `gw-fault-triage`, `gw-weather-hold`, `gw-end-of-shift`, and `gw-train-models` (trains the six models in Abenix).
- Knowledge bases: `gw-site-safety-plan`, `gw-machine-manuals` (written by us, plain markdown).
- Earned Autonomy action types: `gw.truck.reroute`, `gw.crane.slew_plan`, `gw.plan.change`, `gw.machine.safe_mode`.

The twin step plays the edge: its safety rules run inside every tick and never wait for an agent, a model or a pipeline. "AI offline" stops every agent, model and pipeline call while the twin keeps stepping, so the site runs on its fallback plan, the UI shows "AI offline, site safe", and every safety number keeps updating. If Abenix itself is unreachable there is no twin to step: the bff sends a `fault` event and the site freezes, as a real site would stop when its controllers lose power.

## Look

Groundwork must not look like Abenix. Abenix is dark slate and cyan. Groundwork is deep ocean blue.

- Background: a vertical gradient from `#04122b` (top) through `#0a2a5e` to `#0d3b7a` (bottom), with a faint grid. Panels are frosted glass on blue, `rgba(10, 32, 72, 0.55)`, 1 px border `rgba(120, 180, 255, 0.18)`, 14 px radius, backdrop blur.
- Accents: sky `#5cc8ff`, ice `#c9ecff`, safety amber `#ffb020`, stop red `#ff4d5e`, ok mint `#3ee6a8`.
- Type: Inter for UI, JetBrains Mono for signals and numbers. Both from Google Fonts.
- The main view is a drone ground station. A top-down drone feed of the site fills the centre: photoreal-looking ground from CC0 aerial textures, the machines seen from above, soft shadows, slight lens vignette and sensor grain, and a flight HUD: altitude, gimbal pitch, GNSS fix, battery, wind, a REC dot with timecode, a north arrow and a scale bar. Overlays draw on the imagery like a survey tool: geofences, swing radius rings, crane slew envelopes, haul road lines, a cut/fill heat map and worker tags.
- A 3D twin view and the nervous system view are one keypress away. The story video cuts between drone feed, orbit, crane cab and the nervous system view.
- Every number on screen is live from the channel above.
