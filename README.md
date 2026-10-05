# Only Vibes

A Starfleet tactical training simulator built as a classic single-page Asteroids
game in pure HTML and JavaScript. Take the helm of a saucer-and-nacelles
starship, fire phaser pulses, and clear the sector through an LCARS-inspired
bridge console.

![Only Vibes screenshot](screenshot.png)

## Play

Play the hosted version on [GitHub Pages](https://eigenein.github.io/only-vibes/). You can also open [`index.html`](index.html) directly in a browser.

### Controls

| Key       | Action                             |
| --------- | ---------------------------------- |
| `SPACE`   | Fire phaser pulses                 |
| `W` / `S` | Thrust / brake                     |
| `A` / `D` | Turn counter-clockwise / clockwise |
| `P`       | Pause / resume                     |
| `T`       | Toggle autopilot                   |

### Shield and hull

- The ship starts with a full shield and hull.
- The collision damage is proportional to the momentum.
- Collision damage is split proportionally between the shield and hull based
  on the shield remaining at the moment of impact. The shield regenerates
  while the game is running.
- Hull damage does not regenerate during the current life.
- Arena walls also damage the ship.
- When the hull reaches zero, the game briefly shows the failure state before
  starting a fresh life.

Redder asteroids are heavier and hit harder. Fire at will. Keep the hull operational.

## Built with

- HTML5 canvas
- Plain ES2025 JavaScript
- Web fonts loaded from Google Fonts

All gameplay code lives in [`index.js`](index.js); [`index.html`](index.html)
is intentionally minimal. The starfield and ship silhouette are drawn with
cached canvas paths; all rendering uses the Canvas 2D API.
