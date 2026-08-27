const canvas = document.querySelector("#game-canvas");
const context = canvas.getContext("2d");

// Keep keyboard control available after the player clicks the play field.
canvas.tabIndex = 0;
canvas.addEventListener("pointerdown", () => canvas.focus());
canvas.focus({ preventScroll: true });

// The player uses one radius for both the circular hull and the triangle's
// circumcircle, keeping the silhouette consistent as the game evolves.
const PLAYER_RADIUS = 28;
const PLAYER_TRIANGLE_HALF_ANGLE = Math.PI / 4;
// A global speed keeps the steering response easy to tune from one place and
// makes rotation consistent across displays with different refresh rates.
const ROTATION_SPEED = Math.PI * 2;
// Movement is deliberately expressed in CSS pixels per second so the game
// behaves the same at different device pixel ratios and display refresh rates.
const MAX_SPEED = 360;
// This is the rate at which the ship gains or loses forward speed while a
// throttle key is held. Keeping it global makes the handling easy to tune.
const MOVEMENT_RESPONSIVENESS = 480;

// Asteroids are intentionally a small, fixed population for this iteration.
// Their size, complexity, and speed ranges are global so the game's difficulty
// can be tuned without changing the object model.
const ASTEROID_COUNT = 8;
const ASTEROID_MIN_RADIUS = 24;
const ASTEROID_MAX_RADIUS = 52;
const ASTEROID_MIN_VERTICES = 6;
const ASTEROID_MAX_VERTICES = 10;
const ASTEROID_MIN_SPEED = 70;
const ASTEROID_MAX_SPEED = 170;
const ASTEROID_FILL_STYLE = "#8f99a6";

const pressedKeys = new Set();
const asteroids = [];
let playerAngle = -Math.PI / 2;
let playerSpeed = 0;
let playerX;
let playerY;
let previousFrameTime;
let asteroidsGenerated = false;

function randomBetween(minimum, maximum) {
  return minimum + Math.random() * (maximum - minimum);
}

function randomIntegerBetween(minimum, maximum) {
  return Math.floor(randomBetween(minimum, maximum + 1));
}

/**
 * A point is sampled inside its circular bound when the viewport is large
 * enough. On a very small viewport the center is the only safe position.
 */
function randomCoordinate(extent, radius) {
  const minimum = radius;
  const maximum = extent - radius;

  return maximum <= minimum
    ? extent / 2
    : randomBetween(minimum, maximum);
}

/**
 * Sorting random angles is the entire shape-generation step: every vertex is
 * on the asteroid's invisible circle, and walking around that circle produces
 * an ordered convex polygon without requiring collision or triangulation code.
 */
function createOrderedAngles(vertexCount) {
  const angles = Array.from(
    { length: vertexCount },
    () => randomBetween(0, Math.PI * 2),
  );

  angles.sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  return Object.freeze(angles);
}

class Asteroid {
  constructor({ radius, angles, x, y, velocityX, velocityY }) {
    this.radius = radius;
    this.angles = angles;
    this.x = x;
    this.y = y;
    this.velocityX = velocityX;
    this.velocityY = velocityY;
  }

  /**
   * Asteroid velocity is constant while in flight. Only contact with a field
   * boundary reflects one velocity component; collision logic is deliberately
   * absent from this iteration.
   */
  update(width, height, deltaTime) {
    const horizontalBounds = reflectPosition(
      this.x,
      this.velocityX * deltaTime,
      this.radius,
      width - this.radius,
    );
    const verticalBounds = reflectPosition(
      this.y,
      this.velocityY * deltaTime,
      this.radius,
      height - this.radius,
    );

    this.x = horizontalBounds.position;
    this.y = verticalBounds.position;
    this.velocityX *= horizontalBounds.directionMultiplier;
    this.velocityY *= verticalBounds.directionMultiplier;
  }

  keepInside(width, height) {
    this.x = constrainPosition(this.x, this.radius, width);
    this.y = constrainPosition(this.y, this.radius, height);
  }

  draw() {
    const firstAngle = this.angles[0];
    const firstVertex = this.vertexAt(firstAngle);

    context.beginPath();
    context.moveTo(firstVertex.x, firstVertex.y);

    for (const angle of this.angles.slice(1)) {
      const vertex = this.vertexAt(angle);
      context.lineTo(vertex.x, vertex.y);
    }

    context.closePath();
    context.fillStyle = ASTEROID_FILL_STYLE;
    context.fill();
  }

