# The ground station

The web app in `web/` is a drone ground station for Northgate Yard. It draws what the bff streams on `ws://localhost:8710/ws` and computes nothing about the site itself. Every number on screen comes from a frame, and the frames come from Abenix.

```bash
cd web && npm install
npm run dev          # http://localhost:5710, proxies /sim to the bff on 8710
npm run build        # asset licence check, typecheck, production bundle
```

`SIM_URL=http://host:8710 npm run dev` points the proxy at another bff. `?sim=http://host:8710` in the page URL connects to one directly.

## Honesty marks

- **LIVE** in the top bar means frames are arriving from the bff. Next to it, **Computed in Abenix** shows the Abenix URL the bff reports on `/health`, green when Abenix answers.
- **Sim offline** shows a card in the feed with the command to start it. The client reconnects on its own with backoff and freezes the last frame if the link drops mid-shift.
- **REPLAY** appears when the page is opened with `?replay=1`. Frames are then synthesised in the browser by `web/src/dev/replay.ts` for design work without the bff. The top bar, the feed and every capture carry the mark, and the Abenix mark is replaced by "not computed in Abenix".
- **recorded run** on the story chip means the bff is replaying agent and model answers from a recorded Abenix run, so every take is identical.
- The latency strip is labelled **measured**. Each cell shows the p50 for that layer, from the bff when it sends `l1_p50_ms` to `l5_p50_ms`, otherwise from the readings the page received, with a sparkline of those readings.
- The AI cost KPI reads **subscription** when `kpi.ai_billing` says a Claude subscription serves the agent runs. Load cycles read **starting** until the first haul cycle completes.

## Views

| Key | View | What it shows |
|---|---|---|
| 1 | Drone feed | Nadir camera at 150 m with drift, grain, vignette and slight chromatic aberration. Scroll zooms the lens, Shift and scroll changes altitude, drag moves the aircraft |
| 2 | 3D twin | Orbit around the site |
| 3 | Follow | Chase camera on the selected machine |
| 4 | Crane cab | From the TC1 cab towards the hook, with LMI and wind gauges |
| 5 | Operator seat | From the EX1 cab, with joint angles and payload |
| X | Nervous system | The world dims. Twin steps and bus frames rise as light to the safety layer, decisions flash there, agent calls arc up to the Abenix core |

The flight HUD shows altitude above ground, gimbal pitch, a heading tape, RTK fix and satellites from the drone's GNSS frames, battery from the drone's state, wind from the site sensors, flight time, a REC timecode on sim time, a north arrow, a scale bar and site grid coordinates under the cursor.

## Survey overlays

Toggle them from the Overlays menu or press O to switch them all.

- Geofences and exclusion zones from `/site`
- Swing radius per excavator, red and pulsing during a safety stop
- Tower and mobile crane slew envelopes, red when the two jibs come within 8 m or a crane rule stops them
- Haul road centrelines with an ETA for each loaded truck, distance left on the road over its speed
- Cut and fill: blue where the pit is still above the design surface, mint at design, amber where fill was placed since shift start
- Worker tags, small until hovered unless the worker is in a warning or danger zone, and the Abenix ML path prediction 1 to 3 s ahead
- Machine labels with mode and task. Click a machine or its label for its panel

Tags never overlap. Safety stops, people in danger and the selected machine are placed first, the rest stack upward on a leader line, and anything that still does not fit folds into a `+n` chip on its nearest neighbour.

## Panels

vECU console, signal trace (decoded J1939 with CAN id and raw bytes, Sparkplug B topics, filter and pause), Site Pilot (behaviour tree with the active branch lit, agent reasoning, AI cost), layer latency L1 to L5, Earned Autonomy, fault deck, events, and an approvals phone. The phone is a mock-up for the video. A click on Approve posts to `/approve`, which signs the real Abenix approval.

Panels collapse, remember their state in the browser, and stack into one column on a phone.

## Story mode

Play the story (or P) posts `/story/start`. The bff restarts the twin from a fixed seed and the web runs the 60 second camera path from `web/src/story/shots.ts`, cutting between drone feed, orbit, crane cab, follow and the nervous system view in sync with sim time. Captions arrive as `caption` frames and show as subtitles, at most two lines, numbers in amber. After a take the SRT button in the top bar downloads the captions.

## Capture

```bash
node scripts/capture.mjs                 # live bff, 1920x1080 and 1080x1350
node scripts/capture.mjs --replay        # synthesised frames, every image marked REPLAY
node scripts/capture.mjs --shots-only    # screenshots only
```

Videos go to `docs/media/` with the SRT, screenshots to `docs/screenshots/`. Frames come from the Chrome screencast with their timestamps and ffmpeg resamples them to a constant 60 fps. Screenshot 09 is the Abenix agents page and needs `ABENIX_WEB_URL`, `ABENIX_ADMIN_EMAIL` and `ABENIX_ADMIN_PASSWORD`.

## Look and performance

Deep ocean blue, Inter and JetBrains Mono, sky, ice, amber, red and mint accents. Machines and workers are built in code from parametric parts in `web/src/scene/machines`, so every joint the twin reports is a real joint. Ground is painted from CC0 aerial textures, see `ASSETS.md`.

Ground, roads and the neighbourhood are painted from CC0 aerial, facade and roof scans, with a 4k detail layer, standing water on the pit floor, contact shadows under every machine and person, and a slightly desaturated survey grade. The hero shot gets golden-hour light and a tilt-shift edge blur.

The renderer is WebGL2. The WebGPU renderer was left out because the postprocessing stack the drone look depends on does not run on it yet. The 3D view holds 60 fps on integrated graphics by lowering its own render scale when frames run long, and raising it again when there is headroom. Capture and `?quality=high` run at full resolution with soft 4k shadows.

## Keyboard

`1` to `5` and `X` switch views, `P` plays or stops the story, `H` hides the panels, `O` toggles overlays, Space pauses the signal trace, `?` lists the shortcuts, Esc closes and deselects.
