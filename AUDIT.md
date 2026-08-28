This file must only contain bug reports that have been found by Kane and actioned upon:

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
