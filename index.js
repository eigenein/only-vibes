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
// Collision bodies use a mass rather than a gameplay health value. The ship is
// intentionally heavier than a small asteroid, while still being light enough
// for a large asteroid to noticeably change its trajectory.
const STARSHIP_MASS = 1000;
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
// Mass is density times the area of the asteroid's bounding circle. Treating
// every asteroid as a disk is sufficient for this iteration; the polygon is a
// visual shape, not a separate collision geometry.
const ASTEROID_DENSITY = 0.1;
// A value of one is a fully elastic collision, which preserves both momentum
// and kinetic energy. It remains a global coefficient so later iterations can
// intentionally model energy loss without changing the collision solver.
const BOUNCINESS = 1;
const COLLISION_EPSILON = 0.000001;

const pressedKeys = new Set();
const asteroids = [];
let playerAngle = -Math.PI / 2;
let playerSpeed = 0;
let playerX;
let playerY;
let previousFrameTime;
let asteroidsGenerated = false;
let debugEnabled = false;
let lastCollisionCount = 0;
let totalCollisionCount = 0;
let lastMomentumDelta = { x: 0, y: 0 };
let lastKineticEnergyDelta = 0;

// The debug panel is created only in JavaScript so index.html stays a minimal
// canvas host. It is hidden by default and reports collision telemetry without
// changing the normal game presentation.
const debugOutput = document.createElement("pre");
debugOutput.hidden = true;
debugOutput.setAttribute("aria-label", "Physics debug information");
debugOutput.style.cssText =
  "position:fixed;top:12px;left:12px;margin:0;padding:10px;" +
  "color:#9f9;background:#001500e6;font:12px/1.4 monospace;" +
  "white-space:pre;z-index:1;pointer-events:none;";
document.body.append(debugOutput);

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

  return maximum <= minimum ? extent / 2 : randomBetween(minimum, maximum);
}

/**
 * Sorting random angles is the entire shape-generation step: every vertex is
 * on the asteroid's invisible circle, and walking around that circle produces
 * an ordered convex polygon without requiring collision or triangulation code.
 */
