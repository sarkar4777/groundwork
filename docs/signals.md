# Signals

Every frame on the Groundwork buses, as the site twin encodes it. The encoder is `abenix/code-assets/gw-site-twin/twin/j1939.py` and the Sparkplug encoder is `twin/sparkplug.py`. Both run inside the twin code asset in Abenix. The round trips are tested in `bff/tests/test_signals.py`.

## The buses

Each machine has its own J1939 bus at 250 kbit/s with 29-bit identifiers. Site sensors publish MQTT Sparkplug B. Workers carry UWB tags at 10 Hz with 8 cm of jitter, each tag on its own clock, so a tag sample lands between controller ticks.

The browser gets up to 200 bus frames a second, sampled from everything the 45 controllers send. A `bus` frame carries the raw 8 data bytes in hex (`data`), the 29-bit identifier (`can_id`), the PGN, the source address and the decoded fields. Sparkplug frames carry `proto: "sparkplug_b"`, the MQTT `topic` and the protobuf payload in hex.

## Identifiers

The 29-bit identifier is priority (3 bits), extended data page and data page (2 bits), PDU format (8 bits), PDU specific (8 bits) and the source address (8 bits). For PDU1 messages (PF below 240) the PS byte is the destination, for PDU2 it is the group extension and part of the PGN. EEC1 from the engine at priority 3 is `0CF00400`.

## Encoding rules

- Multi-byte fields are little-endian. Byte and bit positions below are 1-based, as in the standard.
- A value is sent as `(value - offset) / scale`, rounded.
- A field the controller does not know is sent as all ones, not available. The top of each range is reserved: 8-bit fields carry 0 to 250, 16-bit fields 0 to 64,255, 32-bit fields up to 0xFAFFFFFF.
- Unused bytes are 0xFF.

## Source addresses

| Controller | Address | Machines |
|---|---|---|
| Engine ECU | 0x00 | Excavators, trucks, dozer, roller |
| Transmission and body hoist | 0x03 | Trucks |
| Collision avoidance | 0x2A | Trucks |
| Telematics unit | 0x4A | Excavators, trucks |
| Hydraulic controller | 0x80 | Excavators |
| Swing and boom controller | 0x81 | Excavators |
| Safety PLC | 0x82 | Excavators |
| Track and blade controller | 0x83 | Dozer |
| Slew drive | 0x84 | Tower crane, mobile crane |
| Luff drive | 0x85 | Tower crane |
| Hoist drive | 0x86 | Tower crane |
| Load moment indicator | 0x87 | Tower crane, mobile crane |
| Anti-collision unit | 0x88 | Tower crane |
| Piling rig controller | 0x89 | Piling rig |
| Telescopic boom controller (AI-written) | 0x8A | Telehandler, after the Story mode beat |

Addresses 0x80 and up are in the self-configurable range. Each machine is its own bus, so addresses repeat across machines.

## The 45 controllers

| Machine | Controllers | Count |
|---|---|---|
| EX1, EX2 excavators | ENG, HYD, SWB, TEL, SPLC | 10 |
| HT1 to HT6 haul trucks | ENG, TRN (with the body hoist), TEL, CAS | 24 |
| TC1 tower crane | SLEW, LUFF, HOIST, LMI, ACU | 5 |
| DZ1 dozer | ENG, TRK | 2 |
| MC1 mobile crane | SLEW, LMI | 2 |
| PR1 piling rig | PILE | 1 |
| RL1 roller | ENG (with the drum) | 1 |
| Total | | 45 |

Drones fly on their own links and are not on a machine bus. The telehandler TH1 adds one more controller when it arrives in Story mode.

## PGNs

### EEC1, PGN 61444 (0xF004), Electronic Engine Controller 1

SAE J1939-71. Priority 3, every 20 ms. Sent by ENG 0x00.

