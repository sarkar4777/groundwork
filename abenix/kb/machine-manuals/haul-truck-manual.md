# 25 t articulated haul truck, service manual extract

Fleet numbers HT1 to HT6 at Northgate Yard. Generic machine, no maker. Written for the Groundwork showcase.

## 1. Controllers on the machine bus

| Controller | Source address | Sends |
|---|---|---|
| Engine ECU | 0x00 | EEC1 (61444), LFE1 (65266), ET1 (65262), HOURS (65253), DM1 |
| Transmission and body hoist | 0x03 | ETC2 (61445), CCVS1 (65265) wheel-based speed, BODY1 (65301) body angle and payload |
| Telematics unit | 0x4A | VP (65267) every 5 s, VDS (65256) |
| Collision avoidance | 0x2A | CAS1 (65299): nearest tag distance, speed cap, cap active |

## 2. Speed caps

The collision avoidance unit applies the cap from the site rules: 10 km/h with a worker tag within 15 m, 15 km/h in the pit and on the ramp, 30 km/h on the haul road.

## 3. Fault code table

| SPN | FMI | Meaning | Likely cause | Critical | Safe mode | Checks |
|---|---|---|---|---|---|---|
| 110 | 0 | Coolant temperature high, most severe | Blocked radiator, low coolant | Yes | Hold | Check coolant and the radiator |
| 177 | 0 | Transmission oil temperature high | Long ramp climbs loaded, cooler | No | Reduced speed | Check transmission cooler, avoid holding on the ramp |
| 84 | 2 | Wheel speed erratic | Speed sensor, tone ring | No | Reduced speed | Check the sensor gap |
| 639 | 9 | J1939 network #1, abnormal update rate | Harness at the articulation joint | Yes | Hold | Inspect the articulation harness, measure 60 ohm across CAN H and CAN L |
| 584 | 2 | GNSS fix lost | Antenna, correction link | No | Hold while lost | Check antenna and modem |

## 4. Payload

Rated 25 t. Site practice is six buckets of 2 m3, about 21.6 t of clay at 1.8 t/m3.
