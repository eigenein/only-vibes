We are building a classic single-page "Asteroids" game in pure HTML and JavaScript.

# Code hygiene

- Must use HTML5 standard.
- Must use ES2025 standard.
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
- Must use JSDoc to annotate type and purpose of the parameters; must respect them.
- Must document all world constants.
- Must group all world constants.

# Implementation instructions

- Must use `<canvas>` for rendering.
- Must use plain HTML and JavaScript.
- Must not use dependencies like React, Phaser, PixiJS, WebGL, or a physics engine.
- Must care about performance and ensure the minimum of 60 FPS.
- Should consult with Wikipedia for physics concepts.
- Must keep the paused-game help screen up-to-date at all times.

# How to verify

- Must verify all changes and bug fixes immediately with `kane-cli` skill.
- Must fix all bugs reported by `kane-cli` skill immediately without prompting.
- Must invoke `kane-cli` skill in a new visible Google Chrome.
- Must not spin web server.
- Must load `index.html` directly in browser.
- May toggle the debug interface at own discretion.
- May pause and resume the game at own discretion.
- Must declutter the debug interface before adding new items.
- Must not display any debug elements when the debug UI is off.
- May add debug console output.
- Must prefer Kane CLI to Node VM or `deno eval`.
- Must document actionable Kane bug findings that resulted in code changes in `AUDIT.md`.
- Must not rely merely on code analysis.
- Must use W/A/S/D keys instead of the arrow keys when the spaceship control is needed.
- May temporarily change the code to isolate certain behavior; must revert it back when done.