| Field | SPN | Start byte.bit | Bits | Scale | Offset | Unit |
|---|---|---|---|---|---|---|
| torque_mode | 899 | 1.1 | 4 | 1 | 0 | - |
| drivers_demand_torque_pct | 512 | 2.1 | 8 | 1 | -125 | % |
| actual_torque_pct | 513 | 3.1 | 8 | 1 | -125 | % |
| engine_speed_rpm | 190 | 4.1 | 16 | 0.125 | 0 | rpm |
| controlling_sa | 1483 | 6.1 | 8 | 1 | 0 | - |
| starter_mode | 1675 | 7.1 | 4 | 1 | 0 | - |
| engine_demand_torque_pct | 2432 | 8.1 | 8 | 1 | -125 | % |

### ETC2, PGN 61445 (0xF005), Electronic Transmission Controller 2

SAE J1939-71. Priority 6, every 100 ms. Sent by TRN 0x03.

| Field | SPN | Start byte.bit | Bits | Scale | Offset | Unit |
|---|---|---|---|---|---|---|
| selected_gear | 524 | 1.1 | 8 | 1 | -125 | - |
| actual_gear_ratio | 526 | 2.1 | 16 | 0.001 | 0 | - |
| current_gear | 523 | 4.1 | 8 | 1 | -125 | - |

### HOURS, PGN 65253 (0xFEE5), Engine Hours, Revolutions

SAE J1939-71. Priority 6, every 1000 ms. Sent by ENG 0x00.

| Field | SPN | Start byte.bit | Bits | Scale | Offset | Unit |
|---|---|---|---|---|---|---|
| engine_hours | 247 | 1.1 | 32 | 0.05 | 0 | h |
| engine_revolutions | 249 | 5.1 | 32 | 1000 | 0 | r |

### VDS, PGN 65256 (0xFEE8), Vehicle Direction/Speed

SAE J1939-71. Priority 6, every 100 ms. Sent by TEL 0x4A.

| Field | SPN | Start byte.bit | Bits | Scale | Offset | Unit |
|---|---|---|---|---|---|---|
| compass_bearing_deg | 165 | 1.1 | 16 | 0.0078125 | 0 | deg |
| nav_speed_kmh | 517 | 3.1 | 16 | 0.00390625 | 0 | km/h |
| pitch_deg | 583 | 5.1 | 16 | 0.0078125 | -200 | deg |
| altitude_m | 580 | 7.1 | 16 | 0.125 | -2500 | m |

### ET1, PGN 65262 (0xFEEE), Engine Temperature 1

SAE J1939-71. Priority 6, every 1000 ms. Sent by ENG 0x00.

| Field | SPN | Start byte.bit | Bits | Scale | Offset | Unit |
|---|---|---|---|---|---|---|
| coolant_c | 110 | 1.1 | 8 | 1 | -40 | C |
| fuel_temp_c | 174 | 2.1 | 8 | 1 | -40 | C |
| oil_temp_c | 175 | 3.1 | 16 | 0.03125 | -273 | C |
| turbo_oil_temp_c | 176 | 5.1 | 16 | 0.03125 | -273 | C |
| intercooler_c | 52 | 7.1 | 8 | 1 | -40 | C |
| intercooler_thermostat_pct | 1134 | 8.1 | 8 | 0.4 | 0 | % |

### CCVS1, PGN 65265 (0xFEF1), Cruise Control/Vehicle Speed 1

SAE J1939-71. Priority 6, every 100 ms. Sent by TRN 0x03.

| Field | SPN | Start byte.bit | Bits | Scale | Offset | Unit |
|---|---|---|---|---|---|---|
| parking_brake | 70 | 1.3 | 2 | 1 | 0 | - |
| wheel_speed_kmh | 84 | 2.1 | 16 | 0.00390625 | 0 | km/h |

### LFE1, PGN 65266 (0xFEF2), Fuel Economy (Liquid)

SAE J1939-71. Priority 6, every 100 ms. Sent by ENG 0x00.

| Field | SPN | Start byte.bit | Bits | Scale | Offset | Unit |
|---|---|---|---|---|---|---|
| fuel_rate_lph | 183 | 1.1 | 16 | 0.05 | 0 | L/h |
| inst_fuel_economy_kmpl | 184 | 3.1 | 16 | 0.00195312 | 0 | km/L |
| avg_fuel_economy_kmpl | 185 | 5.1 | 16 | 0.00195312 | 0 | km/L |
| throttle_pct | 51 | 7.1 | 8 | 0.4 | 0 | % |
| throttle2_pct | 3673 | 8.1 | 8 | 0.4 | 0 | % |

