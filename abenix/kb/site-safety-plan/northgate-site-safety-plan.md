# Northgate Yard site safety plan

Construction phase plan for the basement excavation, piling and frame of a 22-storey mixed-use tower at Northgate Yard. Fictional site, written for the Groundwork showcase. It is not certified safety guidance.

## 1. Scope

Bulk excavation of a two-level basement to a formation level of -8.0 m, secant piling on the east wall, tower crane and mobile crane lifts for rebar cages, formwork and pile cages, and haulage to the spoil area and off site.

## 2. People on site

Every person on site wears a UWB tag. Tags report position ten times a second. A person without a working tag does not enter the excavation, the piling zone or the spoil area.

| Role | Count | Where they work |
|---|---|---|
| Banksman | 2 | One for each excavator loading bay, outside the swing radius plus the warning zone |
| Slinger | 2 | Pick point at the laydown and rebar yard, landing point at the core |
| Surveyor | 1 | Pit edge and the excavation, with a GNSS rover |
| Labourer | 6 | Rebar yard, formwork, drainage, housekeeping |
| Piling helper | 1 | East wall, outside the piling exclusion |
| Site engineer | 1 | Everywhere, escorts visitors |
| Visitor | 1 | Escorted only, never inside an exclusion zone |

## 3. Plant and people

### 3.1 The principle

People and moving plant are kept apart by distance, not by attention. The site twin enforces the distances below every 10 ms from the tag positions. A machine that would break them is stopped by its safety PLC before a person can reach the danger zone.

### 3.2 Exclusion zones

Every slewing machine has an exclusion zone around it: its swing radius plus a margin that grows with how fast the bucket or hook tip is moving.

| Tip speed | Margin beyond the swing radius | Action |
|---|---|---|
| 2 m/s or more | 4 m | Stop |
| 0.5 to 2 m/s | 3 m | Stop |
| Any, including parked | 2 m | Stop |

The swing radius of a 30 t excavator at Northgate Yard is 10.5 m. A piling rig's exclusion radius is 8 m. These values are published as the decision table gw.safety.exclusion. A change to the table needs the sign-off of a second person.

A stopped machine stays stopped for 2 s after the person has left the zone. It then runs on the fallback plan, at reduced speed, until a person clears the stop. The superintendent's replan approval counts as that clearance.

### 3.3 Warning zone

Within 7 m of the swing radius the person's tag shows amber and the operator display shows the tag. No stop is made. Banksmen stand outside the warning zone.

### 3.4 Walking routes

Walking routes run along the north and west pit edges and the south site road. Nobody walks the haul road or the ramp. Crossing points at the ramp top are controlled by the ramp banksman.

## 4. Vehicles

### 4.1 Vehicles and people

Haul trucks drop to 10 km/h whenever a worker tag is within 15 m. On the haul road the limit is 30 km/h, in the pit and on the ramp 15 km/h, at the gate 10 km/h. These caps are the decision table gw.truck.speed.

### 4.2 Queuing and loading

One truck at a time under each excavator. The next truck waits at the queue point and only moves in when the bay is clear. Drivers stay in the cab while loading.

### 4.3 Haul cycles

Trucks run excavator, ramp, haul road, spoil area or gate, and back. The dispatcher may move a truck to the other excavator to balance the queues. A reroute an AI proposes is checked by the Earned Autonomy rules in Abenix before it is used.

## 5. Control systems

### 5.1 Layers

| Layer | Rate | Runs |
|---|---|---|
| Machine controllers (vECUs) | 100 Hz | The site twin code asset in Abenix |
| Safety rules | Every tick | The four gw decision tables, evaluated inside the twin |
| Prediction | 1 to 2 Hz | The six gw ML models in Abenix |
| Coordination | Seconds | The gw pipelines |
| Supervision | Seconds to minutes | The gw agents, under Earned Autonomy |
| People | Minutes | Approvals and the kill switch in Abenix |

### 5.2 Loss of control signals

If a machine's controller bus goes silent for more than 0.3 s the safety PLC applies the brakes and the machine is marked offline. It is not restarted until the fault is diagnosed. DM1 code SPN 639 FMI 9 is raised.

### 5.3 Positioning

Every machine carries RTK GNSS. If the fix is lost for more than 1 s the machine stops and holds. DM1 code SPN 584 FMI 2 is raised.

### 5.4 The Simplex switch

Who drives each machine is decided by the decision table gw.simplex.switch: the AI plan, the fallback plan, or nobody. Any safety rule hit hands control to the fallback until a person clears it. If the AI is offline or the kill switch is set, every machine runs the fallback plan. The safety rules do not depend on the AI being available.

## 6. Near misses

Every safety stop is written up within the shift by the safety officer: what happened, the measured stop time, the root cause, and the lesson for the next briefing. A lesson that needs a rule change becomes a proposal on the decision table, which a person signs off.

## 7. Emergency

Kill switch: stops every AI agent at its next step. The machines carry on under the safety rules and the fallback plan. Emergency stop: any banksman's radio stop puts every machine on site in hold.
