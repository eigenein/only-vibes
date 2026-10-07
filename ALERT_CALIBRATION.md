# Alert calibration — 8 October 2026

The 6 October calibration optimized warning coverage during reckless flight.
That is a different objective from useful, selective warnings. Its four-contact
yellow threshold also treated full hull with half shields as a warning, although
current autopilot deliberately spends shields on close attack passes and rams.
Fleet support, multiple cubes, weapon hits outside the scrape budget, and alert
assistance also change the outcomes. The earlier numerical results are superseded.

## Meaning and measurement

The target is approximately 90–95% precision for serious outcomes within **five
active seconds**, measured using the current game:

- **Yellow:** at least 20 additional hull points lost, or destruction. Give the
  situation full attention.
- **Red:** destruction. Immediate survival intervention is warranted.

These operational definitions use a fixed reaction window; they do not mean an
unconditional chance of dying eventually. Hull loss before the warning does not
count toward its outcome. A warning issued after destruction is not useful and
is suppressed. Victory ends the hazard window; an unfinished 180-second run is
right-censored when its remaining observation cannot establish the outcome.

Entry precision counts each escalation separately, including yellow-to-red and
later re-escalations. Red-to-yellow recovery is not a fresh predictive warning
and is silent. Active-state precision checks whether the same outcome follows
while each warning remains displayed, including the recovery delay. High
precision is deliberately traded against coverage: absence of an alert does
not establish safety.

## Selected rule

For each heavy contact, project 34 damage points using the actual pre-impact
shield transmission and 1.1 shield depletion multiplier. Regeneration is excluded
from this short reserve calculation. Weapon hits can exceed this contact budget;
the alert also observes their actual hull damage through the damage history.

Require **both** depleted reserves and recent hull attrition:

| Parameter | Yellow | Red |
| --- | ---: | ---: |
| Full-budget contacts in reserve projection | 2 | 1 |
| Recent hull-loss projection | 1.5 seconds | 0.25 seconds |

The bridge tracks an exponentially decaying hull-loss rate with a one-second
memory. At each active step of duration `dt`, it updates
`rate = rate × exp(-dt / 1 s) + hullLost / 1 s`.
Each severity's threshold is the smaller of its contact-projected hull loss and
`rate × projectionSeconds`. Entry occurs when remaining hull is at or below
that threshold. These projection constants are calibrated gates, **not**
countdowns or the five-second measurement window. An isolated impact rapidly
loses influence; a safely recovering damaged hull does not warn simply because
its reserves remain low.

Recovery requires remaining hull to exceed the current severity's threshold by
five points for two continuous active seconds. Pausing freezes the history and
timer. Every fresh field resets both. Yellow sounds only from healthy; red sounds
once per life. Entering either level enables aim assist, and entering red enables
normal autopilot. Manual overrides remain effective until another transition;
recovery does not turn assistance off.

## Simulation protocol

A temporary Node `node:vm` harness loaded the actual `index.js`. Only browser
services were stubbed: DOM, Canvas 2D, Path2D, audio, font readiness, network audio
loading, and animation scheduling. Physics, generation, shields, scrape budget,
Borg weapons, helpers, autopilot, gunner, and alert functions were real. Rendering
and sound were excluded from these numerical measurements. No server was used.

Randomness used the same 32-bit LCG as the prior experiment:
`seed = (imul(seed, 1664525) + 1013904223) >>> 0`, divided by `2 ** 32`.
Each run reset random state and a simulated monotonic performance clock. The
simulation explicitly unpaused the game, advanced at 60 steps per second, and
stopped on player destruction, victory, or 180 active seconds. Spawn protection
was decremented after each physics step; alerts ran afterward, as in `animate`.

For zero-based run index `r` within a cohort:

- Arena size: `[800×500, 1200×700, 1600×800, 1920×980][r % 4]`, excluding the
  command strip; these are physical simulation dimensions.
- Field: `1 + floor(r / 4) % 4`; rebuild the corresponding cube/helper fleet and
  asteroid field after resetting the life.
- Flight policy: `floor(r / 16) % 3`, as described below.

| Policy | Flight and firing | Alert assistance |
| --- | --- | --- |
| 0 | Autopilot and auto-gunner | Accepted |
| 1 | Forward thrust, no gunner | Accepted; manual thrust stops once red engages autopilot |
| 2 | Forward thrust and auto-gunner; turn direction cycles −1, 0, +1 every two seconds | Manual flight explicitly overrides autopilot each step |