### VP, PGN 65267 (0xFEF3), Vehicle Position

SAE J1939-71. Priority 6, every 5000 ms. Sent by TEL 0x4A.

| Field | SPN | Start byte.bit | Bits | Scale | Offset | Unit |
|---|---|---|---|---|---|---|
| latitude_deg | 584 | 1.1 | 32 | 1e-07 | -210 | deg |
| longitude_deg | 585 | 5.1 | 32 | 1e-07 | -210 | deg |

### HYD1, PGN 65296 (0xFF10), Hydraulic pressures (proprietary B)

proprietary B. Priority 4, every 50 ms. Sent by HYD 0x80.

| Field | SPN | Start byte.bit | Bits | Scale | Offset | Unit |
|---|---|---|---|---|---|---|
| pump1_bar | - | 1.1 | 16 | 0.1 | 0 | bar |
| pump2_bar | - | 3.1 | 16 | 0.1 | 0 | bar |
| boom_head_bar | - | 5.1 | 16 | 0.1 | 0 | bar |
| oil_temp_c | - | 7.1 | 8 | 1 | -40 | C |
| flow_pct | - | 8.1 | 8 | 0.4 | 0 | % |

### SWB1, PGN 65297 (0xFF11), Swing and boom joints (proprietary B)

proprietary B. Priority 3, every 20 ms. Sent by SWB 0x81.

| Field | SPN | Start byte.bit | Bits | Scale | Offset | Unit |
|---|---|---|---|---|---|---|
| swing_rad | - | 1.1 | 16 | 0.0001 | -3.2 | rad |
| boom_rad | - | 3.1 | 16 | 0.0001 | -3.2 | rad |
| stick_rad | - | 5.1 | 16 | 0.0001 | -3.2 | rad |
| bucket_rad | - | 7.1 | 16 | 0.0001 | -3.2 | rad |

### SPLC1, PGN 65298 (0xFF12), Safety PLC status (proprietary B)

proprietary B. Priority 2, every 20 ms. Sent by SPLC 0x82.

| Field | SPN | Start byte.bit | Bits | Scale | Offset | Unit |
|---|---|---|---|---|---|---|
| mode | - | 1.1 | 4 | 1 | 0 | - |
| rule | - | 1.5 | 4 | 1 | 0 | - |
| heartbeat | - | 2.1 | 8 | 1 | 0 | - |
| nearest_tag_m | - | 3.1 | 16 | 0.01 | 0 | m |
| exclusion_m | - | 5.1 | 16 | 0.01 | 0 | m |
| tip_speed_ms | - | 7.1 | 16 | 0.001 | -32 | m/s |

### CAS1, PGN 65299 (0xFF13), Collision avoidance (proprietary B)

proprietary B. Priority 3, every 50 ms. Sent by CAS 0x2A.

| Field | SPN | Start byte.bit | Bits | Scale | Offset | Unit |
|---|---|---|---|---|---|---|
| nearest_tag_m | - | 1.1 | 16 | 0.01 | 0 | m |
| speed_cap_kmh | - | 3.1 | 8 | 1 | 0 | km/h |
| cap_active | - | 4.1 | 2 | 1 | 0 | - |

### TRK1, PGN 65300 (0xFF14), Track and blade (proprietary B)

proprietary B. Priority 4, every 50 ms. Sent by TRK 0x83.

| Field | SPN | Start byte.bit | Bits | Scale | Offset | Unit |
|---|---|---|---|---|---|---|
| left_track_mps | - | 1.1 | 16 | 0.001 | -32 | m/s |
| right_track_mps | - | 3.1 | 16 | 0.001 | -32 | m/s |
| blade_height_m | - | 5.1 | 16 | 0.001 | -32 | m |
| blade_load_pct | - | 7.1 | 8 | 0.4 | 0 | % |

### BODY1, PGN 65301 (0xFF15), Body hoist (proprietary B)

proprietary B. Priority 5, every 100 ms. Sent by TRN 0x03.