  vertexAt(angle) {
    return {
      x: this.x + Math.cos(angle) * this.radius,
      y: this.y + Math.sin(angle) * this.radius,
    };
  }
}

function createAsteroid(width, height) {
  const radius = randomBetween(ASTEROID_MIN_RADIUS, ASTEROID_MAX_RADIUS);
  const vertexCount = randomIntegerBetween(
    ASTEROID_MIN_VERTICES,
    ASTEROID_MAX_VERTICES,
  );
  const direction = randomBetween(0, Math.PI * 2);
  const speed = randomBetween(ASTEROID_MIN_SPEED, ASTEROID_MAX_SPEED);

  return new Asteroid({
    radius,
    angles: createOrderedAngles(vertexCount),
    x: randomCoordinate(width, radius),
    y: randomCoordinate(height, radius),
    velocityX: Math.cos(direction) * speed,
    velocityY: Math.sin(direction) * speed,
  });
}

function generateAsteroids(width, height) {
  if (asteroidsGenerated || width <= 0 || height <= 0) {
    return;
  }

  asteroids.push(
    ...Array.from({ length: ASTEROID_COUNT }, () =>
      createAsteroid(width, height),
    ),
  );
  asteroidsGenerated = true;
}

/**
 * The drawing buffer follows the displayed size and device pixel ratio so
 * rendering stays crisp without changing the game's CSS-pixel coordinates.
 */
function resizeCanvas() {
  const { width, height } = canvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;

  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  if (playerX === undefined || playerY === undefined) {
    playerX = width / 2;
    playerY = height / 2;
  } else {
    playerX = constrainPosition(playerX, PLAYER_RADIUS, width);
    playerY = constrainPosition(playerY, PLAYER_RADIUS, height);
  }

  generateAsteroids(width, height);
  for (const asteroid of asteroids) {
    asteroid.keepInside(width, height);
  }

  drawGame(width, height);
}

function constrainPosition(position, radius, extent) {
  const minimum = radius;
  const maximum = extent - radius;

  return maximum <= minimum
    ? extent / 2
    : Math.min(Math.max(position, minimum), maximum);
}

/**
 * Draw the black space and the player in the bounded field.
 * The triangle points upward and has its tip and base endpoints on the hull's
 * circumference. Its base chord is intentionally shorter than its sides so
 * the tip communicates the ship's direction without extra UI.
 */
function drawGame(width, height) {
  const triangleTipAngle = playerAngle;
  const triangleBaseCenterAngle = triangleTipAngle + Math.PI;
  const baseLeftAngle =
    triangleBaseCenterAngle - PLAYER_TRIANGLE_HALF_ANGLE;
  const baseRightAngle =
    triangleBaseCenterAngle + PLAYER_TRIANGLE_HALF_ANGLE;

  context.fillStyle = "#000";
  context.fillRect(0, 0, width, height);

  // Asteroids are drawn first so the player remains visually legible when the
  // two shapes overlap. Their overlap has no gameplay effect yet.
  for (const asteroid of asteroids) {
    asteroid.draw();
  }

  // The circle remains unfilled so the black space is visible inside the hull.
  context.beginPath();
  context.arc(playerX, playerY, PLAYER_RADIUS, 0, Math.PI * 2);
  context.strokeStyle = "#fff";
  context.lineWidth = 2;
  context.stroke();

  const pointOnHull = (angle) => ({
    x: playerX + Math.cos(angle) * PLAYER_RADIUS,
    y: playerY + Math.sin(angle) * PLAYER_RADIUS,
  });
  const tip = pointOnHull(triangleTipAngle);
  const baseLeft = pointOnHull(baseLeftAngle);
  const baseRight = pointOnHull(baseRightAngle);

  context.beginPath();
  context.moveTo(tip.x, tip.y);
  context.lineTo(baseLeft.x, baseLeft.y);
  context.lineTo(baseRight.x, baseRight.y);
  context.closePath();
  context.fillStyle = "#fff";
  context.fill();
}

/**
 * Reflect a one-dimensional movement segment between two walls. The loop is
 * intentionally defensive: even if the playable area is resized to be very
 * small, an unusually large frame cannot move the ship outside the box.
 */