Controls are synchronized through the game functions. Policy 2 uses the actual
manual turn ramp and override logic, not an instantaneous heading assignment.
Policies/sizes/fields are patterned rather than a full factorial player study.

Hull and shield traces were sampled every 0.25 seconds, at every alert transition,
and on termination. Alert entry and destruction timestamps therefore have
1/60-second resolution; the five-second hull-loss outcome has up to 0.25-second
sampling uncertainty. Active precision weights each observed state by elapsed
time to the next observation. Entry results are pooled by warning; active time
is pooled by simulated seconds.

An initial harness check that left automation paused was discarded. Exploratory
runs used seeds 1–200 to compare reserve-only rules and damage-history gates;
seeds 201–400 checked assistance and the manual-override protocol. Those cohorts
were used during development and are **not** independent validation. After
freezing the final constants and protocol, seeds **401–500** supplied 100 fresh
validation runs. The old and new rules were run separately on those same seeds;
alert assistance changes trajectories, so later states are not paired replay
observations. No parameter was changed after this final validation.

## Final validation

The tables below summarize all 100 validation seeds for both rules. The
temporary per-run JSON dump is not retained in the repository.

| Measure | Old reserve-only alerts | Recalibrated alerts |
| --- | ---: | ---: |
| Yellow entry precision | 57/100 = 57.0% | **67/71 = 94.4%** |
| Red entry precision | 30/84 = 35.7% | **28/30 = 93.3%** |
| Yellow active-state precision | 21.6% | **91.7%** |
| Red active-state precision | 25.9% | **91.1%** |
| Time displaying yellow | 31.5% | **4.3%** |
| Time displaying red | 27.3% | **2.3%** |
| Median successful yellow lead to destruction | 4.01 s | 1.75 s |
| Median successful red lead to destruction | 2.19 s | 1.97 s |
| Fatal runs with a preceding yellow state | 70/70 | 68/75 |
| Fatal runs with a preceding red state | 70/70 | 30/75 |
| Destructions / victories / censored runs | 70 / 26 / 4 | 75 / 25 / 0 |
| Total simulated active time | 3,838.75 s | 2,773.00 s |

Lead-time medians include only entries followed by destruction within the
five-second window. They do not measure all warnings or guarantee reaction time.
The old implementation could issue an alarm on the fatal step; such entries are
excluded from predictive precision and preceding-warning coverage.

For the new entry proportions, approximate 95% Wilson intervals are **86.4–97.8%**
for yellow and **78.7–98.2%** for red. The method follows the
[NIST confidence-interval reference](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm).
Warnings within one run are not fully independent, so these descriptive
intervals do not establish a universal 90% lower bound.

| Validation flight policy | Yellow outcomes / entries | Red outcomes / entries |
| --- | ---: | ---: |
| Autopilot and gunner | 11/13 | 4/4 |
| Forward thrust, accepting assistance | 27/28 | 13/15 |
| Turning thrust, overriding assistance | 29/30 | 11/11 |

The aggregate meets the requested precision target, but individual policies have
small samples and different rates. This is a stress-heavy synthetic mix, not
measured human behavior. Probability calibration can drift when mechanics or
flight behavior change.

The more selective red engages autopilot later and warns in only 40% of fatal
runs. The new cohort also had more deaths than the old-rule cohort. These runs
support quieter, more predictive alarms; they **do not** demonstrate improved
survival. A future requirement for both high precision and broad early coverage
would need additional threat prediction and a larger independent cohort.

## Verification

The actual alert functions passed checks for healthy half shields, yellow and
red entry, assistance, preserved manual overrides, zero-time history/timer,
sustained quiet recovery, silent downgrades, once-per-life red audio state,
restart history reset, and suppression of postmortem warnings. Deno checking and
whitespace checks passed. Modified code was formatted using the repository's
four-space style, without unrelated formatting changes.

Safari loaded `index.html` directly. Healthy and red states and the
paused help were inspected at the full canvas size. A temporary 800×600 canvas
fixture verified yellow hull coloring and the compact paused help; the compact
console intentionally omits warning text when it cannot fit. Both temporary
fixtures were removed afterward. This verifies canvas layout at two sizes,
rather than claiming the browser window itself was resized. Audible speaker
output and sustained 60-FPS performance were not measured by this calibration.

The paused help was subsequently reduced to controls only, with a shorter
panel; border assistance and alert mechanics remain documented in README.md.
The controls-only layout was checked in Safari at full size and on an 800×600
canvas. The temporary size fixture was removed.
