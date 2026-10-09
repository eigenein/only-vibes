# Alert calibration — 9 October 2026

Alerts are intervention cues. Their primary measures are whether they precede
fatal outcomes and how much reaction time they provide. Measuring only how often
an alert is followed by damage rewards warnings that wait until the hull is
already failing. It also counts successful automatic assistance as a false alarm.

## Meaning and rule

- **Yellow:** the current shield/hull reserve or ongoing damage cannot safely
  absorb three more heavy contacts. Give the situation full attention.
- **Red:** the same evidence cannot safely absorb two more heavy contacts.
  Immediate survival intervention is warranted.

One heavy contact projects 34 damage points using the actual pre-impact shield
transmission and 1.1 shield depletion multiplier. Regeneration is excluded from
this short burst. The bridge also tracks an exponentially decaying hull-loss rate
with a one-second memory. Yellow projects that trend for 1.5 seconds and red for
0.25 seconds. Each level uses the **larger** of the contact and trend projections,
so depleted shields can warn before hull damage, while weapon fire can warn
without a collision pattern.

Recovery requires five points beyond the active threshold for two continuous
active seconds. Pausing freezes the history and recovery timer. A captain handoff
and every fresh field reset the alert history. Yellow sounds whenever yellow is
entered, including recovery from red; red sounds once per command hull. Yellow
enables aim assist and red also enables autopilot. Manual overrides remain
available.

## Simulation protocol

A temporary Node `node:vm` harness loaded the actual `index.js`. Browser-only
services were stubbed; physics, generation, shields, weapons, helpers, captain
handoff, automation, and alert functions were unchanged. Each run advanced at
60 steps per second until fleet destruction, victory, or 180 active seconds.

The 100-run validation cohort used fresh seeds **801–900**, after the rule and
outcome definitions were frozen. Runs cycled through four arena sizes, fields
1–4, and three flight policies: autopilot with gunner; forward thrust without a
gunner; and patterned turning thrust with a gunner. The last policy deliberately
overrides alert assistance. This is a repeatable stress mix, not a model of all
human play.

## Validation

| Measure | Result |
| --- | ---: |
| Fatal runs preceded by yellow | **49/49** |
| Fatal runs preceded by red | **49/49** |
| Median yellow-to-destruction lead | **6.85 s** |
| Median red-to-destruction lead | **5.68 s** |
| Yellow entries followed by major loss or destruction within 10 s | 74/99 |
| Red entries followed by destruction within 10 s | 31/94 |
| Fleet destructions / victories / timed runs | 49 / 2 / 49 |

The outcome rates are measured after alerts enable assistance. They therefore do
not estimate risk at entry: a red alert that engages autopilot and averts death
is working as designed. The fatal-run coverage and lead times directly address
the previous failure mode, where red appeared only shortly before a fatal impact.

The exploration cohort on seeds 701–800 compared the prior rule on the same
protocol. Its red warning preceded only 17 of 62 fatal runs, with 1.37 seconds
median lead among fatal outcomes. The selected rule preceded all 43 fatal runs
with red, with 5.63 seconds median lead, and had 19 fewer fleet destructions.
Different alert assistance changed the trajectories, so the death-count change
is evidence of useful intervention rather than a paired causal estimate.

Recalibration is required when collision damage, shields, weapons, automatic
assistance, or common flight behavior changes.
