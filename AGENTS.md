We are building a classic single-page "Asteroids" game in pure HTML and JavaScript.

# Code hygiene

- Must use HTML5 standard.
- Must use the ES2025 standard.
- Must use the "widely available" [baseline](https://web.dev/baseline).
- Must use best MDN practices.
- Must format the code.
- Must assign variables immediately.
- Must keep all JavaScript in the single `index.js`.
- Must not depend on local files outside the project.
- Must document design and gameplay decisions via comments in JavaScript code.
- May use resources from CDN's.
- Should keep `index.html` minimal.
- Should embrace encapsulation.
- Should continuously clean up dead code.
- Should not repeat itself.
- Must use JSDoc to annotate type and purpose of the parameters; must properly format and respect the annotations.
- Must document all world constants.
- Must group all world constants.
- Must document the purpose and choices made.
- Should keep the code type-safe.

# Implementation instructions

- Must use `<canvas>` for rendering.
- Must use plain HTML and JavaScript.
- Must not use dependencies like React, Phaser, PixiJS, WebGL, or a physics engine.
- Must care about performance and ensure the minimum of 60 FPS.
- Should consult with Wikipedia for physics concepts.
- Must keep the paused-game help screen up to date at all times.
- Must keep the game user-friendly.
- Must not tolerate any visual bugs.
- Must keep calculations safe and numerically stable.
- Should consult the best practices online.

# Design choices

- LCARS-like user interface.

# How to verify

- Must not spin web server.
- Must load `index.html` directly in the browser; prefer the one with the best control over it.
- May toggle the debug interface at your own discretion.
- May pause and resume the game at your own discretion.
- May add debug console output.
- Must not rely merely on code analysis.
- May temporarily change the code to isolate certain behaviour; must revert it back when done.
- Must verify on different browser window sizes when changing the UI.
- May control the browser window.
- Must not ask to control the computer.
