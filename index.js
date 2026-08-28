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

// Bullets are intentionally fast and short-lived. The frequency is expressed
// in shots per second so holding Space feels regular at every frame rate.
const BULLET_FREQUENCY = 8;
const BULLET_FIRE_INTERVAL = 1 / BULLET_FREQUENCY;
// A bullet's mass is deliberately independent of its visual length. The
// collision response uses this value for both bullet momentum and bullet
// kinetic energy before the projectile is absorbed by the cut fragments.
const BULLET_MASS = 1;
const BULLET_SPEED = 720;
const BULLET_HALF_LENGTH = 10;
const BULLET_LINE_WIDTH = 3;
// Backquote is an uncommon gameplay key and is separate from the ship's
// letter-key controls, so it leaves D available for clockwise rotation.
const DEBUG_TOGGLE_KEY = "Backquote";

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
// A grazing cut can produce a technically valid but visually meaningless
// sliver. Discarding fragments below this area keeps the asteroid population
// useful while leaving the cutoff easy to tune for the game's scale.
const ASTEROID_MIN_FRAGMENT_AREA = 100;
// Geometric asteroid mass is density times the true area of the convex
// polygon. The encompassing radius remains useful for safe field-boundary
// placement; fragments can also carry absorbed bullet mass.
const ASTEROID_DENSITY = 0.1;
// A value of one is a fully elastic collision, which preserves both momentum
// and kinetic energy. It remains a global coefficient so later iterations can
// intentionally model energy loss without changing the collision solver.
const BOUNCINESS = 1;
const COLLISION_EPSILON = 0.000001;

const pressedKeys = new Set();
const asteroids = [];
const bullets = [];
let playerAngle = -Math.PI / 2;
let playerSpeed = 0;
let playerX;
let playerY;
let previousFrameTime;
let bulletCooldown = 0;
let totalBulletsEmitted = 0;
let asteroidsGenerated = false;
// Pausing stops simulation time while leaving the render loop alive, so the
// player can inspect a frozen collision result and resume without a time jump.
let gamePaused = false;
let debugEnabled = false;
let lastCollisionCount = 0;
let totalCollisionCount = 0;
let lastMomentumDelta = { x: 0, y: 0 };
let lastKineticEnergyDelta = 0;
let totalBulletCutCount = 0;
let lastBulletMomentumDelta = { x: 0, y: 0 };
let lastBulletKineticEnergyDelta = 0;

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
  const angles = Array.from(
    { length: vertexCount },
    () => randomBetween(0, Math.PI * 2),
  );

  angles.sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  return Object.freeze(angles);
}

class Asteroid {
  constructor({
    radius,
    angles,
    localVertices,
    x,
    y,
    velocityX,
    velocityY,
    additionalMass = 0,
  }) {
    const resolvedAngles = angles ??
      localVertices.map((vertex) => Math.atan2(vertex.y, vertex.x));
    const generatedVertices = resolvedAngles.map((angle) => ({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    }));

    this.radius = radius;
    this.localVertices = Object.freeze(
      (localVertices ?? generatedVertices).map((vertex) =>
        Object.freeze({ x: vertex.x, y: vertex.y })
      ),
    );
    this.angles = resolvedAngles;
    this.x = x;
    this.y = y;
    this.velocityX = velocityX;
    this.velocityY = velocityY;
    this.additionalMass = additionalMass;
  }

  get mass() {
    return ASTEROID_DENSITY * this.surfaceArea + this.additionalMass;
  }

