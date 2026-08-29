This file must only contain bug reports that have been found by Kane and actioned upon. Deno checks do not count.

## Iteration 19

- **Kane finding:** After resuming the game, the visible PHYSICS DEBUG panel
  showed `Shield/ship: NaN%/NaN%` and `Damage: momentum NaN`.
- **Action:** Corrected the collision solver's no-contact sentinel to
  `undefined`, then guarded the damage and shield-regeneration boundaries
  against non-finite simulation inputs so malformed contact data cannot poison
  the persistent life states or their HUD readouts.
- **Verification:** A follow-up visible-Chrome run passed before and after
  resuming: shield/ship and damage telemetry remained numeric with no `NaN` or
  `Infinity`.

## Iteration 19.1

- **Kane finding:** The status bars use a dark text color for their labels and
  percentages. When a bar is empty or nearly empty, that text sits on the dark
  unfilled track and loses contrast.
- **Action:** Changed both status-bar readouts to white text with a dark outline,
  preserving contrast over both the empty track and the colored fill.
- **Verification:** A visible-Chrome run confirmed both upper-right indicators
  and their 100% readouts render. Kane's bounded collision attempt did not reach
  a low-health state before its input sequence stalled, so near-zero behavior is
  additionally covered by the renderer's deterministic empty-track path.

## Iteration 22

- **Kane finding:** After a 700 ms resume/pause cycle, the phrase asteroids had
  scattered far enough that “KANE CLI” over “HACKATHON” was no longer a
  recognizable two-line remnant. The paused help panel also hid the phrase,
  and the initial chord bodies were uniform rectangles.
- **Action:** Replaced the rectangular chord bodies with irregular convex-hull
  asteroid forms, made the pause veil and panel translucent, and reduced only
  the phrase bodies' initial linear speed to 6 px/s with zero initial angular
  momentum. The normal integrator, collision solver, and wall physics remain
  unchanged.
- **Verification:** A follow-up visible-Chrome run confirmed irregular
  silhouettes and phrase visibility through the paused overlay, then confirmed
  a recognizable two-line phrase remnant after 700 ms of resumed play with no
  visible error text.

### Random field restoration

- **Kane finding:** Restoring the historical random asteroid generator caused
  startup to fail first on `randomIntegerBetween` and then on
  `createOrderedAngles`; its original random-generation helpers had been
  removed during the phrase-composition iterations.
- **Action:** Restored the complete helper set used to choose vertex counts,
  construct convex silhouettes, and place bodies within the viewport,
  preserving the original random distributions.
- **Verification:** The follow-up visible-Chrome run loaded without startup or
  console errors, reported `Asteroids: 9 (target: 9)` with finite telemetry,
  and confirmed independent random motion with no coordinated dispersal or
  corner bundle.