function reflectPosition(position, displacement, minimum, maximum) {
  if (maximum <= minimum) {
    return { position: (minimum + maximum) / 2, directionMultiplier: 1 };
  }

  let nextPosition = position + displacement;
  let directionMultiplier = 1;

  while (nextPosition < minimum || nextPosition > maximum) {
    if (nextPosition < minimum) {
      nextPosition = minimum + (minimum - nextPosition);
      directionMultiplier *= -1;
    }

    if (nextPosition > maximum) {
      nextPosition = maximum - (nextPosition - maximum);
      directionMultiplier *= -1;
    }
  }

  return { position: nextPosition, directionMultiplier };
}

/**
 * Rotate and change forward speed while controls are held. The ship owns a
 * scalar speed, never a reverse velocity: braking bottoms out at zero and
 * acceleration tops out at MAX_SPEED.
 */
function updateGame(deltaTime, width, height) {
  const turnsCounterClockwise =
    pressedKeys.has("ArrowLeft") || pressedKeys.has("KeyA");
  const turnsClockwise =
    pressedKeys.has("ArrowRight") || pressedKeys.has("KeyD");
  const rotationDirection =
    Number(turnsClockwise) - Number(turnsCounterClockwise);

  playerAngle += rotationDirection * ROTATION_SPEED * deltaTime;

  const accelerates =
    pressedKeys.has("ArrowUp") || pressedKeys.has("KeyW");
  const decelerates =
    pressedKeys.has("ArrowDown") || pressedKeys.has("KeyS");
  const speedDirection = Number(accelerates) - Number(decelerates);

  playerSpeed = Math.min(
    MAX_SPEED,
    Math.max(
      0,
      playerSpeed + speedDirection * MOVEMENT_RESPONSIVENESS * deltaTime,
    ),
  );

  for (const asteroid of asteroids) {
    asteroid.update(width, height, deltaTime);
  }

  const directionX = Math.cos(playerAngle);
  const directionY = Math.sin(playerAngle);
  const horizontalBounds = reflectPosition(
    playerX,
    directionX * playerSpeed * deltaTime,
    PLAYER_RADIUS,
    width - PLAYER_RADIUS,
  );
  const verticalBounds = reflectPosition(
    playerY,
    directionY * playerSpeed * deltaTime,
    PLAYER_RADIUS,
    height - PLAYER_RADIUS,
  );

  playerX = horizontalBounds.position;
  playerY = verticalBounds.position;

  // A bounce reflects the velocity vector. Because this ship's velocity is
  // always aligned with its nose, mirror the orientation too so it continues
  // travelling in the direction it points after hitting a wall.
  const reflectedDirectionX =
    directionX * horizontalBounds.directionMultiplier;
  const reflectedDirectionY = directionY * verticalBounds.directionMultiplier;
  playerAngle = Math.atan2(reflectedDirectionY, reflectedDirectionX);
}

function animate(frameTime) {
  const deltaTime =
    previousFrameTime === undefined
      ? 0
      : Math.min((frameTime - previousFrameTime) / 1000, 0.1);
  previousFrameTime = frameTime;

  const { width, height } = canvas.getBoundingClientRect();
  generateAsteroids(width, height);
  updateGame(deltaTime, width, height);
  drawGame(width, height);
  window.requestAnimationFrame(animate);
}

function controlKeyForEvent(event) {
  if (event.key.startsWith("Arrow")) {
    return ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
      event.key,
    )
      ? event.key
      : undefined;
  }

  return ["KeyA", "KeyD", "KeyW", "KeyS"].includes(event.code)
    ? event.code
    : undefined;
}

document.addEventListener("keydown", (event) => {
  const controlKey = controlKeyForEvent(event);

  if (controlKey !== undefined) {
    event.preventDefault();
    pressedKeys.add(controlKey);
  }
});

document.addEventListener("keyup", (event) => {
  const controlKey = controlKeyForEvent(event);

  if (controlKey !== undefined) {
    pressedKeys.delete(controlKey);
  }
});

window.addEventListener("blur", () => pressedKeys.clear());

window.addEventListener("resize", resizeCanvas);
resizeCanvas();
window.requestAnimationFrame(animate);
