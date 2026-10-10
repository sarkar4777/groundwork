# Story mode

The 60 second day, played by the app itself. Press Play the story on the start screen, or `POST /story/start`.

## How a take works

1. The bff starts a fresh twin in Abenix with seed 2026.
2. Every step is 5 ticks of 10 ms, so site time is exactly 0.05 s per step.
3. The bff keeps the script clock and sends the captions. Every beat is a real Abenix call.
4. Faults go into the twin at fixed site times, so the safety stop, the gust and the crane hold land at the same moment in every take.

Two modes:

| Mode | Agents and models | Same every take |
|---|---|---|
| `cached` (default when a recording exists) | Answers replayed from a recorded run, at fixed times. Every replayed frame carries `recorded: true` and says "recorded run" | Yes |
| `live` | Called live. Agents take 10 to 30 s, so their answers land when they land | The twin part only |
| `record` | Live, and every agent, pipeline and model answer is saved | No, it makes the recording |

The recording comes from a real run: `python scripts/record_story.py` starts a `record` take, prints every frame, and writes `bff/story_cache/story.json` once the last Abenix run has finished. Approvals in a recording are made by a person, on the phone view or in Abenix. `--approve` lets the operator running the script approve from the terminal, and the recording then says so. A replayed take never claims to be live.

The twin itself is never cached. In every take the excavator's stop, the crane's hold and every number on screen are computed by the twin code asset in Abenix during that take.

## Beat sheet

| Site time | What happens | Caption |
|---|---|---|
| 0 | Golden-hour drone shot, every machine working | A construction site that runs itself. Every machine, every decision, on Abenix. |
| 2.3 | W07 starts walking from 17.5 m toward EX1's swing radius at 1.6 m/s | |
| about 4.3 | The safety rules in the twin stop EX1. The event carries the measured stop time | A worker walks into the swing zone. The safety layer stops the excavator in N ms. (N is the measured value) |
| 5 to 12 | Site Superintendent replans, the plan is checked against gw.crane.limits, an approval opens, a person approves, the Simplex latch clears | Seconds later the AI replans the site and asks a person to approve. |
| 14 | Nervous system view | Underneath, 45 machine controllers talk on real machine buses at 100 times a second. |
| 18 | A gust front builds on the crane anemometer | |
| about 21.4 | Crane wind passes 20 m/s, gw.crane.limits stops both slews. Crane Coordinator runs through gw-weather-hold | A gust is forecast. The crane holds. The plan changes around it. |
| 28 | AI offline. No agent, model or pipeline is called. Machines run the fallback plan | We switch the AI off. The site stays safe, because safety never waits for the AI. |
| 34.6 | AI back | |
| 35 | gw-vecu-builder writes the TH1 boom controller from abenix/specs/telehandler.md and runs the six golden tests in the Abenix sandbox. After approval TH1 drives on site running that code | A new machine arrives. The AI writes its controller, tests it, and puts it to work. |
| 44 | The Fleet Dispatcher's real Earned Autonomy state from Abenix, and the near miss write-up turned into a lesson | Agents earn trust from their record. Mistakes become lessons a person approves. |
| 52 | End card | Groundwork. Built on Abenix, open source. |
| 60 | Story finished | |

## The autonomy beat, honestly

The story never shows a promotion that did not happen. A promotion in Abenix needs 20 reviews with enough agreement and a person who did not build the agent. Groundwork never fakes that. The beat shows the Dispatcher's real level and what it still needs. Run the site for a while, answer the Dispatcher's reviews in Abenix, approve the promotion, then record the story again and the beat shows the new level.
