# TH1 telehandler, boom controller spec

One page, the way a machine maker would hand it to a controls engineer.

## Machine

A 4 tonne telescopic handler that carries formwork from the gate to the laydown area. The boom pivots at the rear of the chassis and telescopes.

## Controller

Runs every 10 ms. Inputs each tick:

| Input | Unit | Meaning |
|---|---|---|
| target_angle | rad | Boom angle the operator or plan asks for |
| target_ext | m | Telescope extension asked for |
| load_t | t | Load on the forks |
| angle | rad | Boom angle now, from the last tick |
| ext | m | Extension now, from the last tick |
| stop | bool | Safety PLC stop. When true the boom holds where it is |

Outputs each tick: boom_angle_rad, extension_m, stability_pct.

## Limits

- Boom angle between 0.0 and 1.2 rad. Slew rate at most 0.12 rad/s each way.
- Extension between 0.0 and 6.0 m. Rate at most 0.4 m/s each way.
- When stop is true, angle and extension stay exactly as they are.
- Move straight toward the target at the rate limit and stop on it without overshoot.

## Stability

Load moment chart: 14 t.m at the front axle.

stability_pct = 100 x load_t x (2.0 + extension) x cos(angle) / 14, never below 0.

Over 100 percent the controller refuses to extend further: extension may only stay or retract until stability is back under 100.
