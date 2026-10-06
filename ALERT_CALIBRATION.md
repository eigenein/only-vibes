# Alert calibration — 6 October 2026

Yellow and red use combined shield/hull reserve, rather than independent
percentage cutoffs. Yellow means four full-budget contacts could exhaust hull;
red means two could. Each projected contact uses the game's 34-point damage
budget, 1.1 shield damage multiplier and pre-impact shield transmission. This
short-burst estimate deliberately ignores regeneration and assumes the damage
budget is available for each contact. It is a conservative reserve indicator,
not a collision probability or a death countdown.

| Shield | Yellow at hull ≤ | Red at hull ≤ |
| --- | ---: | ---: |
| 100% | 72.1% | 12.7% |
| 75% | 97.6% | 29.7% |
| 50% | 114.7% (all hull levels) | 46.7% |
| 25% | 127.5% (all hull levels) | 59.5% |
| 0% | 136% (all hull levels) | 68% |

Escalation is immediate on the simulation step. Downgrading requires hull
reserve to exceed the current level's projected damage by ten points for two
continuous active seconds. Pausing freezes this timer. Yellow plays `Radar_04.wav` on each transition into yellow, including recovery
from red; red retains one alarm per life. Restart clears both severity and recovery history.

Entering yellow or red now enables aim assist, and entering red also enables
normal autopilot. This happens once per transition, preserving manual overrides;
recovery does not disable assistance. The simulations below predate these
automatic mode changes, so their outcomes do not measure the assistance benefit.

## Simulations

An exploratory 100 seeded runs with autopilot and gunner enabled produced no
deaths, so a second, mixed 100-run cohort included deliberate stress flight.
The latter is the calibration cohort below: seeds 1–100; 60 physics steps per
second; maximum 180 seconds per life; stop on destruction or victory. It ran
9,363 simulated seconds and produced 50 deaths.

For zero-based run number modulo four, the policies/arena sizes were:

| Remainder | Flight policy | Arena pixels |
| --- | --- | --- |
| 0 | Autopilot and auto-gunner | 800 × 500 |
| 1 | Autopilot, no auto-gunner | 1200 × 700 |
| 2 | Continuous forward thrust and auto-gunner | 1600 × 800 |
| 3 | Continuous forward thrust and auto-gunner | 1920 × 980 |

A temporary Deno `node:vm` harness executed the actual `index.js` and
`updateGame`, including asteroid generation, collision resolution, damage,
shield regeneration, weapon behavior and automation. DOM, canvas and audio
were stubbed; no web server was started. Randomness used a seeded 32-bit LCG
(`seed = imul(seed, 1664525) + 1013904223`, unsigned, divided by 2³²).
Shield/hull traces were recorded every 0.25 seconds and on termination.

These policies and sizes are paired, not a factorial experiment. They include
extreme reckless behavior and do not represent measured human-player habits.
No independent holdout or player study was performed.

## Comparison

All candidates use the ten-point recovery margin and two-second clear delay.
Percentages below average each run's fraction of time equally, rather than
weighting long surviving runs more heavily. Changes count every severity
transition, including the first warning.

| Yellow contacts | Red contacts | Changes/run | Yellow time | Red time | Warning coverage | Median red lead |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 1 | 1.08 | 7.0% | 7.2% | 18.3% | 0.80 s |
| 3 | 1 | 1.28 | 16.4% | 7.2% | 34.3% | 0.80 s |
| 3 | 2 | 1.32 | 9.4% | 14.2% | 34.3% | 1.83 s |
| **4** | **2** | **1.34** | **33.9%** | **14.2%** | **69.0%** | **1.83 s** |

Warning coverage is the fraction of sampled states preceding a hull loss
strictly greater than 20 points within the next five seconds that already had
yellow or red active. It is a recall metric, not precision: a warning with no
subsequent impact can still correctly indicate depleted survival reserve.
Median red lead measures time from first red warning to destruction in fatal
runs that entered red. Values have 0.25-second sampling resolution.

Four-contact yellow doubles coverage compared with three-contact yellow with
only 0.02 extra transitions per run. Two-contact red gives more reaction time
than one-contact red. The tradeoff is longer yellow exposure during reckless
flight; sparse switching is supported by these runs, while subjective utility
still needs human play feedback.

The final JavaScript alert functions were replayed against all 100 traces:
134 transitions over 37,575 recorded samples. Separate checks covered healthy,
yellow and red states, delayed recovery, restart reset and once-per-life alarm
state. Formatting, Deno checking and diff whitespace checks passed.

Safari loaded `index.html` directly. Healthy, yellow and red text and paused
help were visually inspected with temporary health fixtures, then the fixtures
were removed. The narrower-window attempt did not resize the window; further
computer use was stopped by the URL access policy after browser state changed.
Compact layout and final hull-bar warning colors remain visually unverified.
Actual speaker output and 60-FPS browser performance were not measured.
