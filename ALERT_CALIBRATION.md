# Alert calibration — 9 October 2026

Alerts are calibrated as predictions of a serious outcome, rather than as
labels for depleted reserves. The target is approximately 90–95% entry
precision under the simulated risk protocol below.

## Meaning and measurement

- **Yellow:** at least 10 additional hull points lost, or loss of the current
  command hull, within 10 active seconds. Give the situation full attention.
- **Red:** loss of the current command hull within 10 active seconds. Immediate
  survival intervention is warranted.

The window starts when the alert level is entered. Damage before entry does not
count. A captain hand-off counts as loss of the prior command hull; later damage
to the receiving ship does not. Victory ends the hazard window. An unfinished
180-second run is right-censored when the remaining observation cannot establish
the outcome.

The earlier five-second measurement understated risk from contacts which the
current flight model turns into a second impact several seconds later. It also
measured outcomes after alert assistance changed the trajectory. A warning that
successfully prevents destruction is useful, but that post-intervention outcome
cannot estimate the risk present when the warning was issued.

Calibration therefore measures entry precision with automatic alert assistance
disabled. The alert state and sounds still advance, but entry does not enable aim
assist or autopilot. A separate assisted cohort runs the shipped behavior to
check the effect of accepting those interventions. Red-to-yellow recovery is not
a fresh entry. Direct healthy-to-red escalation counts as one yellow and one red
entry because both thresholds were crossed.

## Selected rule

For each heavy contact, project 34 damage points using the actual pre-impact
shield transmission and 1.1 shield depletion multiplier. Regeneration is
excluded from this short reserve calculation. Weapon hits can exceed this
contact budget; the alert also observes their actual hull damage through the
damage history.

Require both depleted reserves and recent hull attrition:

| Parameter | Yellow | Red |
| --- | ---: | ---: |
| Full-budget contacts in reserve projection | 2 | 1 |
| Recent hull-loss projection | 1.5 seconds | 0.25 seconds |

The bridge tracks an exponentially decaying hull-loss rate with a one-second
memory. At each active step of duration `dt`, it updates
`rate = rate × exp(-dt / 1 s) + hullLost / 1 s`. Each severity threshold is the
smaller of its contact-projected hull loss and `rate × projectionSeconds`.
Entry occurs when remaining hull is at or below that threshold.

Recovery requires remaining hull to exceed the current threshold by five points
for two continuous active seconds. Pausing freezes the history and timer. A
captain hand-off and every fresh field reset the alert history. Yellow sounds
only on escalation from healthy; red sounds once per command hull. Entering
either level enables aim assist, and entering red enables normal autopilot.
Manual overrides remain effective until another transition; recovery leaves the
selected modes enabled.

## Simulation protocol

A temporary Node `node:vm` harness loaded the actual `index.js`. Only browser
services were stubbed: DOM, Canvas 2D, Path2D, audio, font readiness, network
audio loading, and animation scheduling. Physics, generation, shields, scrape
budget, Borg weapons, helpers, captain hand-off, autopilot, gunner, and alert
functions were real. Rendering and sound output were excluded. No server ran.

Randomness used a seeded 32-bit LCG:
`seed = (imul(seed, 1664525) + 1013904223) >>> 0`, divided by `2 ** 32`.
Each run advanced at 60 steps per second and stopped on fleet destruction,
victory, or 180 active seconds. Spawn protection and bridge status advanced in
the same order as `animate`.

For zero-based run index `r` within a cohort:

- Arena size: `[800×500, 1200×700, 1600×800, 1920×980][r % 4]`, excluding the
  command strip.
- Field: `1 + floor(r / 4) % 4`.
- Flight policy: `floor(r / 16) % 3`.

| Policy | Flight and firing |
| --- | --- |
| 0 | Autopilot and auto-gunner |
| 1 | Continuous forward thrust, no gunner |
| 2 | Forward thrust and auto-gunner; manual turn cycles left, straight, right every two seconds |

Policy 2 uses the actual manual turn ramp and override logic. The patterned mix
stresses the alerts and does not represent measured human behavior. Hull,
shield, command-hull identity, and alert state were sampled every 0.25 seconds,
at every transition, and on termination.

Seeds 1–600 were used while checking the protocol and candidate definitions.
After fixing the definitions above, seeds **601–700** supplied 100 fresh
validation runs. No alert constant or outcome definition changed afterward.

## Final validation

| Measure | Unassisted risk cohort | Normal assisted cohort |
| --- | ---: | ---: |
| Yellow entry precision | **75/83 = 90.4%** | 71/86 = 82.6% |
| Red entry precision | **16/17 = 94.1%** | 6/18 = 33.3% |
| Time displaying yellow | 6.6% | 7.7% |
| Time displaying red | 2.7% | 21.6% |
| Runs with fleet destruction | 58 | 48 |
| Victories | 42 | 46 |
| Censored runs | 0 | 6 |
| Total active time | 2,897.65 s | 4,158.55 s |

The unassisted cohort is the calibration result: yellow and red both fall in the
requested probability band. Approximate 95% Wilson intervals are 82.1–95.0% for
yellow and 73.0–99.0% for red. Entries within a run are not fully independent,
so these intervals are descriptive rather than universal guarantees.

The assisted cohort is not a second probability calibration. Alert assistance
changes later controls and therefore the observed outcome. Its lower post-alert
rates, ten fewer fleet destructions, and four additional victories are consistent
with successful intervention, although divergent trajectories prevent a paired
causal claim. Red can remain displayed after autopilot averts the immediate loss
because a critically damaged hull may lack the five-point recovery margin.

No production constant changed in this recalibration. The current rule already
meets the target once risk at entry is measured before the warning changes the
flight path. Mechanics or player behavior changes can still move these rates.