function createOrderedAngles(vertexCount) {
  const angles = Array.from({ length: vertexCount }, () =>
    randomBetween(0, Math.PI * 2),
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

  get mass() {
    return ASTEROID_DENSITY * Math.PI * this.radius ** 2;
  }

  /**
   * Asteroids move freely until they meet a field boundary or another
   * collision body. Collision responses are applied after every body has moved
   * for the frame, so this method only handles the boundary reflection.
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
  const baseLeftAngle = triangleBaseCenterAngle - PLAYER_TRIANGLE_HALF_ANGLE;
  const baseRightAngle = triangleBaseCenterAngle + PLAYER_TRIANGLE_HALF_ANGLE;

  context.fillStyle = "#000";
  context.fillRect(0, 0, width, height);

  // Asteroids are drawn first so the player remains visually legible when the
  // two shapes overlap. The overlap is resolved by the physics update.
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

function normalizedVector(x, y, fallbackX = 1, fallbackY = 0) {
  const length = Math.hypot(x, y);

  return length <= COLLISION_EPSILON
    ? { x: fallbackX, y: fallbackY }
    : { x: x / length, y: y / length };
}

function physicsSnapshot(ship) {
  const bodies = [ship, ...asteroids];
  let momentumX = 0;
  let momentumY = 0;
  let kineticEnergy = 0;

  for (const body of bodies) {
    momentumX += body.mass * body.velocityX;
    momentumY += body.mass * body.velocityY;
    kineticEnergy +=
      0.5 * body.mass * (body.velocityX ** 2 + body.velocityY ** 2);
  }

  return { momentumX, momentumY, kineticEnergy };
}

/**
 * Resolve a circle-circle contact with an impulse. The impulse is derived from
 * conservation of linear momentum plus the coefficient of restitution. With
 * BOUNCINESS set to one, the normal component is reversed elastically and the
 * collision preserves kinetic energy as well.
 */
function resolveCollision(firstBody, secondBody) {
  let offsetX = secondBody.x - firstBody.x;
  let offsetY = secondBody.y - firstBody.y;
  let distance = Math.hypot(offsetX, offsetY);
  const combinedRadius = firstBody.radius + secondBody.radius;

  if (distance > combinedRadius) {
    return false;
  }

  if (distance <= COLLISION_EPSILON) {
    // Coincident centers have no geometric normal. The relative motion gives
    // us a useful deterministic normal for the common head-on case.
    offsetX = firstBody.velocityX - secondBody.velocityX;
    offsetY = firstBody.velocityY - secondBody.velocityY;
    const normal = normalizedVector(offsetX, offsetY);
    offsetX = normal.x;
    offsetY = normal.y;
    distance = 0;
  } else {
    offsetX /= distance;
    offsetY /= distance;
  }

  const inverseFirstMass = 1 / firstBody.mass;
  const inverseSecondMass = 1 / secondBody.mass;
  const inverseMassSum = inverseFirstMass + inverseSecondMass;
  const penetration = combinedRadius - distance;

  // Separate overlap proportionally to inverse mass. This keeps a large
  // asteroid from teleporting the ship while preventing repeated impulses
  // from a body that remains embedded after a large animation frame.
  if (penetration > 0) {
    const separation = penetration / inverseMassSum;
    firstBody.x -= offsetX * separation * inverseFirstMass;
    firstBody.y -= offsetY * separation * inverseFirstMass;
    secondBody.x += offsetX * separation * inverseSecondMass;
    secondBody.y += offsetY * separation * inverseSecondMass;
  }

  const relativeVelocityX = secondBody.velocityX - firstBody.velocityX;
  const relativeVelocityY = secondBody.velocityY - firstBody.velocityY;
  const relativeNormalVelocity =
    relativeVelocityX * offsetX + relativeVelocityY * offsetY;

  // A contact that is already separating needs position correction only. An
  // impulse here would add energy and make the bodies bounce repeatedly.
  if (relativeNormalVelocity >= 0) {
    return true;
  }

  const impulseMagnitude =
    (-(1 + BOUNCINESS) * relativeNormalVelocity) / inverseMassSum;
  const impulseX = impulseMagnitude * offsetX;
  const impulseY = impulseMagnitude * offsetY;

  firstBody.velocityX -= impulseX * inverseFirstMass;
  firstBody.velocityY -= impulseY * inverseFirstMass;
  secondBody.velocityX += impulseX * inverseSecondMass;
  secondBody.velocityY += impulseY * inverseSecondMass;

  return true;
}

function playerBody() {
  return {
    x: playerX,
    y: playerY,
    radius: PLAYER_RADIUS,
    mass: STARSHIP_MASS,
    velocityX: Math.cos(playerAngle) * playerSpeed,
    velocityY: Math.sin(playerAngle) * playerSpeed,
  };
}

function applyPlayerBody(body) {
  playerX = body.x;
  playerY = body.y;
  playerSpeed = Math.hypot(body.velocityX, body.velocityY);

  if (playerSpeed > COLLISION_EPSILON) {
    playerAngle = Math.atan2(body.velocityY, body.velocityX);
  }
}

function resolveAsteroidCollisions() {
  const ship = playerBody();
  const beforeCollision = physicsSnapshot(ship);
  let collisionCount = 0;

  for (let firstIndex = 0; firstIndex < asteroids.length; firstIndex += 1) {
    const firstAsteroid = asteroids[firstIndex];

    for (
      let secondIndex = firstIndex + 1;
      secondIndex < asteroids.length;
      secondIndex += 1
    ) {
      collisionCount += Number(
        resolveCollision(firstAsteroid, asteroids[secondIndex]),
      );
    }
  }

  for (const asteroid of asteroids) {
    collisionCount += Number(resolveCollision(ship, asteroid));
  }

  const afterCollision = physicsSnapshot(ship);
  lastCollisionCount = collisionCount;
  totalCollisionCount += collisionCount;
  lastMomentumDelta = {
    x: afterCollision.momentumX - beforeCollision.momentumX,
    y: afterCollision.momentumY - beforeCollision.momentumY,
  };
  lastKineticEnergyDelta =
    afterCollision.kineticEnergy - beforeCollision.kineticEnergy;
  applyPlayerBody(ship);
}

function updateDebugOutput() {
  if (!debugEnabled) {
    return;
  }

  const ship = playerBody();
  const firstAsteroid = asteroids[0];
  const totalPhysics = physicsSnapshot(ship);
  const asteroidMass = firstAsteroid?.mass ?? 0;

  debugOutput.textContent = [
    "PHYSICS DEBUG  (D toggles)",
    `Starship mass: ${STARSHIP_MASS.toFixed(2)}`,
    `Asteroid mass: density × πr² = ${asteroidMass.toFixed(2)} (first)`,
    `Bounciness: ${BOUNCINESS.toFixed(2)}`,
    `Contacts/frame: ${lastCollisionCount}`,
    `Contacts total: ${totalCollisionCount}`,
    `Δ momentum at contact: (${lastMomentumDelta.x.toFixed(5)}, ${lastMomentumDelta.y.toFixed(5)})`,
    `Δ kinetic energy at contact: ${lastKineticEnergyDelta.toFixed(5)}`,
    `Total momentum: (${totalPhysics.momentumX.toFixed(2)}, ${totalPhysics.momentumY.toFixed(2)})`,
    `Total kinetic energy: ${totalPhysics.kineticEnergy.toFixed(2)}`,
  ].join("\n");
}

/**
 * Rotate and change forward speed while controls are held. The ship owns a
 * scalar speed, never a reverse velocity: braking bottoms out at zero and
 * acceleration tops out at MAX_SPEED.
 */
function updateGame(deltaTime, width, height) {
  const turnsCounterClockwise =
    pressedKeys.has("ArrowLeft") || pressedKeys.has("KeyA");
  const turnsClockwise = pressedKeys.has("ArrowRight");
  const rotationDirection =
    Number(turnsClockwise) - Number(turnsCounterClockwise);

  playerAngle += rotationDirection * ROTATION_SPEED * deltaTime;

  const accelerates = pressedKeys.has("ArrowUp") || pressedKeys.has("KeyW");
  const decelerates = pressedKeys.has("ArrowDown") || pressedKeys.has("KeyS");
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
  const reflectedDirectionX = directionX * horizontalBounds.directionMultiplier;
  const reflectedDirectionY = directionY * verticalBounds.directionMultiplier;
  playerAngle = Math.atan2(reflectedDirectionY, reflectedDirectionX);

  resolveAsteroidCollisions();
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
  updateDebugOutput();
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

  return ["KeyA", "KeyW", "KeyS"].includes(event.code) ? event.code : undefined;
}

document.addEventListener("keydown", (event) => {
  if (event.code === "KeyD" && !event.repeat) {
    debugEnabled = !debugEnabled;
    debugOutput.hidden = !debugEnabled;
    event.preventDefault();
    return;
  }

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