  get surfaceArea() {
    const vertices = this.collisionPolygon();
    let twiceArea = 0;

    // The shoelace formula gives the exact area enclosed by the asteroid's
    // convex polygon, so sparse or unevenly spaced vertices produce a lighter
    // body than their circular bound would imply.
    for (let vertexIndex = 0; vertexIndex < vertices.length; vertexIndex += 1) {
      const firstVertex = vertices[vertexIndex];
      const secondVertex = vertices[(vertexIndex + 1) % vertices.length];
      twiceArea += firstVertex.x * secondVertex.y -
        secondVertex.x * firstVertex.y;
    }

    return Math.abs(twiceArea) / 2;
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
    const vertices = this.collisionPolygon();
    const firstVertex = vertices[0];

    context.beginPath();
    context.moveTo(firstVertex.x, firstVertex.y);

    for (const vertex of vertices.slice(1)) {
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

  collisionPolygon() {
    return this.localVertices.map((vertex) => ({
      x: this.x + vertex.x,
      y: this.y + vertex.y,
    }));
  }
}

class Bullet {
  constructor({ x, y, angle }) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.previousX = x;
    this.previousY = y;
    this.velocityX = Math.cos(angle) * BULLET_SPEED;
    this.velocityY = Math.sin(angle) * BULLET_SPEED;
  }

  get mass() {
    return BULLET_MASS;
  }

  update(deltaTime) {
    this.previousX = this.x;
    this.previousY = this.y;
    this.x += this.velocityX * deltaTime;
    this.y += this.velocityY * deltaTime;
  }

  isOutside(width, height) {
    return (
      this.x < -BULLET_HALF_LENGTH ||
      this.x > width + BULLET_HALF_LENGTH ||
      this.y < -BULLET_HALF_LENGTH ||
      this.y > height + BULLET_HALF_LENGTH
    );
  }

  draw() {
    const directionX = Math.cos(this.angle);
    const directionY = Math.sin(this.angle);
    const startX = this.x - directionX * BULLET_HALF_LENGTH;
    const startY = this.y - directionY * BULLET_HALF_LENGTH;
    const endX = this.x + directionX * BULLET_HALF_LENGTH;
    const endY = this.y + directionY * BULLET_HALF_LENGTH;
    const gradient = context.createLinearGradient(
      startX,
      startY,
      endX,
      endY,
    );

    // A symmetric gradient makes a bullet read as a luminous moving streak:
    // both ends fade to black while the midpoint carries the full brightness.
    gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
    gradient.addColorStop(0.5, "rgba(255, 255, 255, 1)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

    context.save();
    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(endX, endY);
    context.strokeStyle = gradient;
    context.lineWidth = BULLET_LINE_WIDTH;
    context.lineCap = "butt";
    context.stroke();
    context.restore();
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

function createAsteroidFromPolygon(
  vertices,
  velocityX,
  velocityY,
  mass,
) {
  const center = polygonCentroid(vertices);
  const localVertices = vertices.map((vertex) => ({
    x: vertex.x - center.x,
    y: vertex.y - center.y,
  }));
  const radius = Math.max(
    ...localVertices.map((vertex) => Math.hypot(vertex.x, vertex.y)),
  );
  const area = polygonArea(vertices);
  const angles = Object.freeze(
    localVertices.map((vertex) => Math.atan2(vertex.y, vertex.x)),
  );

  return new Asteroid({
    radius,
    angles,
    localVertices,
    x: center.x,
    y: center.y,
    velocityX,
    velocityY,
    additionalMass: mass - ASTEROID_DENSITY * area,
  });
}

function generateAsteroids(width, height) {
  if (asteroidsGenerated || width <= 0 || height <= 0) {
    return;
  }

  asteroids.push(
    ...Array.from(
      { length: ASTEROID_COUNT },
      () => createAsteroid(width, height),
    ),
  );
  asteroidsGenerated = true;
}

function emitBullet() {
  const directionX = Math.cos(playerAngle);
  const directionY = Math.sin(playerAngle);
  const spawnDistance = PLAYER_RADIUS + BULLET_HALF_LENGTH;

  totalBulletsEmitted += 1;
  bullets.push(
    new Bullet({
      x: playerX + directionX * spawnDistance,
      y: playerY + directionY * spawnDistance,
      angle: playerAngle,
    }),
  );
}

function updateBullets(deltaTime, width, height) {
  for (
    let bulletIndex = bullets.length - 1;
    bulletIndex >= 0;
    bulletIndex -= 1
  ) {
    const bullet = bullets[bulletIndex];
    bullet.update(deltaTime);

    // Bullets do not wrap: removing them after they leave the field keeps the
    // simple projectile model bounded while preserving their visible flight.
    if (bullet.isOutside(width, height)) {
      bullets.splice(bulletIndex, 1);
    }
  }
}

function updateBulletFiring(deltaTime) {
  // Keep firing paused even if the key was held before the game was paused.
  // The simulation normally skips this function while paused, but this guard
  // keeps the firing rule local and prevents future callers from bypassing it.
  if (gamePaused || !pressedKeys.has("Space")) {
    bulletCooldown = 0;
    return;
  }

  bulletCooldown -= deltaTime;
  while (bulletCooldown <= 0) {
    emitBullet();
    bulletCooldown += BULLET_FIRE_INTERVAL;
  }
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

  for (const bullet of bullets) {
    bullet.draw();
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

function cross2D(firstX, firstY, secondX, secondY) {
  return firstX * secondY - firstY * secondX;
}

function polygonArea(vertices) {
  let twiceArea = 0;

  for (let vertexIndex = 0; vertexIndex < vertices.length; vertexIndex += 1) {
    const firstVertex = vertices[vertexIndex];
    const secondVertex = vertices[(vertexIndex + 1) % vertices.length];
    twiceArea += cross2D(
      firstVertex.x,
      firstVertex.y,
      secondVertex.x,
      secondVertex.y,
    );
  }

  return Math.abs(twiceArea) / 2;
}

function polygonCentroid(vertices) {
  let twiceArea = 0;
  let centroidX = 0;
  let centroidY = 0;

  for (let vertexIndex = 0; vertexIndex < vertices.length; vertexIndex += 1) {
    const firstVertex = vertices[vertexIndex];
    const secondVertex = vertices[(vertexIndex + 1) % vertices.length];
    const edgeCross = cross2D(
      firstVertex.x,
      firstVertex.y,
      secondVertex.x,
      secondVertex.y,
    );

    twiceArea += edgeCross;
    centroidX += (firstVertex.x + secondVertex.x) * edgeCross;
    centroidY += (firstVertex.y + secondVertex.y) * edgeCross;
  }

  if (Math.abs(twiceArea) <= COLLISION_EPSILON) {
    const average = vertices.reduce(
      (sum, vertex) => ({ x: sum.x + vertex.x, y: sum.y + vertex.y }),
      { x: 0, y: 0 },
    );

    return {
      x: average.x / vertices.length,
      y: average.y / vertices.length,
    };
  }

  return {
    x: centroidX / (3 * twiceArea),
    y: centroidY / (3 * twiceArea),
  };
}

function cleanPolygon(vertices) {
  const cleanedVertices = [];

  for (const vertex of vertices) {
    const previousVertex = cleanedVertices.at(-1);

    if (
      previousVertex === undefined ||
      Math.hypot(vertex.x - previousVertex.x, vertex.y - previousVertex.y) >
        COLLISION_EPSILON
    ) {
      cleanedVertices.push(vertex);
    }
  }

  if (cleanedVertices.length > 1) {
    const firstVertex = cleanedVertices[0];
    const lastVertex = cleanedVertices.at(-1);

    if (
      Math.hypot(lastVertex.x - firstVertex.x, lastVertex.y - firstVertex.y) <=
        COLLISION_EPSILON
    ) {
      cleanedVertices.pop();
    }
  }

  return cleanedVertices;
}

/**
 * Clip a convex polygon against one side of the bullet's infinite path. The
 * two clipped polygons retain the original boundary vertices and gain the
 * two new cut intersections, so the visible geometry really is divided by
 * the projectile's line instead of merely replaced with smaller circles.
 */
function clipPolygonByLine(
  vertices,
  linePoint,
  lineDirection,
  keepPositiveSide,
) {
  const clippedVertices = [];
  const sideMultiplier = keepPositiveSide ? 1 : -1;

  for (let vertexIndex = 0; vertexIndex < vertices.length; vertexIndex += 1) {
    const firstVertex = vertices[vertexIndex];
    const secondVertex = vertices[(vertexIndex + 1) % vertices.length];
    const firstSide = sideMultiplier *
      cross2D(
        lineDirection.x,
        lineDirection.y,
        firstVertex.x - linePoint.x,
        firstVertex.y - linePoint.y,
      );
    const secondSide = sideMultiplier *
      cross2D(
        lineDirection.x,
        lineDirection.y,
        secondVertex.x - linePoint.x,
        secondVertex.y - linePoint.y,
      );
    const firstInside = firstSide >= -COLLISION_EPSILON;
    const secondInside = secondSide >= -COLLISION_EPSILON;

    if (firstInside !== secondInside) {
      const sideDifference = firstSide - secondSide;

      if (Math.abs(sideDifference) > COLLISION_EPSILON) {
        const intersectionRatio = firstSide / sideDifference;
        clippedVertices.push({
          x: firstVertex.x +
            (secondVertex.x - firstVertex.x) * intersectionRatio,
          y: firstVertex.y +
            (secondVertex.y - firstVertex.y) * intersectionRatio,
        });
      }
    }

    if (secondInside) {
      clippedVertices.push({ x: secondVertex.x, y: secondVertex.y });
    }
  }

  return cleanPolygon(clippedVertices);
}

/**
 * Return the first normalized position at which a segment enters a convex
 * polygon. Half-plane clipping makes this a swept hit test, avoiding the
 * tunnelling a fast bullet would cause if only its final position were used.
 */
function segmentPolygonIntersectionParameter(start, end, vertices) {
  if (vertices.length < 3) {
    return undefined;
  }

  const direction = {
    x: end.x - start.x,
    y: end.y - start.y,
  };
  let polygonTwiceArea = 0;

  for (let vertexIndex = 0; vertexIndex < vertices.length; vertexIndex += 1) {
    const firstVertex = vertices[vertexIndex];
    const secondVertex = vertices[(vertexIndex + 1) % vertices.length];
    polygonTwiceArea += cross2D(
      firstVertex.x,
      firstVertex.y,
      secondVertex.x,
      secondVertex.y,
    );
  }

  if (Math.abs(polygonTwiceArea) <= COLLISION_EPSILON) {
    return undefined;
  }

  const orientation = polygonTwiceArea < 0 ? -1 : 1;
  let minimumParameter = 0;
  let maximumParameter = 1;

  for (let vertexIndex = 0; vertexIndex < vertices.length; vertexIndex += 1) {
    const firstVertex = vertices[vertexIndex];
    const secondVertex = vertices[(vertexIndex + 1) % vertices.length];
    const edgeX = secondVertex.x - firstVertex.x;
    const edgeY = secondVertex.y - firstVertex.y;
    const startSide = orientation *
      cross2D(
        edgeX,
        edgeY,
        start.x - firstVertex.x,
        start.y - firstVertex.y,
      );
    const sideRate = orientation *
      cross2D(edgeX, edgeY, direction.x, direction.y);

    if (Math.abs(sideRate) <= COLLISION_EPSILON) {
      if (startSide < -COLLISION_EPSILON) {
        return undefined;
      }

      continue;
    }

    const boundaryParameter = (-COLLISION_EPSILON - startSide) / sideRate;

    if (sideRate > 0) {
      minimumParameter = Math.max(minimumParameter, boundaryParameter);
    } else {
      maximumParameter = Math.min(maximumParameter, boundaryParameter);
    }

    if (minimumParameter > maximumParameter + COLLISION_EPSILON) {
      return undefined;
    }
  }

  return minimumParameter <= 1 + COLLISION_EPSILON
    ? Math.min(1, Math.max(0, minimumParameter))
    : undefined;
}

function splitAsteroid(asteroid, bullet, hitPoint) {
  if (asteroid.localVertices.length <= 3) {
    return [];
  }

  const asteroidVertices = asteroid.collisionPolygon();
  const bulletDirection = normalizedVector(
    bullet.velocityX,
    bullet.velocityY,
  );
  let firstPolygon = clipPolygonByLine(
    asteroidVertices,
    hitPoint,
    bulletDirection,
    true,
  );
  let secondPolygon = clipPolygonByLine(
    asteroidVertices,
    hitPoint,
    bulletDirection,
    false,
  );

  // A tangent or a cut exactly through a vertex can create a zero-area side
  // because of floating-point boundaries. A line through the polygon's
  // centroid is a deterministic fallback that still follows the bullet's
  // direction and guarantees two real fragments for a valid convex asteroid.
  if (
    firstPolygon.length < 3 ||
    secondPolygon.length < 3 ||
    polygonArea(firstPolygon) <= COLLISION_EPSILON ||
    polygonArea(secondPolygon) <= COLLISION_EPSILON
  ) {
    const centroid = polygonCentroid(asteroidVertices);
    firstPolygon = clipPolygonByLine(
      asteroidVertices,
      centroid,
      bulletDirection,
      true,
    );
    secondPolygon = clipPolygonByLine(
      asteroidVertices,
      centroid,
      bulletDirection,
      false,
    );
  }

  if (
    firstPolygon.length < 3 ||
    secondPolygon.length < 3 ||
    polygonArea(firstPolygon) <= COLLISION_EPSILON ||
    polygonArea(secondPolygon) <= COLLISION_EPSILON
  ) {
    return [];
  }

  const firstArea = polygonArea(firstPolygon);
  const secondArea = polygonArea(secondPolygon);
  const totalArea = firstArea + secondArea;
  const totalMass = asteroid.mass + bullet.mass;
  const firstMass = (totalMass * firstArea) / totalArea;
  const secondMass = (totalMass * secondArea) / totalArea;
  const totalMomentumX = asteroid.mass * asteroid.velocityX +
    bullet.mass * bullet.velocityX;
  const totalMomentumY = asteroid.mass * asteroid.velocityY +
    bullet.mass * bullet.velocityY;
  const totalKineticEnergy = 0.5 *
      asteroid.mass *
      (asteroid.velocityX ** 2 + asteroid.velocityY ** 2) +
    0.5 *
      bullet.mass *
      (bullet.velocityX ** 2 + bullet.velocityY ** 2);
  const centerVelocityX = totalMomentumX / totalMass;
  const centerVelocityY = totalMomentumY / totalMass;
  const centerKineticEnergy = 0.5 *
    totalMass *
    (centerVelocityX ** 2 + centerVelocityY ** 2);
  const reducedMass = (firstMass * secondMass) / totalMass;
  const relativeKineticEnergy = Math.max(
    0,
    totalKineticEnergy - centerKineticEnergy,
  );
  const relativeSpeed = reducedMass <= COLLISION_EPSILON
    ? 0
    : Math.sqrt((2 * relativeKineticEnergy) / reducedMass);
  // The first polygon is on the left side of the bullet path. Its partner is
  // therefore sent to the right, making the two touching pieces separate
  // without introducing any energy beyond the incoming bodies' energy.
  const separationDirection = {
    x: bulletDirection.y,
    y: -bulletDirection.x,
  };
  const relativeVelocityX = separationDirection.x * relativeSpeed;
  const relativeVelocityY = separationDirection.y * relativeSpeed;
  const firstVelocityX = centerVelocityX -
    (secondMass / totalMass) * relativeVelocityX;
  const firstVelocityY = centerVelocityY -
    (secondMass / totalMass) * relativeVelocityY;
  const secondVelocityX = centerVelocityX +
    (firstMass / totalMass) * relativeVelocityX;
  const secondVelocityY = centerVelocityY +
    (firstMass / totalMass) * relativeVelocityY;

  // Keep the physics calculation based on the complete cut, then remove any
  // undersized result so a grazing hit cannot leave a permanent sliver.
  return [
    {
      area: firstArea,
      asteroid: createAsteroidFromPolygon(
        firstPolygon,
        firstVelocityX,
        firstVelocityY,
        firstMass,
      ),
    },
    {
      area: secondArea,
      asteroid: createAsteroidFromPolygon(
        secondPolygon,
        secondVelocityX,
        secondVelocityY,
        secondMass,
      ),
    },
  ]
    .filter(({ area }) => area >= ASTEROID_MIN_FRAGMENT_AREA)
    .map(({ asteroid: fragment }) => fragment);
}

function resolveBulletCollisions() {
  for (
    let bulletIndex = bullets.length - 1;
    bulletIndex >= 0;
    bulletIndex -= 1
  ) {
    const bullet = bullets[bulletIndex];
    const bulletStart = { x: bullet.previousX, y: bullet.previousY };
    const bulletEnd = { x: bullet.x, y: bullet.y };
    let hitAsteroidIndex = -1;
    let nearestHitParameter = Infinity;

    for (
      let asteroidIndex = 0;
      asteroidIndex < asteroids.length;
      asteroidIndex += 1
    ) {
      const hitParameter = segmentPolygonIntersectionParameter(
        bulletStart,
        bulletEnd,
        asteroids[asteroidIndex].collisionPolygon(),
      );

      if (
        hitParameter !== undefined &&
        hitParameter < nearestHitParameter
      ) {
        nearestHitParameter = hitParameter;
        hitAsteroidIndex = asteroidIndex;
      }
    }

    if (hitAsteroidIndex < 0) {
      continue;
    }

    const asteroid = asteroids[hitAsteroidIndex];
    const hitPoint = {
      x: bulletStart.x +
        (bulletEnd.x - bulletStart.x) * nearestHitParameter,
      y: bulletStart.y +
        (bulletEnd.y - bulletStart.y) * nearestHitParameter,
    };
    const fragments = splitAsteroid(asteroid, bullet, hitPoint);

    // A projectile is consumed by every interaction, including the terminal
    // interaction with a three-vertex asteroid. For larger asteroids the
    // bullet's mass is distributed into the two new bodies by splitAsteroid.
    bullets.splice(bulletIndex, 1);
    asteroids.splice(hitAsteroidIndex, 1, ...fragments);

    if (fragments.length === 2) {
      totalBulletCutCount += 1;

      const beforeMomentum = {
        x: asteroid.mass * asteroid.velocityX + bullet.mass * bullet.velocityX,
        y: asteroid.mass * asteroid.velocityY + bullet.mass * bullet.velocityY,
      };
      const afterMomentum = fragments.reduce(
        (momentum, fragment) => ({
          x: momentum.x + fragment.mass * fragment.velocityX,
          y: momentum.y + fragment.mass * fragment.velocityY,
        }),
        { x: 0, y: 0 },
      );
      const beforeEnergy = 0.5 *
          asteroid.mass *
          (asteroid.velocityX ** 2 + asteroid.velocityY ** 2) +
        0.5 *
          bullet.mass *
          (bullet.velocityX ** 2 + bullet.velocityY ** 2);
      const afterEnergy = fragments.reduce(
        (energy, fragment) =>
          energy +
          0.5 *
            fragment.mass *
            (fragment.velocityX ** 2 + fragment.velocityY ** 2),
        0,
      );

      lastBulletMomentumDelta = {
        x: afterMomentum.x - beforeMomentum.x,
        y: afterMomentum.y - beforeMomentum.y,
      };
      lastBulletKineticEnergyDelta = afterEnergy - beforeEnergy;
    }
  }
}

function polygonAxes(vertices) {
  const axes = [];

  for (let vertexIndex = 0; vertexIndex < vertices.length; vertexIndex += 1) {
    const firstVertex = vertices[vertexIndex];
    const secondVertex = vertices[(vertexIndex + 1) % vertices.length];
    const edgeX = secondVertex.x - firstVertex.x;
    const edgeY = secondVertex.y - firstVertex.y;
    const edgeLength = Math.hypot(edgeX, edgeY);

    if (edgeLength <= COLLISION_EPSILON) {
      continue;
    }

    axes.push({ x: -edgeY / edgeLength, y: edgeX / edgeLength });
  }

  return axes;
}

function projectPolygon(vertices, axis) {
  let minimum = vertices[0].x * axis.x + vertices[0].y * axis.y;
  let maximum = minimum;

  for (const vertex of vertices.slice(1)) {
    const projection = vertex.x * axis.x + vertex.y * axis.y;
    minimum = Math.min(minimum, projection);
    maximum = Math.max(maximum, projection);
  }

  return { minimum, maximum };
}

function projectCircle(body, axis) {
  const centerProjection = body.x * axis.x + body.y * axis.y;

  return {
    minimum: centerProjection - body.radius,
    maximum: centerProjection + body.radius,
  };
}

/**
 * Return the translation needed to separate two one-dimensional projections.
 * The two directional distances matter when one convex shape contains the
 * other; the ordinary intersection width would under-correct that contact.
 */
function projectionOverlap(firstProjection, secondProjection) {
  const moveFirstNegative = firstProjection.maximum - secondProjection.minimum;
  const moveFirstPositive = secondProjection.maximum - firstProjection.minimum;

  return Math.min(moveFirstNegative, moveFirstPositive);
}

function collisionAxis(firstBody, secondBody, axis, firstShape, secondShape) {
  const firstProjection = firstShape.type === "polygon"
    ? projectPolygon(firstShape.vertices, axis)
    : projectCircle(firstBody, axis);
  const secondProjection = secondShape.type === "polygon"
    ? projectPolygon(secondShape.vertices, axis)
    : projectCircle(secondBody, axis);
  const overlap = projectionOverlap(firstProjection, secondProjection);

  return overlap < -COLLISION_EPSILON ? undefined : overlap;
}

function orientCollisionAxis(firstBody, secondBody, axis) {
  const centerOffsetX = secondBody.x - firstBody.x;
  const centerOffsetY = secondBody.y - firstBody.y;
  const centerDirection = centerOffsetX * axis.x + centerOffsetY * axis.y;

  if (centerDirection < -COLLISION_EPSILON) {
    return { x: -axis.x, y: -axis.y };
  }

  if (Math.abs(centerDirection) <= COLLISION_EPSILON) {
    // When the selected edge normal is perpendicular to the center offset,
    // relative motion provides a stable sign. Coincident centers use the same
    // deterministic first-minus-second fallback as the original solver.
    const relativeDirection = normalizedVector(
      firstBody.velocityX - secondBody.velocityX,
      firstBody.velocityY - secondBody.velocityY,
    );

    if (
      relativeDirection.x * axis.x + relativeDirection.y * axis.y < 0
    ) {
      return { x: -axis.x, y: -axis.y };
    }
  }

  return axis;
}

function polygonPolygonManifold(
  firstBody,
  secondBody,
  firstVertices,
  secondVertices,
) {
  // For convex polygons, separating axes are perpendicular to every edge of
  // either polygon. A gap on any one of them proves that the shapes do not
  // touch; the smallest overlap is the contact penetration used by physics.
  const axes = [
    ...polygonAxes(firstVertices),
    ...polygonAxes(secondVertices),
  ];
  let minimumPenetration = Infinity;
  let minimumAxis = axes[0];
  const firstShape = { type: "polygon", vertices: firstVertices };
  const secondShape = { type: "polygon", vertices: secondVertices };

  for (const axis of axes) {
    const overlap = collisionAxis(
      firstBody,
      secondBody,
      axis,
      firstShape,
      secondShape,
    );

    if (overlap === undefined) {
      return undefined;
    }

    if (overlap < minimumPenetration) {
      minimumPenetration = overlap;
      minimumAxis = axis;
    }
  }

  return {
    normal: orientCollisionAxis(firstBody, secondBody, minimumAxis),
    penetration: Math.max(0, minimumPenetration),
  };
}

function closestPointOnSegment(point, firstPoint, secondPoint) {
  const segmentX = secondPoint.x - firstPoint.x;
  const segmentY = secondPoint.y - firstPoint.y;
  const segmentLengthSquared = segmentX ** 2 + segmentY ** 2;

  if (segmentLengthSquared <= COLLISION_EPSILON ** 2) {
    return firstPoint;
  }

  const pointAlongSegment = Math.min(
    1,
    Math.max(
      0,
      ((point.x - firstPoint.x) * segmentX +
        (point.y - firstPoint.y) * segmentY) /
        segmentLengthSquared,
    ),
  );

  return {
    x: firstPoint.x + segmentX * pointAlongSegment,
    y: firstPoint.y + segmentY * pointAlongSegment,
  };
}

function closestPointOnPolygon(point, vertices) {
  let closestPoint = vertices[0];
  let closestDistanceSquared = Infinity;

  for (let vertexIndex = 0; vertexIndex < vertices.length; vertexIndex += 1) {
    const firstVertex = vertices[vertexIndex];
    const secondVertex = vertices[(vertexIndex + 1) % vertices.length];
    const candidate = closestPointOnSegment(point, firstVertex, secondVertex);
    const distanceX = candidate.x - point.x;
    const distanceY = candidate.y - point.y;
    const distanceSquared = distanceX ** 2 + distanceY ** 2;

    if (distanceSquared < closestDistanceSquared) {
      closestDistanceSquared = distanceSquared;
      closestPoint = candidate;
    }
  }

  return closestPoint;
}

function circlePolygonManifold(
  circleBody,
  polygonBody,
  polygonVertices,
) {
  const axes = polygonAxes(polygonVertices);
  const closestPoint = closestPointOnPolygon(
    { x: circleBody.x, y: circleBody.y },
    polygonVertices,
  );
  const closestPointAxis = normalizedVector(
    closestPoint.x - circleBody.x,
    closestPoint.y - circleBody.y,
    1,
    0,
  );

  if (
    Math.hypot(
      closestPoint.x - circleBody.x,
      closestPoint.y - circleBody.y,
    ) > COLLISION_EPSILON
  ) {
    axes.push(closestPointAxis);
  }

  let minimumPenetration = Infinity;
  let minimumAxis = axes[0];
  const circleShape = { type: "circle" };
  const polygonShape = { type: "polygon", vertices: polygonVertices };

  for (const axis of axes) {
    const overlap = collisionAxis(
      circleBody,
      polygonBody,
      axis,
      circleShape,
      polygonShape,
    );

    if (overlap === undefined) {
      return undefined;
    }

    if (overlap < minimumPenetration) {
      minimumPenetration = overlap;
      minimumAxis = axis;
    }
  }

  return {
    normal: orientCollisionAxis(circleBody, polygonBody, minimumAxis),
    penetration: Math.max(0, minimumPenetration),
  };
}

function invertedManifold(manifold) {
  return {
    normal: { x: -manifold.normal.x, y: -manifold.normal.y },
    penetration: manifold.penetration,
  };
}

function collisionManifold(firstBody, secondBody) {
  const firstVertices = firstBody.collisionPolygon?.();
  const secondVertices = secondBody.collisionPolygon?.();
  const firstIsPolygon = firstVertices !== undefined;
  const secondIsPolygon = secondVertices !== undefined;

  if (firstIsPolygon && secondIsPolygon) {
    return polygonPolygonManifold(
      firstBody,
      secondBody,
      firstVertices,
      secondVertices,
    );
  }

  if (!firstIsPolygon && secondIsPolygon) {
    return circlePolygonManifold(firstBody, secondBody, secondVertices);
  }

  if (firstIsPolygon && !secondIsPolygon) {
    const manifold = circlePolygonManifold(
      secondBody,
      firstBody,
      firstVertices,
    );

    return manifold === undefined ? undefined : invertedManifold(manifold);
  }

  return undefined;
}

function physicsSnapshot(ship, includeBullets = false) {
  const bodies = [
    ship,
    ...asteroids,
    ...(includeBullets ? bullets : []),
  ];
  let momentumX = 0;
  let momentumY = 0;
  let kineticEnergy = 0;

  for (const body of bodies) {
    momentumX += body.mass * body.velocityX;
    momentumY += body.mass * body.velocityY;
    kineticEnergy += 0.5 * body.mass *
      (body.velocityX ** 2 + body.velocityY ** 2);
  }

  return { momentumX, momentumY, kineticEnergy };
}

/**
 * Resolve a convex-shape contact with the existing impulse solver. Only the
 * contact normal and penetration now come from the actual shape geometry; the
 * conservation-of-momentum and coefficient-of-restitution handling remains
 * unchanged. With BOUNCINESS set to one, this is an elastic response.
 */
function resolveCollision(firstBody, secondBody) {
  const manifold = collisionManifold(firstBody, secondBody);

  if (manifold === undefined) {
    return false;
  }

  const { normal, penetration } = manifold;
  const offsetX = normal.x;
  const offsetY = normal.y;

  const inverseFirstMass = 1 / firstBody.mass;
  const inverseSecondMass = 1 / secondBody.mass;
  const inverseMassSum = inverseFirstMass + inverseSecondMass;

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
  const relativeNormalVelocity = relativeVelocityX * offsetX +
    relativeVelocityY * offsetY;

  // A contact that is already separating needs position correction only. An
  // impulse here would add energy and make the bodies bounce repeatedly.
  if (relativeNormalVelocity >= 0) {
    return true;
  }

  const impulseMagnitude = (-(1 + BOUNCINESS) * relativeNormalVelocity) /
    inverseMassSum;
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
  lastKineticEnergyDelta = afterCollision.kineticEnergy -
    beforeCollision.kineticEnergy;
  applyPlayerBody(ship);
}

function updateDebugOutput() {
  if (!debugEnabled) {
    return;
  }

  const ship = playerBody();
  const firstAsteroid = asteroids[0];
  const totalPhysics = physicsSnapshot(ship, true);
  const asteroidArea = firstAsteroid?.surfaceArea ?? 0;
  const asteroidMass = firstAsteroid?.mass ?? 0;

  debugOutput.textContent = [
    `PHYSICS DEBUG  (${DEBUG_TOGGLE_KEY} toggles)`,
    `Game: ${gamePaused ? "paused (P toggles)" : "running"}`,
    `Starship mass: ${STARSHIP_MASS.toFixed(2)}`,
    `Asteroid area: ${asteroidArea.toFixed(2)} (first polygon)`,
    `Asteroid mass (including absorbed bullet mass): ${
      asteroidMass.toFixed(2)
    } (first)`,
    `Bounciness: ${BOUNCINESS.toFixed(2)}`,
    `Contacts/frame: ${lastCollisionCount}`,
    `Contacts total: ${totalCollisionCount}`,
    `Bullet mass: ${BULLET_MASS.toFixed(2)}`,
    `Bullet cuts: ${totalBulletCutCount}`,
    `Bullets active: ${bullets.length}`,
    `Bullets fired: ${totalBulletsEmitted}`,
    `Last cut Δ momentum: (${lastBulletMomentumDelta.x.toFixed(5)}, ${
      lastBulletMomentumDelta.y.toFixed(5)
    })`,
    `Last cut Δ kinetic energy: ${lastBulletKineticEnergyDelta.toFixed(5)}`,
    `Δ momentum at contact: (${lastMomentumDelta.x.toFixed(5)}, ${
      lastMomentumDelta.y.toFixed(5)
    })`,
    `Δ kinetic energy at contact: ${lastKineticEnergyDelta.toFixed(5)}`,
    `Total momentum: (${totalPhysics.momentumX.toFixed(2)}, ${
      totalPhysics.momentumY.toFixed(2)
    })`,
    `Total kinetic energy: ${totalPhysics.kineticEnergy.toFixed(2)}`,
  ].join("\n");
}

/**
 * Rotate and change forward speed while controls are held. The ship owns a
 * scalar speed, never a reverse velocity: braking bottoms out at zero and
 * acceleration tops out at MAX_SPEED.
 */
function updateGame(deltaTime, width, height) {
  const turnsCounterClockwise = pressedKeys.has("ArrowLeft") ||
    pressedKeys.has("KeyA");
  const turnsClockwise = pressedKeys.has("ArrowRight") ||
    pressedKeys.has("KeyD");
  const rotationDirection = Number(turnsClockwise) -
    Number(turnsCounterClockwise);

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

  updateBulletFiring(deltaTime);
  updateBullets(deltaTime, width, height);
  resolveBulletCollisions();
  resolveAsteroidCollisions();
}

function animate(frameTime) {
  const deltaTime = previousFrameTime === undefined
    ? 0
    : Math.min((frameTime - previousFrameTime) / 1000, 0.1);
  previousFrameTime = frameTime;

  const { width, height } = canvas.getBoundingClientRect();
  generateAsteroids(width, height);
  if (!gamePaused) {
    updateGame(deltaTime, width, height);
  }
  updateDebugOutput();
  drawGame(width, height);
  window.requestAnimationFrame(animate);
}

function controlKeyForEvent(event) {
  if (event.code === "Space") {
    return "Space";
  }

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
  if (event.code === "KeyP" && !event.repeat) {
    gamePaused = !gamePaused;

    if (gamePaused) {
      // A pause freezes gameplay input as well as simulation time. Requiring a
      // fresh Space press after resuming avoids a held key firing unexpectedly.
      pressedKeys.delete("Space");
      bulletCooldown = 0;
    }

    event.preventDefault();
    return;
  }

  if (event.code === DEBUG_TOGGLE_KEY && !event.repeat) {
    debugEnabled = !debugEnabled;
    debugOutput.hidden = !debugEnabled;
    event.preventDefault();
    return;
  }

  const controlKey = controlKeyForEvent(event);

  if (controlKey !== undefined) {
    event.preventDefault();

    if (gamePaused && controlKey === "Space") {
      return;
    }

    if (controlKey === "Space" && !event.repeat) {
      emitBullet();
      bulletCooldown = BULLET_FIRE_INTERVAL;
    }
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