| Field | SPN | Start byte.bit | Bits | Scale | Offset | Unit |
|---|---|---|---|---|---|---|
| body_angle_deg | - | 1.1 | 8 | 0.5 | 0 | deg |
| payload_t | - | 2.1 | 16 | 0.01 | 0 | t |

### SLEW1, PGN 65312 (0xFF20), Slew drive (proprietary B)

proprietary B. Priority 3, every 20 ms. Sent by SLEW 0x84.

| Field | SPN | Start byte.bit | Bits | Scale | Offset | Unit |
|---|---|---|---|---|---|---|
| slew_rad | - | 1.1 | 16 | 0.0001 | -3.2 | rad |
| slew_rate_rads | - | 3.1 | 16 | 0.0001 | -3.2 | rad/s |
| brake | - | 5.1 | 2 | 1 | 0 | - |

### LUFF1, PGN 65313 (0xFF21), Luff drive (proprietary B)

proprietary B. Priority 3, every 20 ms. Sent by LUFF 0x85.

| Field | SPN | Start byte.bit | Bits | Scale | Offset | Unit |
|---|---|---|---|---|---|---|
| luff_rad | - | 1.1 | 16 | 0.0001 | -3.2 | rad |
| luff_rate_rads | - | 3.1 | 16 | 0.0001 | -3.2 | rad/s |
| radius_m | - | 5.1 | 16 | 0.01 | 0 | m |

### HOIST1, PGN 65314 (0xFF22), Hoist drive (proprietary B)

proprietary B. Priority 3, every 20 ms. Sent by HOIST 0x86.

| Field | SPN | Start byte.bit | Bits | Scale | Offset | Unit |
|---|---|---|---|---|---|---|
| hook_height_m | - | 1.1 | 16 | 0.01 | -100 | m |
| rope_speed_mps | - | 3.1 | 16 | 0.001 | -32 | m/s |
| load_t | - | 5.1 | 16 | 0.01 | 0 | t |

### LMI1, PGN 65315 (0xFF23), Load moment indicator (proprietary B)

proprietary B. Priority 2, every 100 ms. Sent by LMI 0x87.

| Field | SPN | Start byte.bit | Bits | Scale | Offset | Unit |
|---|---|---|---|---|---|---|
| radius_m | - | 1.1 | 16 | 0.01 | 0 | m |
| load_t | - | 3.1 | 16 | 0.01 | 0 | t |
| lmi_pct | - | 5.1 | 8 | 0.5 | 0 | % |
| wind_ms | - | 6.1 | 8 | 0.25 | 0 | m/s |
| chart_t | - | 7.1 | 16 | 0.01 | 0 | t |

### ACU1, PGN 65316 (0xFF24), Crane anti-collision (proprietary B)

proprietary B. Priority 2, every 50 ms. Sent by ACU 0x88.

| Field | SPN | Start byte.bit | Bits | Scale | Offset | Unit |
|---|---|---|---|---|---|---|
| min_separation_m | - | 1.1 | 16 | 0.01 | 0 | m |
| overlap | - | 3.1 | 2 | 1 | 0 | - |
| slow_active | - | 3.3 | 2 | 1 | 0 | - |

### PILE1, PGN 65317 (0xFF25), Piling rig (proprietary B)

proprietary B. Priority 5, every 100 ms. Sent by PILE 0x89.

| Field | SPN | Start byte.bit | Bits | Scale | Offset | Unit |
|---|---|---|---|---|---|---|
| pile_depth_m | - | 1.1 | 16 | 0.01 | 0 | m |
| hammer_bpm | - | 3.1 | 8 | 1 | 0 | bpm |
| vibration_mms | - | 4.1 | 16 | 0.01 | 0 | mm/s |

### RLR1, PGN 65318 (0xFF26), Roller compaction (proprietary B)

proprietary B. Priority 5, every 100 ms. Sent by ENG 0x00.

| Field | SPN | Start byte.bit | Bits | Scale | Offset | Unit |
|---|---|---|---|---|---|---|
| drum_freq_hz | - | 1.1 | 8 | 0.25 | 0 | Hz |
| amplitude_mm | - | 2.1 | 8 | 0.01 | 0 | mm |
| cmv | - | 3.1 | 16 | 0.1 | 0 | - |

