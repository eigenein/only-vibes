We are building a classic single-page "Asteroids" game in pure HTML and JavaScript.

# Code hygiene

- Must use HTML5 standard.
- Must use ES2025 standard.
- Must use best MDN practices.
- Must format the code.
- Must assign variables immediately.
- Must keep all JavaScript in the single `index.js`.
- Must not depend on local files outside the project.
- Must document design and gameplay decisions via comments in JavaScript code.
- May use resources from CDN's.
- Should keep `index.html` minimal.
- Should embrace encapsulation.

# Implementation choices

- Must use `<canvas>` for rendering.
- Must use plain HTML and JavaScript.
- Must not use dependencies like React, Phaser, PixiJS, WebGL, or a physics engine.

# How to verify

- Must verify all changes and bug fixes immediately with `kane-cli` skill.
- Must fix all bugs reported by `kane-cli` skill immediately without prompting.
- Must invoke `kane-cli` skill in a new visible Google Chrome.
- Must not spin web server.
- Must load `index.html` directly in browser.
