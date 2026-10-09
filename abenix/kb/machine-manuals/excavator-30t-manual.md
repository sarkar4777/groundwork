# 30 t class hydraulic excavator, service manual extract

Fleet numbers EX1 and EX2 at Northgate Yard. Generic machine, no maker. Written for the Groundwork showcase.

## 1. Controllers on the machine bus

| Controller | Source address | Sends |
|---|---|---|
| Engine ECU | 0x00 | EEC1 (61444) every 20 ms, LFE1 (65266) every 100 ms, ET1 (65262) and HOURS (65253) every second, DM1 every second |
| Hydraulic controller | 0x80 | HYD1 (65296, proprietary B) every 50 ms: pump 1 and pump 2 pressure, boom head pressure, oil temperature, flow |
| Swing and boom controller | 0x81 | SWB1 (65297) every 20 ms: swing, boom, stick and bucket angles |
| Telematics unit | 0x4A | VP (65267) every 5 s, VDS (65256) every 100 ms |
| Safety PLC | 0x82 | SPLC1 (65298) every 20 ms: mode, rule, heartbeat, nearest tag, exclusion radius, tip speed |

## 2. Normal operating values

| Signal | Normal |
|---|---|
| Engine speed working | 1,700 to 1,800 rpm |
| Coolant temperature | 80 to 95 C |
| Pump pressure digging | 250 to 350 bar |
| Hydraulic oil temperature | 50 to 75 C |
| Boom head pressure, empty bucket raised | 60 to 120 bar |

## 3. Fault code table

| SPN | FMI | Meaning | Likely cause | Critical | Safe mode | Checks |
|---|---|---|---|---|---|---|
| 110 | 0 | Coolant temperature high, most severe | Radiator blocked by dust, fan belt, low coolant | Yes | Hold | Check coolant level, clean radiator core, check fan belt tension |
| 110 | 16 | Coolant temperature high, moderately severe | Heavy digging in heat, dusty core | No | Reduced speed | Idle 5 minutes, clean the core at the next stop |
| 100 | 1 | Engine oil pressure low, most severe | Low oil, pump wear, sender fault | Yes | Hold | Stop the engine, check oil level, check the sender |
| 1638 | 16 | Hydraulic oil temperature high, moderately severe | Worn main pump losing efficiency, cooler blocked, relief valve passing | No | Reduced speed | Check cooler fins, compare pump 1 and pump 2 pressure ripple, check relief valve setting |
| 1638 | 0 | Hydraulic oil temperature high, most severe | Main pump failing, cooler fan failed | Yes | Hold | Stop work, let the oil cool, test the pump case drain flow |
| 1762 | 1 | Hydraulic pressure low, most severe | Pump failure, major leak | Yes | Hold | Look for a burst hose, check the tank level |
| 2602 | 1 | Hydraulic oil level low | Leak | Yes | Hold | Find the leak before restarting |
| 639 | 9 | J1939 network #1, abnormal update rate | Bus cut or harness damage, terminating resistor | Yes | Hold | Check the bus harness at the swing joint, measure 60 ohm across CAN H and CAN L |
| 584 | 2 | Latitude erratic, GNSS fix lost | Antenna cable, RTK correction link, sky view | No | Hold while lost | Check the antenna cable and the correction modem |

A pump that is wearing shows a rising pressure ripple on pump 1 before the oil temperature rises. The hydraulic anomaly model gw-hydraulic-anomaly scores one-second windows of the HYD1 signals. A score under -0.05 means book an inspection even with no fault code.

## 4. Parts

| Part | Number |
|---|---|
| Main pump seal kit | EXP-30-114 |
| Hydraulic oil cooler | EXP-30-208 |
| CAN harness, swing joint | EXP-30-551 |
| GNSS antenna cable | EXP-30-612 |
