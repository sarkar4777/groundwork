# Northgate Yard site twin, 45 vECUs with J1939 and Sparkplug B, safety rules from Abenix decisions

One step advances the site by n ticks of 10 ms. The whole state comes in as state_z and goes out again, so the step is a pure function and any warm runner can serve it. Ops: init, step, site, terrain, check_plan, brief, aemp, dataset.

Two layouts share the same work. `northgate` is the rendered site the films were made on. `nh108` lays it on a real drone orthophoto of an excavation, with every haul road on a track the photo shows. Pass `"layout": "nh108"` to init or site. The layout then rides in the state, so steps need nothing extra. See docs/architecture.md and docs/signals.md in the Groundwork repo.