### BOOM1, PGN 65319 (0xFF27), Telescopic boom (proprietary B)

proprietary B. Priority 3, every 20 ms. Sent by BOOM 0x8A.

| Field | SPN | Start byte.bit | Bits | Scale | Offset | Unit |
|---|---|---|---|---|---|---|
| boom_angle_rad | - | 1.1 | 16 | 0.0001 | -3.2 | rad |
| extension_m | - | 3.1 | 16 | 0.001 | 0 | m |
| fork_load_t | - | 5.1 | 16 | 0.01 | 0 | t |
| stability_pct | - | 7.1 | 8 | 0.5 | 0 | % |

## DM1, active diagnostic trouble codes

PGN 65226 (0xFECA), priority 6, every second from every controller.

| Byte | Content |
|---|---|
| 1 | Lamps: MIL bits 8-7, red stop bits 6-5, amber warning bits 4-3, protect bits 2-1. 01 is on |
| 2 | Flash bits, sent as 0xFF |
| 3-6 | One DTC: SPN low byte, SPN middle byte, SPN high 3 bits in bits 8-6 with the FMI in bits 5-1, then the conversion method bit and the 7-bit occurrence count |

With no active fault the DTC is sent as zeros. With more than one DTC the message is longer than 8 bytes and goes out over the broadcast announce transport: TP.CM (PGN 60416) with control byte 32, the size, the packet count and the DM1 PGN, then TP.DT (PGN 60160) packets of a sequence byte and 7 data bytes.

Fault codes the twin raises:

| SPN | FMI | Meaning | Raised when | Critical |
|---|---|---|---|---|
| 639 | 9 | J1939 network #1, abnormal update rate | The bus is cut for more than 0.3 s (fault deck: cut the CAN bus) | Yes |
| 584 | 2 | Latitude erratic, GNSS fix lost | No RTK fix for more than 1 s (fault deck: drop GNSS) | No |
| 1638 | 16 | Hydraulic temperature above normal, moderately severe | Hydraulic oil over 92 C | No |
| 1638 | 0 | Hydraulic temperature above normal, most severe | Hydraulic oil over 100 C | Yes |
| 110 | 0 | Coolant temperature, most severe | Listed in the manuals for the maintenance agent | Yes |
| 520200 | 0 | LMI overload, proprietary SPN | Listed in the manuals | Yes |

Critical codes light MIL and red stop. Others light amber.

## Sparkplug B, site sensors

About 30 site sensors publish on `spBv1.0/northgate/{DBIRTH|DDATA}/site-gw1/{device}`. The payload is the Sparkplug B protobuf, hand-encoded: `timestamp` (field 1), `metrics` (field 2) and `seq` (field 3, wraps at 256). Each metric has a `name` (1), a `datatype` (4) and a value: `float_value` (12), `boolean_value` (14), `string_value` (15) or `long_value` (11). Every device sends a DBIRTH with `bdSeq` and its kind before its first DDATA.

| Devices | Metric | Rate |
|---|---|---|
| WS-TC1, WS-MC1 anemometers | wind_ms | 1 s |
| WX-1 weather station | temp_c | 5 s |
| DU-1 to DU-4 dust | pm10_ugm3 | 2 s |
| NO-1 to NO-4 noise | laeq_db | 1 s |
| VB-1 to VB-3 vibration | ppv_mms | 1 s |
| TL-1 to TL-4 retaining wall tilt | tilt_mm | 5 s |
| PZ-1 to PZ-3 piezometers | head_m | 10 s |
| GC-1 gate camera | trucks_out | 5 s |
| RG-1 rain gauge | rain_mm | 10 s |
| LX-1 light | lux | 10 s |
| AQ-1, AQ-2 air quality | no2_ugm3 | 5 s |
| UA-1 to UA-4 UWB anchors | tags_seen | 2 s |

## ISO 15143-3 (AEMP 2.0)

Every 60 s of site time the twin builds the fleet snapshot: equipment header, location, cumulative operating hours, idle hours, fuel used, fuel remaining and active fault codes. `GET /fleet` on the bff serves the latest one.

## Vehicle position datum

Latitude and longitude come from the site frame around an arbitrary datum, 45.0 N 7.0 E. It points at no real site.
