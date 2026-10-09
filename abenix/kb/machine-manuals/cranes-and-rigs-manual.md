# Cranes, piling rig, dozer, roller and telehandler, manual extracts

Generic machines at Northgate Yard, no maker. Written for the Groundwork showcase.

## 1. Tower crane TC1

Controllers: slew drive 0x84 (SLEW1 65312), luff drive 0x85 (LUFF1 65313), hoist drive 0x86 (HOIST1 65314), load moment indicator 0x87 (LMI1 65315), anti-collision unit 0x88 (ACU1 65316).

| SPN | FMI | Meaning | Likely cause | Critical | Safe mode | Checks |
|---|---|---|---|---|---|---|
| 520200 | 0 | LMI overload | Load heavier than declared, radius larger than planned | Yes | Hold hoist up and luff out | Land the load, check the declared weight |
| 520201 | 7 | Slew brake not responding | Brake wear, hydraulic release valve | Yes | Hold | Test the brake before the next lift |
| 639 | 9 | Bus abnormal update rate | Slip ring | Yes | Hold | Check the slip ring connections |

In-service wind limit 20 m/s at the jib. Out of service, slew brake released so the jib weathervanes.

## 2. Mobile crane MC1

Controllers: slew 0x84 (SLEW1), load moment indicator 0x87 (LMI1). Same LMI and wind limits as TC1. Outriggers fully extended for every lift.

## 3. Piling rig PR1

Controller 0x89 (PILE1 65317): pile depth, hammer blows per minute, vibration. Exclusion radius 8 m while the hammer runs. Vibration at the retaining wall over 10 mm/s stops the hammer.

## 4. Dozer DZ1 and roller RL1

Dozer: engine ECU 0x00, track and blade controller 0x83 (TRK1 65300). Roller: engine and drum ECU 0x00 with RLR1 65318 for drum frequency, amplitude and the compaction value. Both work only inside the spoil area.

## 5. Telehandler TH1

Boom controller 0x8A (BOOM1 65319): boom angle, extension, fork load, stability. The controller was written to the TH1 spec and tested against its golden tests before it was put to work. Stability over 100 percent of the 14 t.m chart blocks further extension.
