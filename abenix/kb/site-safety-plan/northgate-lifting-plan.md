# Northgate Yard lifting plan

Lifting plan for the tower crane TC1 and the mobile crane MC1. Fictional, written for the Groundwork showcase.

## 1. Cranes

| Crane | Type | Base | Reach | Chart |
|---|---|---|---|---|
| TC1 | Luffing jib tower crane, 48 m tower, 55 m jib | (-20, 38) | 57 m | 12 t up to 25 m, then 300 t.m divided by the radius |
| MC1 | Mobile crane, 32 m boom | (30, 30) | 32 m | 20 t up to 13 m, then 260 t.m divided by the radius |

The hook block counts as 0.4 t on both cranes.

## 2. Lifts this week

| Lift | Crane | Load | Tonnes | From | To |
|---|---|---|---|---|---|
| L1 | TC1 | Rebar cage RC-1 | 4.2 | Rebar yard | Core |
| L2 | TC1 | Formwork panel FP-4 | 2.8 | Laydown | Deck west |
| L3 | TC1 | Rebar cage RC-2 | 4.2 | Rebar yard | Core |
| L4 | TC1 | Formwork panel FP-5 | 2.8 | Laydown B | Deck east |
| L5 | TC1 | Precast stair PS-1 | 4.6 | Laydown | Core |
| L6 | TC1 | Rebar cage RC-3 | 4.0 | Rebar yard | Deck east |
| M1 to M3 | MC1 | Pile cages PC-7 to PC-9 | 3.4 each | Pile cage store | East wall |

## 3. Roles

Appointed person plans the lifts. Slingers attach and detach, at the pick and the landing point. The crane coordinator agent sequences lifts and holds them for wind. The anti-collision unit and the crane limits decision stop the cranes on their own.

## 4. Limits

### 4.1 Wind limits

- In-service wind limit at the jib: 20 m/s. Over it the slew is stopped and the load is landed or lowered to a safe height.
- Over 15 m/s: slew speed reduced to 70 percent and no long-radius lifts.
- A gust forecast over 18 m/s in the next 60 s: no new lift starts. The gust nowcast model gw-gust-nowcast gives the forecast every second.
- Resume when the forecast has been under 15 m/s for 60 s.

### 4.2 Load moment

The load moment indicator gives the load as a percentage of the chart at the current radius. Over 90 percent hoisting up and luffing out stop. Luffing in and lowering stay available so the load can be brought back inside the chart.

### 4.3 Planned lifts

Every planned lift is checked against gw.crane.limits with the forecast wind and the load moment at the furthest radius of the lift before it goes into the plan.

### 4.4 Shared airspace

The tower crane's hook and the mobile crane's boom must stay 5 m apart. The anti-collision unit measures the gap every 10 ms and stops both slews under 5 m. The collision forecaster gw-crane-collision gives the probability of an overlap in the next 10 s. At 50 percent or more both cranes slow to 40 percent.

## 5. Communication

Slingers and the crane talk on channel 2. The coordinator's holds are shown on the crane cab display and in the Site Pilot panel.
