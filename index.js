const canvas = document.querySelector("#game-canvas");
const context = canvas.getContext("2d");

/** @typedef {{ x: number, y: number }} Vector2 */
/**
 * @typedef {Object} PhysicsBody
 * @property {number} x
 * @property {number} y
 * @property {number} velocityX
 * @property {number} velocityY
 * @property {number} mass
 * @property {number} [radius]
 * @property {number} [momentOfInertia]
 * @property {number} [angularVelocity]
 */
/**
 * @typedef {Object} CollisionManifold
 * @property {Vector2} normal
 * @property {number} penetration
 * @property {Vector2} contactPoint
 */
/**
 * @typedef {Object} ContactResponse
 * @property {number} x Impulse x component received by the second body.
 * @property {number} y Impulse y component received by the second body.
 * @property {number} normalImpulse
 * @property {number} tangentImpulse
 * @property {number} firstAngularImpulse
 * @property {number} secondAngularImpulse
 */

// Keep keyboard control available after the player clicks the play field.
canvas.tabIndex = 0;
canvas.addEventListener("pointerdown", () => canvas.focus());
canvas.focus({ preventScroll: true });

// The player uses one radius for both the circular hull and the triangle's
// circumcircle, keeping the silhouette consistent as the game evolves.
const PLAYER_RADIUS = 24;
const PLAYER_TRIANGLE_HALF_ANGLE = Math.PI / 4;
// Collision bodies use a mass rather than a gameplay health value. The ship is
// intentionally heavier than a small asteroid, while still being light enough
// for a large asteroid to noticeably change its trajectory.
const STARSHIP_MASS = 1000;
// A global speed keeps the steering response easy to tune from one place and
// makes rotation consistent across displays with different refresh rates.
const ROTATION_SPEED = Math.PI * 1.5;
// Movement is deliberately expressed in CSS pixels per second so the game
// behaves the same at different device pixel ratios and display refresh rates.
const MAX_SPEED = 330;
// This is the rate at which the ship gains or loses speed while a throttle key
// is held. Keeping it global makes the handling easy to tune.
const MOVEMENT_RESPONSIVENESS = 400;

// The shield and hull are intentionally separate gameplay states. Collision
// impulse is scaled into readable percentage points, while the different
// coefficients make the shield absorb slightly more of every impact than the
// unprotected hull would receive.
const SHIELD_MAX_STATE = 100;
const SHIP_MAX_STATE = 100;
const SHIELD_REGENERATION_RATE = 3.5;
const COLLISION_DAMAGE_SCALE = 1 / 6000;
const SHIELD_DAMAGE_COEFFICIENT = 1.15;
const SHIP_DAMAGE_COEFFICIENT = 1.1;
const STATUS_BAR_WIDTH = 220;
const STATUS_BAR_HEIGHT = 22;
const STATUS_BAR_GAP = 12;
const STATUS_BAR_MARGIN = 16;

// Bullets are intentionally fast and short-lived. The frequency is expressed
// in shots per second so holding Space feels regular at every frame rate.
const BULLET_FREQUENCY = 8;
const BULLET_FIRE_INTERVAL = 1 / BULLET_FREQUENCY;
// A bullet's mass is deliberately independent of its visual length. The
// collision response uses this value for both bullet momentum and bullet
// kinetic energy while the projectile remains an independent body.
const BULLET_MASS = 7;
const BULLET_SPEED = 720;
const BULLET_HALF_LENGTH = 10;
const BULLET_LINE_WIDTH = 3;
// Ricochets are deliberately finite: an active bullet can make a short chain
// of useful asteroid cuts without becoming an unbounded simulation object.
const MAX_BULLET_REFLECTIONS = 3;
const BULLET_COLLISION_OFFSET = 0.01;
// Backquote is an uncommon gameplay key and is separate from the ship's
// letter-key controls, so it leaves D available for clockwise rotation.
const DEBUG_TOGGLE_KEY = "Backquote";
const PAUSE_KEY = "KeyP";
const PAUSE_KEY_LABEL = "P";
const FIRE_KEY = "Space";
const FIRE_KEY_LABEL = "SPACE";

// Keep every player-facing control in one compact table. The pause screen uses
// the full descriptions, while the running HUD projects the essential entries
// into one line, so the two help surfaces cannot drift apart.
const PLAY_HELP = Object.freeze([
  Object.freeze({
    label: FIRE_KEY_LABEL,
    description: "shoot",
    compactDescription: "shoot",
    essential: true,
  }),
  Object.freeze({
    label: "W / S",
    description: "thrust / brake",
    compactDescription: "thrust / brake",
    essential: true,
  }),
  Object.freeze({
    label: "A / D",
    description: "turn counter-clockwise / clockwise",
    compactDescription: "turn CCW / CW",
    essential: true,
  }),
  Object.freeze({
    label: PAUSE_KEY_LABEL,
    description: "pause / resume",
    compactDescription: "pause",
    essential: true,
  }),
  Object.freeze({
    label: "COLOR",
    description: "redder asteroids are denser",
    essential: false,
  }),
]);
const ESSENTIAL_HELP_LINE = PLAY_HELP.filter(
  (helpItem) => helpItem.essential,
).map(
  (helpItem) => `${helpItem.label} — ${helpItem.compactDescription}`,
).join("   ·   ");
const HELP_PANEL_WIDTH = 540;
const HELP_PANEL_HEIGHT = 446;
const RUNNING_HELP_PANEL_MAX_WIDTH = 760;
const RUNNING_HELP_PANEL_HEIGHT = 34;
const RUNNING_HELP_PANEL_MARGIN = 16;
const RUNNING_HELP_TEXT_PADDING = 12;
const RUNNING_HELP_FONT_SIZE = 13;
// Give a player who has not touched a control a short, calm reminder before
// drawing attention to the help. The pulse stays subtle so it cannot compete
// with the ship or the asteroid field once the player starts playing.
const HELP_ATTENTION_DELAY = 5;
const HELP_ATTENTION_PULSE_PERIOD = 1.2;
const HELP_ATTENTION_COLOR = "#ffd166";

// A faint two-line chord font brands the arena behind the original random
// asteroid field. Coordinates are in a one-by-one glyph box with y increasing
// downward; every chord is a lightweight physical body.
const ASTEROID_PHRASE_LINES = Object.freeze([
  "KANE CLI",
  "HACKATHON",
]);
const ASTEROID_PHRASE_GLYPHS = Object.freeze({
  K: Object.freeze([
    Object.freeze([0, 0, 0, 1]),
    Object.freeze([0, 0.5, 1, 0]),
    Object.freeze([0, 0.5, 1, 1]),
  ]),
  A: Object.freeze([
    Object.freeze([0, 1, 0.5, 0]),
    Object.freeze([0.5, 0, 1, 1]),
    Object.freeze([0.2, 0.56, 0.8, 0.56]),
  ]),
  N: Object.freeze([
    Object.freeze([0, 1, 0, 0]),
    Object.freeze([0, 0, 1, 1]),
    Object.freeze([1, 1, 1, 0]),
  ]),
  E: Object.freeze([
    Object.freeze([1, 0, 0, 0]),
    Object.freeze([0, 0, 0, 1]),
    Object.freeze([0, 0.5, 0.78, 0.5]),
    Object.freeze([0, 1, 1, 1]),
  ]),
  C: Object.freeze([
    Object.freeze([1, 0, 0, 0]),
    Object.freeze([0, 0, 0, 1]),
    Object.freeze([0, 1, 1, 1]),
  ]),
  L: Object.freeze([
    Object.freeze([0, 0, 0, 1]),
    Object.freeze([0, 1, 1, 1]),
  ]),
  I: Object.freeze([
    Object.freeze([0, 0, 1, 0]),
    Object.freeze([0.5, 0, 0.5, 1]),
    Object.freeze([0, 1, 1, 1]),
  ]),
  H: Object.freeze([
    Object.freeze([0, 0, 0, 1]),
    Object.freeze([1, 0, 1, 1]),
    Object.freeze([0, 0.5, 1, 0.5]),
  ]),
  T: Object.freeze([
    Object.freeze([0, 0, 1, 0]),
    Object.freeze([0.5, 0, 0.5, 1]),
  ]),
  O: Object.freeze([
    Object.freeze([0, 0, 1, 0]),
    Object.freeze([1, 0, 1, 1]),
    Object.freeze([1, 1, 0, 1]),
    Object.freeze([0, 1, 0, 0]),
  ]),
});
const ASTEROID_PHRASE_ADVANCE = 1.28;
const ASTEROID_PHRASE_SPACE_ADVANCE = 0.62;
const ASTEROID_PHRASE_LINE_GAP = 0.56;
const ASTEROID_PHRASE_MARGIN = 48;
// Phrase bodies are narrow, translucent, and much less dense than regular
// asteroids. They remain cuttable collision bodies while reading as secondary
// event branding instead of the main obstacle field.
const ASTEROID_PHRASE_STROKE_WIDTH = 6;
const ASTEROID_PHRASE_OPACITY = 0.22;
const ASTEROID_PHRASE_MIN_DENSITY = 0.08;
const ASTEROID_PHRASE_MAX_DENSITY = 0.16;
const ASTEROID_PHRASE_MIN_SPEED = 1;
const ASTEROID_PHRASE_MAX_SPEED = 4;
const ASTEROID_PHRASE_MAX_ANGULAR_SPEED = 0.04;
const PAUSE_BACKDROP_ALPHA = 0.44;
const PAUSE_PANEL_ALPHA = 0.74;
// Three extra regular bodies add a little more pressure to the opening field
// while keeping the decorative phrase asteroids as a separate composition.
const RANDOM_ASTEROID_COUNT = 12;
const ASTEROID_PHRASE_BODY_COUNT = ASTEROID_PHRASE_LINES.reduce(
  (bodyCount, phraseLine) =>
    bodyCount + Array.from(phraseLine).reduce(
      (lineBodyCount, character) =>
        lineBodyCount + (ASTEROID_PHRASE_GLYPHS[character]?.length ?? 0),
      0,
    ),
  0,
);
const ASTEROID_COUNT = RANDOM_ASTEROID_COUNT + ASTEROID_PHRASE_BODY_COUNT;
const ASTEROID_MIN_RADIUS = 24;
const ASTEROID_MAX_RADIUS = 52;
const ASTEROID_MIN_VERTICES = 6;
const ASTEROID_MAX_VERTICES = 10;
const ASTEROID_MIN_SPEED = 75;
const ASTEROID_MAX_SPEED = 180;
const ASTEROID_MIN_ANGULAR_SPEED = -1.8;
const ASTEROID_MAX_ANGULAR_SPEED = 1.8;
// A grazing cut can produce a technically valid but visually meaningless
// sliver. Discarding fragments below this area keeps the asteroid population
// useful while leaving the cutoff easy to tune for the game's scale.
const ASTEROID_MIN_FRAGMENT_AREA = 400;
// Geometric asteroid mass is density times the true area of the convex
// polygon. The current density is the average material density; each new
// asteroid samples a bounded variation around it so no two materials need to
// be equally massive. The encompassing radius remains useful for safe
// field-boundary placement.
const ASTEROID_DENSITY = 1.0;
const ASTEROID_MIN_DENSITY = 0.65;
const ASTEROID_MAX_DENSITY = 1.35;
// Density is encoded from cool blue-gray to warm red. Both endpoints are
// bright enough against black space, while hue—not brightness—does the main
// communication so denser asteroids remain easy to see.
const ASTEROID_MIN_COLOR_HUE = 210;
const ASTEROID_MAX_COLOR_HUE = 0;
// A value of one is a fully elastic collision. At 0.74, an impact loses about
// 45% of the kinetic energy in the contact-normal component while preserving
// enough motion to keep asteroid contacts and wall hits dynamic.
const BOUNCINESS = 0.74;
// A modest Coulomb friction coefficient lets a shoulder scrape exchange spin
// without draining so much tangential motion that contacts feel sticky.
const FRICTION_COEFFICIENT = 0.25;
const COLLISION_EPSILON = 0.000001;
const STATIC_WALL_BODY = Object.freeze({
  x: 0,
  y: 0,
  velocityX: 0,
  velocityY: 0,
  mass: Infinity,
  momentOfInertia: Infinity,
});
// A rolling sample smooths display-refresh jitter without hiding sustained
// frame-time regressions. The debug panel also reports the lowest full-window
// average observed since the page loaded.
const FPS_SAMPLE_COUNT = 60;

const pressedKeys = new Set();
const asteroids = [];
const bullets = [];
let playerAngle = 0;
let playerVelocityX = 0;
let playerVelocityY = 0;
let playerX;
let playerY;
let shieldState = SHIELD_MAX_STATE;
let shipState = SHIP_MAX_STATE;
let restartRequested = false;
let totalShipRestartCount = 0;
let lastCollisionMomentum = 0;
let lastShieldDamage = 0;
let lastShipDamage = 0;
let previousFrameTime;
let bulletCooldown = 0;
let totalBulletsEmitted = 0;
let totalBulletReflectionCount = 0;
let asteroidsGenerated = false;
// Pausing stops simulation time while leaving the render loop alive, so the
// player can inspect a frozen collision result and resume without a time jump.
// Starting paused gives the player the controls before any movement begins.
let gamePaused = true;
let debugEnabled = false;
let unactedPlayTime = 0;
let helpAttentionActive = false;
let helpAttentionPulseTime = 0;
let lastCollisionCount = 0;
let totalCollisionCount = 0;
let lastMomentumDelta = { x: 0, y: 0 };
let lastKineticEnergyDelta = 0;
let totalBulletCutCount = 0;
let totalBulletShipCollisionCount = 0;
let lastBulletMomentumDelta = { x: 0, y: 0 };
let lastBulletLostMomentum = { x: 0, y: 0 };
let lastBulletKineticEnergyDelta = 0;
let lastBulletAngularMomentumDelta = 0;
let lastBulletShoulder = 0;
let lastBulletAngularImpulse = 0;
let lastBulletShipMomentumDelta = { x: 0, y: 0 };
let lastBulletShipKineticEnergyDelta = 0;
let lastBulletShipImpulse = { x: 0, y: 0 };
let lastFiringImpulseDelta = { x: 0, y: 0 };
let lastFiringRecoilVelocity = { x: 0, y: 0 };
let lastAngularMomentumDelta = 0;
let lastAngularKineticEnergyDelta = 0;
let frameRate = 0;
let minimumFrameRate = Infinity;
const frameTimeSamples = new Float64Array(FPS_SAMPLE_COUNT);
let frameTimeSampleIndex = 0;
let frameTimeSampleCount = 0;
let frameTimeSampleTotal = 0;
let viewportWidth = 0;
let viewportHeight = 0;

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

/**
 * Sample an integer from an inclusive range.
 * @param {number} minimum Inclusive lower bound.
 * @param {number} maximum Inclusive upper bound.
 * @returns {number}
 */
function randomIntegerBetween(minimum, maximum) {
  return Math.floor(randomBetween(minimum, maximum + 1));
}

/**
 * Sample a safe body-center coordinate inside one viewport extent.
 * @param {number} extent Viewport width or height in CSS pixels.
 * @param {number} radius Body radius in CSS pixels.
 * @returns {number}
 */
function randomCoordinate(extent, radius) {
  const minimum = radius;
  const maximum = extent - radius;

  return maximum <= minimum ? extent / 2 : randomBetween(minimum, maximum);
}

/**
 * Generate ordered perimeter angles for a random convex asteroid polygon.
 * @param {number} vertexCount Number of polygon vertices.
 * @returns {readonly number[]}
 */
function createOrderedAngles(vertexCount) {
  const angles = Array.from(
    { length: vertexCount },
    () => randomBetween(0, Math.PI * 2),
  );

  angles.sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  return Object.freeze(angles);
}

/**
 * Convert material density into a readable asteroid color. Lower-density
 * bodies are blue-gray and higher-density bodies become progressively redder.
 * @param {number} density
 * @returns {string}
 */
function asteroidColorForDensity(density) {
  const densityRange = ASTEROID_MAX_DENSITY - ASTEROID_MIN_DENSITY;
  const densityRatio = densityRange > 0
    ? Math.max(
      0,
      Math.min(1, (density - ASTEROID_MIN_DENSITY) / densityRange),
    )
    : 0.5;
  const hue = ASTEROID_MIN_COLOR_HUE +
    (ASTEROID_MAX_COLOR_HUE - ASTEROID_MIN_COLOR_HUE) * densityRatio;

  return `hsl(${hue} 78% 62%)`;
}

/**
 * A convex planar rigid body whose local polygon is centered on its mass
 * center. Rotation is kept separate from the local vertices so collision axes
 * and the rendered silhouette always describe the same pose.
 * @implements {PhysicsBody}
 */
class Asteroid {
  /**
   * @param {Object} options
   * @param {number} options.radius
   * @param {number[]} [options.angles]
   * @param {Vector2[]} [options.localVertices]
   * @param {number} options.x
   * @param {number} options.y
   * @param {number} options.velocityX
   * @param {number} options.velocityY
   * @param {number} options.density
   * @param {number} [options.rotation]
   * @param {number} [options.angularVelocity]
   * @param {number} [options.additionalMass]
   * @param {number} [options.opacity]
   */
  constructor({
    radius,
    angles = [],
    localVertices,
    x,
    y,
    velocityX,
    velocityY,
    density = ASTEROID_DENSITY,
    rotation = 0,
    angularVelocity = 0,
    additionalMass = 0,
    opacity = 1,
  }) {
    const sourceVertices = localVertices ?? angles.map((angle) => ({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    }));
    const localCenter = polygonCentroid(sourceVertices);

    this.radius = Math.max(
      ...sourceVertices.map((vertex) =>
        Math.hypot(vertex.x - localCenter.x, vertex.y - localCenter.y)
      ),
    );
    this.localVertices = Object.freeze(
      sourceVertices.map((vertex) =>
        Object.freeze({
          x: vertex.x - localCenter.x,
          y: vertex.y - localCenter.y,
        })
      ),
    );
    this.x = x;
    this.y = y;
    this.velocityX = velocityX;
    this.velocityY = velocityY;
    this.density = density;
    this.rotation = rotation;
    this.angularVelocity = angularVelocity;
    this.opacity = opacity;
    this.worldVertices = this.localVertices.map((vertex) => ({
      x: this.x + vertex.x,
      y: this.y + vertex.y,
    }));
    this.surfaceAreaValue = polygonArea(this.localVertices);
    this.massValue = this.density * this.surfaceAreaValue + additionalMass;
    // A uniform polygon's mass moment of inertia comes directly from its
    // vertices. Scaling the unit-density value by mass/area also treats any
    // absorbed mass as material spread through the fragment, keeping the
    // parallel-axis relationship exact when a parent asteroid is cut.
    this.momentOfInertiaValue = this.surfaceAreaValue > COLLISION_EPSILON
      ? polygonMassMomentOfInertia(this.localVertices) *
        (this.massValue / this.surfaceAreaValue)
      : this.massValue * this.radius ** 2 / 2;
    // Translation does not change edge normals, so cache these axes once per
    // asteroid instead of rebuilding them during every SAT collision test.
    // The cached local axes are rotated into world space whenever the body
    // geometry is refreshed.
    this.localCollisionAxes = polygonAxes(this.localVertices);
    this.collisionAxes = this.localCollisionAxes.map((axis) => ({ ...axis }));
    this.worldBounds = polygonBounds(this.worldVertices);
    this.collisionPolygon();
  }

  get mass() {
    return this.massValue;
  }

  get surfaceArea() {
    return this.surfaceAreaValue;
  }

  get momentOfInertia() {
    return this.momentOfInertiaValue;
  }

  /**
   * Asteroids move freely until they meet a field boundary or another
   * collision body. Rotation is integrated before the wall check so a spinning
   * shoulder can reach a wall even when the center of mass is stationary.
   */
  update(width, height, deltaTime) {
    this.rotation = wrapAngle(
      this.rotation + this.angularVelocity * deltaTime,
    );
    this.x += this.velocityX * deltaTime;
    this.y += this.velocityY * deltaTime;
    resolveAsteroidWallCollisions(this, width, height);
  }

  keepInside(width, height) {
    this.collisionPolygon();
    const bounds = this.worldBounds;
    const bodyWidth = bounds.maximumX - bounds.minimumX;
    const bodyHeight = bounds.maximumY - bounds.minimumY;

    this.x = bodyWidth >= width
      ? width / 2
      : this.x + (bounds.minimumX < 0
        ? -bounds.minimumX
        : bounds.maximumX > width
        ? width - bounds.maximumX
        : 0);
    this.y = bodyHeight >= height
      ? height / 2
      : this.y + (bounds.minimumY < 0
        ? -bounds.minimumY
        : bounds.maximumY > height
        ? height - bounds.maximumY
        : 0);
    this.collisionPolygon();
  }

  draw() {
    const vertices = this.collisionPolygon();
    const firstVertex = vertices[0];

    context.save();
    context.beginPath();
    context.moveTo(firstVertex.x, firstVertex.y);

    for (let vertexIndex = 1; vertexIndex < vertices.length; vertexIndex += 1) {
      const vertex = vertices[vertexIndex];
      context.lineTo(vertex.x, vertex.y);
    }

    context.closePath();
    context.fillStyle = asteroidColorForDensity(this.density);
    context.globalAlpha = this.opacity;
    context.fill();
    context.restore();
  }

  collisionPolygon() {
    const cosine = Math.cos(this.rotation);
    const sine = Math.sin(this.rotation);

    for (
      let vertexIndex = 0;
      vertexIndex < this.localVertices.length;
      vertexIndex += 1
    ) {
      const localVertex = this.localVertices[vertexIndex];
      const worldVertex = this.worldVertices[vertexIndex];
      worldVertex.x = this.x + localVertex.x * cosine - localVertex.y * sine;
      worldVertex.y = this.y + localVertex.x * sine + localVertex.y * cosine;
    }

    for (
      let axisIndex = 0;
      axisIndex < this.localCollisionAxes.length;
      axisIndex += 1
    ) {
      const localAxis = this.localCollisionAxes[axisIndex];
      const worldAxis = this.collisionAxes[axisIndex];
      worldAxis.x = localAxis.x * cosine - localAxis.y * sine;
      worldAxis.y = localAxis.x * sine + localAxis.y * cosine;
    }

    updatePolygonBounds(this.worldBounds, this.worldVertices);
    return this.worldVertices;
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
    this.reflectionCount = 0;
  }

  get mass() {
    return BULLET_MASS;
  }

  recordReflection() {
    this.reflectionCount += 1;
    totalBulletReflectionCount += 1;
  }

  update(deltaTime) {
    this.previousX = this.x;
    this.previousY = this.y;
    this.x += this.velocityX * deltaTime;
    this.y += this.velocityY * deltaTime;
  }

  syncAngle() {
    this.angle = Math.atan2(this.velocityY, this.velocityX);
  }

  reflect(normal) {
    const normalVelocity = this.velocityX * normal.x +
      this.velocityY * normal.y;

    this.velocityX -= 2 * normalVelocity * normal.x;
    this.velocityY -= 2 * normalVelocity * normal.y;
    this.syncAngle();
    this.recordReflection();
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

/**
 * Create one fully randomized asteroid using the original game composition.
 * @param {number} width Viewport width in CSS pixels.
 * @param {number} height Viewport height in CSS pixels.
 * @returns {Asteroid}
 */
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
    density: randomBetween(ASTEROID_MIN_DENSITY, ASTEROID_MAX_DENSITY),
    x: randomCoordinate(width, radius),
    y: randomCoordinate(height, radius),
    velocityX: Math.cos(direction) * speed,
    velocityY: Math.sin(direction) * speed,
    rotation: randomBetween(0, Math.PI * 2),
    angularVelocity: randomBetween(
      ASTEROID_MIN_ANGULAR_SPEED,
      ASTEROID_MAX_ANGULAR_SPEED,
    ),
  });
}

/**
 * @param {Vector2[]} vertices
 * @param {number} velocityX
 * @param {number} velocityY
 * @param {number} mass
 * @param {number} density
 * @param {number} [rotation]
 * @param {number} [angularVelocity]
 * @param {number} [opacity]
 * @returns {Asteroid}
 */
function createAsteroidFromPolygon(
  vertices,
  velocityX,
  velocityY,
  mass,
  density,
  rotation = 0,
  angularVelocity = 0,
  opacity = 1,
) {
  const center = polygonCentroid(vertices);
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const localVertices = vertices.map((vertex) => ({
    x: (vertex.x - center.x) * cosine + (vertex.y - center.y) * sine,
    y: -(vertex.x - center.x) * sine + (vertex.y - center.y) * cosine,
  }));
  const radius = Math.max(
    ...localVertices.map((vertex) => Math.hypot(vertex.x, vertex.y)),
  );
  const area = polygonArea(vertices);

  return new Asteroid({
    radius,
    localVertices,
    x: center.x,
    y: center.y,
    velocityX,
    velocityY,
    density,
    rotation,
    angularVelocity,
    additionalMass: mass - density * area,
    opacity,
  });
}

/**
 * Return the width of a phrase line in the normalized glyph coordinate space.
 * @param {string} phraseLine
 * @returns {number}
 */
function phraseLineWidth(phraseLine) {
  return Array.from(phraseLine).reduce(
    (width, character) =>
      width +
      (character === " "
        ? ASTEROID_PHRASE_SPACE_ADVANCE
        : ASTEROID_PHRASE_ADVANCE),
    0,
  );
}

/**
 * Choose one scale that keeps the background phrase inside the viewport.
 * @param {number} width Viewport width in CSS pixels.
 * @param {number} height Viewport height in CSS pixels.
 * @returns {number}
 */
function phraseScaleForViewport(width, height) {
  const widestLine = Math.max(
    ...ASTEROID_PHRASE_LINES.map((phraseLine) => phraseLineWidth(phraseLine)),
  );
  const phraseHeight = 2 + ASTEROID_PHRASE_LINE_GAP;
  const availableWidth = Math.max(0, width - ASTEROID_PHRASE_MARGIN * 2);
  const availableHeight = Math.max(0, height - ASTEROID_PHRASE_MARGIN * 2);
  return Math.min(
    availableWidth / widestLine,
    availableHeight / phraseHeight,
  );
}

/**
 * Convert the two hard-coded phrase lines into viewport-sized chord endpoints.
 * @param {number} width Viewport width in CSS pixels.
 * @param {number} height Viewport height in CSS pixels.
 * @returns {{ start: Vector2, end: Vector2 }[]}
 */
function phraseChordsForViewport(width, height) {
  const phraseHeight = 2 + ASTEROID_PHRASE_LINE_GAP;
  const scale = phraseScaleForViewport(width, height);
  const phraseChords = [];
  const blockHeight = phraseHeight * scale;
  const blockTop = (height - blockHeight) / 2;

  for (
    let lineIndex = 0;
    lineIndex < ASTEROID_PHRASE_LINES.length;
    lineIndex += 1
  ) {
    const phraseLine = ASTEROID_PHRASE_LINES[lineIndex];
    const lineWidth = phraseLineWidth(phraseLine) * scale;
    const lineLeft = (width - lineWidth) / 2;
    const lineTop = blockTop +
      lineIndex * (1 + ASTEROID_PHRASE_LINE_GAP) * scale;
    let characterLeft = lineLeft;

    for (const character of phraseLine) {
      const glyph = ASTEROID_PHRASE_GLYPHS[character];
      const characterAdvance = (character === " "
        ? ASTEROID_PHRASE_SPACE_ADVANCE
        : ASTEROID_PHRASE_ADVANCE) * scale;

      if (glyph !== undefined) {
        for (const [startX, startY, endX, endY] of glyph) {
          phraseChords.push({
            start: {
              x: characterLeft + startX * scale,
              y: lineTop + startY * scale,
            },
            end: {
              x: characterLeft + endX * scale,
              y: lineTop + endY * scale,
            },
          });
        }
      }

      characterLeft += characterAdvance;
    }
  }

  return phraseChords;
}

/**
 * Turn one phrase chord into a narrow, lightweight physical asteroid.
 * @param {Vector2} start Chord start point in viewport coordinates.
 * @param {Vector2} end Chord end point in viewport coordinates.
 * @returns {Asteroid | undefined}
 */
function createPhraseAsteroid(start, end) {
  const directionX = end.x - start.x;
  const directionY = end.y - start.y;
  const chordLength = Math.hypot(directionX, directionY);

  if (chordLength <= COLLISION_EPSILON) {
    return undefined;
  }

  const axisX = directionX / chordLength;
  const axisY = directionY / chordLength;
  const normalX = -axisY;
  const normalY = axisX;
  const halfLength = chordLength * 0.46;
  const halfWidth = ASTEROID_PHRASE_STROKE_WIDTH / 2;
  const centerX = (start.x + end.x) / 2;
  const centerY = (start.y + end.y) / 2;
  const vertex = (along, across) => ({
    x: centerX + axisX * along + normalX * across,
    y: centerY + axisY * along + normalY * across,
  });
  const vertices = [
    vertex(-halfLength, -halfWidth * 0.72),
    vertex(-halfLength * 0.84, -halfWidth),
    vertex(halfLength * 0.88, -halfWidth * 0.82),
    vertex(halfLength, -halfWidth * 0.3),
    vertex(halfLength * 0.84, halfWidth),
    vertex(-halfLength * 0.9, halfWidth * 0.8),
  ];
  const density = randomBetween(
    ASTEROID_PHRASE_MIN_DENSITY,
    ASTEROID_PHRASE_MAX_DENSITY,
  );
  const speed = randomBetween(
    ASTEROID_PHRASE_MIN_SPEED,
    ASTEROID_PHRASE_MAX_SPEED,
  );
  const movementDirection = randomBetween(0, Math.PI * 2);
  const area = polygonArea(vertices);

  return createAsteroidFromPolygon(
    vertices,
    Math.cos(movementDirection) * speed,
    Math.sin(movementDirection) * speed,
    density * area,
    density,
    0,
    randomBetween(
      -ASTEROID_PHRASE_MAX_ANGULAR_SPEED,
      ASTEROID_PHRASE_MAX_ANGULAR_SPEED,
    ),
    ASTEROID_PHRASE_OPACITY,
  );
}

function generateAsteroids(width, height) {
  if (asteroidsGenerated || width <= 0 || height <= 0) {
    return;
  }

  const phraseAsteroids = phraseChordsForViewport(width, height)
    .map(({ start, end }) => createPhraseAsteroid(start, end))
    .filter((asteroid) => asteroid !== undefined);

  // Phrase bodies are inserted first so regular opaque asteroids remain the
  // dominant visual layer whenever the two compositions overlap.
  asteroids.push(
    ...phraseAsteroids,
    ...Array.from(
      { length: RANDOM_ASTEROID_COUNT },
      () => createAsteroid(width, height),
    ),
  );
  asteroidsGenerated = true;
}

function emitBullet() {
  const directionX = Math.cos(playerAngle);
  const directionY = Math.sin(playerAngle);
  const spawnDistance = PLAYER_RADIUS + BULLET_HALF_LENGTH;
  const bullet = new Bullet({
    x: playerX + directionX * spawnDistance,
    y: playerY + directionY * spawnDistance,
    angle: playerAngle,
  });
  const initialShipImpulseX = STARSHIP_MASS * playerVelocityX;
  const initialShipImpulseY = STARSHIP_MASS * playerVelocityY;
  const bulletImpulseX = bullet.mass * bullet.velocityX;
  const bulletImpulseY = bullet.mass * bullet.velocityY;

  // Firing transfers the bullet's launch impulse out of the ship. Applying
  // equal and opposite recoil keeps the ship-plus-bullet total impulse equal
  // to the ship's impulse before firing, while making the nudge visible even
  // when the ship was initially at rest.
  const recoilVelocityX = -bulletImpulseX / STARSHIP_MASS;
  const recoilVelocityY = -bulletImpulseY / STARSHIP_MASS;
  playerVelocityX += recoilVelocityX;
  playerVelocityY += recoilVelocityY;
  lastFiringRecoilVelocity = {
    x: recoilVelocityX,
    y: recoilVelocityY,
  };

  const finalTotalImpulseX = STARSHIP_MASS * playerVelocityX +
    bulletImpulseX;
  const finalTotalImpulseY = STARSHIP_MASS * playerVelocityY +
    bulletImpulseY;
  lastFiringImpulseDelta = {
    x: finalTotalImpulseX - initialShipImpulseX,
    y: finalTotalImpulseY - initialShipImpulseY,
  };

  totalBulletsEmitted += 1;
  bullets.push(bullet);
}

function updateBullets(deltaTime) {
  for (
    let bulletIndex = bullets.length - 1;
    bulletIndex >= 0;
    bulletIndex -= 1
  ) {
    const bullet = bullets[bulletIndex];
    bullet.update(deltaTime);
  }
}

function updateBulletFiring(deltaTime) {
  // Keep firing paused even if the key was held before the game was paused.
  // The simulation normally skips this function while paused, but this guard
  // keeps the firing rule local and prevents future callers from bypassing it.
  if (gamePaused || !pressedKeys.has(FIRE_KEY)) {
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

  viewportWidth = width;
  viewportHeight = height;

  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  if (playerX === undefined || playerY === undefined) {
    // Start on the left edge so the opening phrase remains unobstructed and
    // the ship can face into the field as the asteroids fly apart.
    playerX = constrainPosition(width * 0.08, PLAYER_RADIUS, width);
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
  return constrainPositionToRange(position, radius, extent - radius, extent);
}

function constrainPositionToRange(position, minimum, maximum, extent) {
  return maximum <= minimum
    ? extent / 2
    : Math.min(Math.max(position, minimum), maximum);
}

/**
 * Restore a portion of the shield each simulation step. Hull damage is never
 * included here: a damaged ship remains damaged until its life ends.
 * @param {number} deltaTime Elapsed simulation time in seconds.
 * @returns {void}
 */
function regenerateShield(deltaTime) {
  if (!Number.isFinite(deltaTime)) {
    return;
  }

  shieldState = Math.min(
    SHIELD_MAX_STATE,
    shieldState + SHIELD_REGENERATION_RATE * deltaTime,
  );
}

/**
 * Convert contact impulse into damage for both layers of the ship. The
 * transmission fraction is sampled before the impact so a 30% shield sends
 * exactly 70% of the original impact damage toward the hull.
 * @param {number} collisionMomentum Magnitude of the contact impulse.
 * @returns {void}
 */
function applyCollisionDamage(collisionMomentum) {
  const safeCollisionMomentum = Number.isFinite(collisionMomentum)
    ? Math.max(0, collisionMomentum)
    : 0;
  const impactDamage = safeCollisionMomentum *
    COLLISION_DAMAGE_SCALE;
  const shieldFraction = shieldState / SHIELD_MAX_STATE;
  const transmittedFraction = 1 - shieldFraction;
  const shieldDamage = Math.min(
    shieldState,
    impactDamage * SHIELD_DAMAGE_COEFFICIENT,
  );
  const shipDamage = Math.min(
    shipState,
    impactDamage * transmittedFraction * SHIP_DAMAGE_COEFFICIENT,
  );

  shieldState = Math.max(0, shieldState - shieldDamage);
  shipState = Math.max(0, shipState - shipDamage);
  lastCollisionMomentum = safeCollisionMomentum;
  lastShieldDamage = shieldDamage;
  lastShipDamage = shipDamage;

  if (shipState <= COLLISION_EPSILON) {
    shipState = 0;
    restartRequested = true;
  }
}

/**
 * Begin a fresh life after hull destruction. Rebuilding the asteroid field
 * makes the restart a real game restart instead of leaving the player inside
 * the collision that ended the previous life.
 * @param {number} width Viewport width in CSS pixels.
 * @param {number} height Viewport height in CSS pixels.
 * @returns {void}
 */
function restartGame(width, height) {
  playerX = constrainPosition(width * 0.08, PLAYER_RADIUS, width);
  playerY = height / 2;
  playerAngle = 0;
  playerVelocityX = 0;
  playerVelocityY = 0;
  shieldState = SHIELD_MAX_STATE;
  shipState = SHIP_MAX_STATE;
  restartRequested = false;
  totalShipRestartCount += 1;
  bulletCooldown = 0;
  bullets.length = 0;
  pressedKeys.clear();
  resetHelpAttention();
  asteroids.length = 0;
  asteroidsGenerated = false;
  generateAsteroids(width, height);
}

/**
 * Draw the two persistent ship-life indicators in the upper-right corner.
 * These are game UI, not debug output, so they remain visible when debugging
 * is disabled and while the paused help screen is open.
 * @param {number} width Viewport width in CSS pixels.
 * @returns {void}
 */
function drawStatusBars(width) {
  const barWidth = Math.min(
    STATUS_BAR_WIDTH,
    Math.max(0, width - STATUS_BAR_MARGIN * 2),
  );

  if (barWidth <= 0) {
    return;
  }

  const barX = width - barWidth - STATUS_BAR_MARGIN;
  const bars = [
    { label: "SHIELD", state: shieldState, color: "#65d8ff" },
    { label: "SHIP", state: shipState, color: "#ffffff" },
  ];

  context.save();
  context.font = "600 12px system-ui, sans-serif";
  context.textBaseline = "middle";

  for (let barIndex = 0; barIndex < bars.length; barIndex += 1) {
    const bar = bars[barIndex];
    const barY = STATUS_BAR_MARGIN + barIndex *
        (STATUS_BAR_HEIGHT + STATUS_BAR_GAP);
    const fillWidth = barWidth * (bar.state / SHIELD_MAX_STATE);

    context.fillStyle = "rgba(14, 22, 34, 0.88)";
    context.fillRect(barX, barY, barWidth, STATUS_BAR_HEIGHT);
    context.fillStyle = bar.color;
    context.fillRect(barX, barY, fillWidth, STATUS_BAR_HEIGHT);
    context.strokeStyle = "rgba(255, 255, 255, 0.75)";
    context.lineWidth = 1;
    context.strokeRect(
      barX + 0.5,
      barY + 0.5,
      barWidth - 1,
      STATUS_BAR_HEIGHT - 1,
    );

    // Outline the light text so labels remain readable when a bar is nearly
    // empty (dark track) as well as when the fill passes underneath them.
    context.strokeStyle = "rgba(0, 0, 0, 0.9)";
    context.lineWidth = 3;
    context.lineJoin = "round";
    context.fillStyle = "#fff";
    context.textAlign = "left";
    context.strokeText(bar.label, barX + 8, barY + STATUS_BAR_HEIGHT / 2);
    context.fillText(bar.label, barX + 8, barY + STATUS_BAR_HEIGHT / 2);
    context.textAlign = "right";
    context.strokeText(
      `${Math.round(bar.state)}%`,
      barX + barWidth - 8,
      barY + STATUS_BAR_HEIGHT / 2,
    );
    context.fillText(
      `${Math.round(bar.state)}%`,
      barX + barWidth - 8,
      barY + STATUS_BAR_HEIGHT / 2,
    );
  }

  context.restore();
}

/**
 * Clear the running help reminder after a pause or player input.
 * @returns {void}
 */
function resetHelpAttention() {
  unactedPlayTime = 0;
  helpAttentionActive = false;
  helpAttentionPulseTime = 0;
}

/**
 * Track an unacted play session and start the help pulse after its grace
 * period. This uses simulation time, so the reminder does not advance while
 * the game is paused.
 * @param {number} deltaTime Elapsed simulation time in seconds.
 * @returns {void}
 */
function updateHelpAttention(deltaTime) {
  if (gamePaused) {
    resetHelpAttention();
    return;
  }

  if (!Number.isFinite(deltaTime)) {
    return;
  }

  if (helpAttentionActive) {
    helpAttentionPulseTime = (helpAttentionPulseTime + Math.max(0, deltaTime)) %
      HELP_ATTENTION_PULSE_PERIOD;
    return;
  }

  unactedPlayTime += Math.max(0, deltaTime);

  if (unactedPlayTime >= HELP_ATTENTION_DELAY) {
    helpAttentionActive = true;
    helpAttentionPulseTime = 0;
  }
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
  context.strokeStyle = shieldState > 0
    ? "#65d8ff"
    : "rgba(101, 216, 255, 0.35)";
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

  if (gamePaused) {
    drawPauseHelp(width, height);
  } else {
    drawEssentialHelp(width, height);
  }

  drawStatusBars(width);
}

/**
 * Draw the essential controls in a single line while the game is active.
 * Keeping this projection derived from PLAY_HELP makes the first-play
 * reminder match the more detailed paused help without covering the arena.
 * @param {number} width The viewport width in CSS pixels.
 * @param {number} height The viewport height in CSS pixels.
 * @returns {void}
 */
function drawEssentialHelp(width, height) {
  const panelWidth = Math.min(
    RUNNING_HELP_PANEL_MAX_WIDTH,
    Math.max(0, width - RUNNING_HELP_PANEL_MARGIN * 2),
  );
  const panelHeight = Math.min(
    RUNNING_HELP_PANEL_HEIGHT,
    Math.max(0, height - RUNNING_HELP_PANEL_MARGIN * 2),
  );

  if (panelWidth <= 0 || panelHeight <= 0) {
    return;
  }

  const panelX = (width - panelWidth) / 2;
  const panelY = height - panelHeight - RUNNING_HELP_PANEL_MARGIN;
  const textWidth = Math.max(
    0,
    panelWidth - RUNNING_HELP_TEXT_PADDING * 2,
  );
  const attentionPulse = helpAttentionActive
    ? (Math.sin(
      helpAttentionPulseTime * Math.PI * 2 /
        HELP_ATTENTION_PULSE_PERIOD,
    ) + 1) / 2
    : 0;

  context.save();
  context.beginPath();
  context.roundRect(
    panelX,
    panelY,
    panelWidth,
    panelHeight,
    Math.min(10, panelHeight / 2),
  );
  context.fillStyle = helpAttentionActive
    ? `rgba(72, 58, 20, ${0.78 + attentionPulse * 0.1})`
    : "rgba(14, 22, 34, 0.84)";
  context.shadowColor = helpAttentionActive
    ? `rgba(255, 209, 102, ${0.2 + attentionPulse * 0.3})`
    : "transparent";
  context.shadowBlur = helpAttentionActive ? 4 + attentionPulse * 8 : 0;
  context.fill();
  context.globalAlpha = helpAttentionActive ? 0.72 + attentionPulse * 0.28 : 1;
  context.strokeStyle = helpAttentionActive
    ? HELP_ATTENTION_COLOR
    : "rgba(159, 220, 255, 0.65)";
  context.lineWidth = 1;
  context.stroke();
  context.globalAlpha = 1;
  context.shadowBlur = 0;

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = helpAttentionActive ? "#fff4c7" : "#fff";
  context.font = `600 ${RUNNING_HELP_FONT_SIZE}px system-ui, sans-serif`;
  context.fillText(
    ESSENTIAL_HELP_LINE,
    width / 2,
    panelY + panelHeight / 2,
    textWidth,
  );
  context.restore();
}

/**
 * Draw a responsive pause screen over the frozen game and list every key
 * needed to play. The render loop keeps calling this while paused, so the
 * help remains visible after resize and for every later pause.
 * @param {number} width The viewport width in CSS pixels.
 * @param {number} height The viewport height in CSS pixels.
 * @returns {void}
 */
function drawPauseHelp(width, height) {
  const helpScale = Math.max(
    0,
    Math.min(
      1,
      (width - 32) / HELP_PANEL_WIDTH,
      (height - 32) / HELP_PANEL_HEIGHT,
    ),
  );
  const panelWidth = HELP_PANEL_WIDTH * helpScale;
  const panelHeight = HELP_PANEL_HEIGHT * helpScale;
  const panelX = (width - panelWidth) / 2;
  const panelY = (height - panelHeight) / 2;

  context.save();
  // Keep the frozen phrase visible under both layers of the help treatment:
  // the screen veil dims motion behind it, while the panel remains readable
  // without turning the asteroid composition into an opaque black rectangle.
  context.fillStyle = `rgba(0, 0, 0, ${PAUSE_BACKDROP_ALPHA})`;
  context.fillRect(0, 0, width, height);

  if (helpScale === 0) {
    context.restore();
    return;
  }

  context.translate(panelX, panelY);
  context.scale(helpScale, helpScale);
  context.beginPath();
  context.roundRect(0, 0, HELP_PANEL_WIDTH, HELP_PANEL_HEIGHT, 18);
  context.fillStyle = `rgba(14, 22, 34, ${PAUSE_PANEL_ALPHA})`;
  context.fill();
  context.strokeStyle = "rgba(159, 220, 255, 0.8)";
  context.lineWidth = 2;
  context.stroke();

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#fff";
  context.font = "700 32px system-ui, sans-serif";
  context.fillText("PAUSED", HELP_PANEL_WIDTH / 2, 58);
  context.fillStyle = "#9fdcff";
  context.font = "500 18px system-ui, sans-serif";
  context.fillText(
    `Press ${PAUSE_KEY_LABEL} to resume`,
    HELP_PANEL_WIDTH / 2,
    94,
  );

  context.textAlign = "left";
  context.font = "600 18px system-ui, sans-serif";
  for (let helpIndex = 0; helpIndex < PLAY_HELP.length; helpIndex += 1) {
    const helpItem = PLAY_HELP[helpIndex];
    const rowY = 154 + helpIndex * 46;

    context.fillStyle = "#9fdcff";
    context.fillText(helpItem.label, 88, rowY);
    context.fillStyle = "#fff";
    context.font = "400 18px system-ui, sans-serif";
    context.fillText(helpItem.description, 218, rowY);
    context.font = "600 18px system-ui, sans-serif";
  }

  context.textAlign = "center";
  context.fillStyle = "#9aa8b8";
  context.font = "400 15px system-ui, sans-serif";
  context.fillText(
    "Shield regenerates; hull damage persists.",
    HELP_PANEL_WIDTH / 2,
    390,
  );
  context.fillText(
    "Walls are harmless. Navigate, cut, survive.",
    HELP_PANEL_WIDTH / 2,
    418,
  );
  context.restore();
}

/**
 * Move one scalar body coordinate without allocating a result object. This is
 * the hot path used by every moving body on every frame; the loop retains the
 * defensive multi-bounce behavior for tiny viewports.
 */
function advanceAndReflect(
  body,
  positionProperty,
  velocityProperty,
  displacement,
  minimum,
  maximum,
  bounceCoefficient = 1,
) {
  if (maximum <= minimum) {
    body[positionProperty] = (minimum + maximum) / 2;
    return;
  }

  let nextPosition = body[positionProperty] + displacement;
  let directionMultiplier = 1;

  while (nextPosition < minimum || nextPosition > maximum) {
    if (nextPosition < minimum) {
      nextPosition = minimum + (minimum - nextPosition);
      directionMultiplier *= -1;
      body[velocityProperty] *= bounceCoefficient;
    }

    if (nextPosition > maximum) {
      nextPosition = maximum - (nextPosition - maximum);
      directionMultiplier *= -1;
      body[velocityProperty] *= bounceCoefficient;
    }
  }

  body[positionProperty] = nextPosition;
  body[velocityProperty] *= directionMultiplier;
}

/**
 * @param {Asteroid} asteroid
 * @param {number} width
 * @param {number} height
 * @returns {void}
 */
function resolveAsteroidWallCollisions(asteroid, width, height) {
  if (width <= 0 || height <= 0) {
    return;
  }

  // Rotation can make a new vertex reach a wall without the center moving.
  // Rechecking a few times handles a corner contact and a corrective shift
  // without allowing a large frame to leave the polygon embedded.
  for (let collisionPass = 0; collisionPass < 4; collisionPass += 1) {
    asteroid.collisionPolygon();
    const bounds = asteroid.worldBounds;
    let changed = false;

    const resolveWall = (normal, penetration) => {
      if (penetration > 0) {
        asteroid.x -= normal.x * penetration;
        asteroid.y -= normal.y * penetration;
        changed = true;
      }

      asteroid.collisionPolygon();
      const contactPoint = supportPoint(asteroid.worldVertices, normal);
      const response = applyContactImpulse(
        asteroid,
        STATIC_WALL_BODY,
        normal,
        contactPoint,
      );
      changed ||= response.normalImpulse > COLLISION_EPSILON;
    };

    if (bounds.minimumX <= COLLISION_EPSILON) {
      resolveWall(
        { x: -1, y: 0 },
        Math.max(0, -bounds.minimumX),
      );
    }

    if (bounds.maximumX >= width - COLLISION_EPSILON) {
      resolveWall(
        { x: 1, y: 0 },
        Math.max(0, bounds.maximumX - width),
      );
    }

    if (bounds.minimumY <= COLLISION_EPSILON) {
      resolveWall(
        { x: 0, y: -1 },
        Math.max(0, -bounds.minimumY),
      );
    }

    if (bounds.maximumY >= height - COLLISION_EPSILON) {
      resolveWall(
        { x: 0, y: 1 },
        Math.max(0, bounds.maximumY - height),
      );
    }

    if (!changed) {
      return;
    }
  }
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

function wrapAngle(angle) {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

/** @param {PhysicsBody} body @returns {number} */
function bodyInverseMass(body) {
  return Number.isFinite(body.mass) && body.mass > COLLISION_EPSILON
    ? 1 / body.mass
    : 0;
}

/** @param {PhysicsBody} body @returns {number} */
function bodyInverseMomentOfInertia(body) {
  return Number.isFinite(body.momentOfInertia) &&
      body.momentOfInertia > COLLISION_EPSILON
    ? 1 / body.momentOfInertia
    : 0;
}

/** @param {PhysicsBody} body @returns {number} */
function bodyAngularVelocity(body) {
  return body.angularVelocity ?? 0;
}

/**
 * @param {PhysicsBody} body
 * @param {number} [originX]
 * @param {number} [originY]
 * @returns {number}
 */
function bodyAngularMomentum(body, originX = 0, originY = 0) {
  const linearMomentumX = body.mass * body.velocityX;
  const linearMomentumY = body.mass * body.velocityY;
  const orbitalMomentum = cross2D(
    body.x - originX,
    body.y - originY,
    linearMomentumX,
    linearMomentumY,
  );
  const spinMomentum = Number.isFinite(body.momentOfInertia)
    ? body.momentOfInertia * bodyAngularVelocity(body)
    : 0;

  return orbitalMomentum + spinMomentum;
}

/** @param {PhysicsBody} body @returns {number} */
function bodyKineticEnergy(body) {
  const linearEnergy = 0.5 * body.mass *
    (body.velocityX ** 2 + body.velocityY ** 2);
  const rotationalEnergy = Number.isFinite(body.momentOfInertia)
    ? 0.5 * body.momentOfInertia * bodyAngularVelocity(body) ** 2
    : 0;

  return linearEnergy + rotationalEnergy;
}

/** @param {PhysicsBody} body @param {Vector2} point @returns {Vector2} */
function velocityAtPoint(body, point) {
  const offsetX = point.x - body.x;
  const offsetY = point.y - body.y;
  const angularVelocity = bodyAngularVelocity(body);

  return {
    x: body.velocityX - angularVelocity * offsetY,
    y: body.velocityY + angularVelocity * offsetX,
  };
}

/**
 * @param {PhysicsBody} body
 * @param {number} impulseX
 * @param {number} impulseY
 * @param {Vector2} contactPoint
 * @returns {void}
 */
function applyBodyImpulse(body, impulseX, impulseY, contactPoint) {
  const inverseMass = bodyInverseMass(body);
  body.velocityX += impulseX * inverseMass;
  body.velocityY += impulseY * inverseMass;

  const inverseMomentOfInertia = bodyInverseMomentOfInertia(body);

  if (inverseMomentOfInertia > 0 && body.angularVelocity !== undefined) {
    const offsetX = contactPoint.x - body.x;
    const offsetY = contactPoint.y - body.y;
    body.angularVelocity += cross2D(
      offsetX,
      offsetY,
      impulseX,
      impulseY,
    ) * inverseMomentOfInertia;
  }
}

/**
 * @param {PhysicsBody} firstBody
 * @param {PhysicsBody} secondBody
 * @param {number} angularMomentumBefore
 * @returns {void}
 */
function restoreAngularMomentumAfterPositionCorrection(
  firstBody,
  secondBody,
  angularMomentumBefore,
) {
  const angularMomentumAfter = bodyAngularMomentum(firstBody) +
    bodyAngularMomentum(secondBody);
  const angularMomentumCorrection = angularMomentumBefore -
    angularMomentumAfter;
  const firstMoment = Number.isFinite(firstBody.momentOfInertia)
    ? firstBody.momentOfInertia
    : 0;
  const secondMoment = Number.isFinite(secondBody.momentOfInertia)
    ? secondBody.momentOfInertia
    : 0;
  const totalMoment = firstMoment + secondMoment;

  if (totalMoment <= COLLISION_EPSILON) {
    return;
  }

  // Positional overlap correction is a solver convenience rather than a
  // physical impulse. Give its orbital angular-momentum drift back as spin
  // before the real contact response, keeping the isolated pair exactly
  // conservative even when the bodies arrived with tangential momentum.
  const angularVelocityCorrection = angularMomentumCorrection / totalMoment;

  if (firstBody.angularVelocity !== undefined && firstMoment > 0) {
    firstBody.angularVelocity += angularVelocityCorrection;
  }

  if (secondBody.angularVelocity !== undefined && secondMoment > 0) {
    secondBody.angularVelocity += angularVelocityCorrection;
  }
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

/**
 * Return the unit-density polar second moment of a polygon about the origin.
 * Asteroid vertices are centered before this is called, so the result is the
 * rigid body's mass moment of inertia about its center of mass.
 */
/** @param {Vector2[]} vertices @returns {number} */
function polygonMassMomentOfInertia(vertices) {
  let signedMoment = 0;

  for (let vertexIndex = 0; vertexIndex < vertices.length; vertexIndex += 1) {
    const firstVertex = vertices[vertexIndex];
    const secondVertex = vertices[(vertexIndex + 1) % vertices.length];
    const edgeCross = cross2D(
      firstVertex.x,
      firstVertex.y,
      secondVertex.x,
      secondVertex.y,
    );
    const squaredRadiusSum = firstVertex.x ** 2 +
      firstVertex.x * secondVertex.x +
      secondVertex.x ** 2 +
      firstVertex.y ** 2 +
      firstVertex.y * secondVertex.y +
      secondVertex.y ** 2;

    signedMoment += edgeCross * squaredRadiusSum;
  }

  return Math.abs(signedMoment) / 12;
}

function polygonBounds(vertices) {
  const bounds = {
    minimumX: 0,
    maximumX: 0,
    minimumY: 0,
    maximumY: 0,
  };

  return updatePolygonBounds(bounds, vertices);
}

/**
 * @param {{minimumX: number, maximumX: number, minimumY: number, maximumY: number}} bounds
 * @param {Vector2[]} vertices
 * @returns {typeof bounds}
 */
function updatePolygonBounds(bounds, vertices) {
  let minimumX = Infinity;
  let maximumX = -Infinity;
  let minimumY = Infinity;
  let maximumY = -Infinity;

  for (const vertex of vertices) {
    minimumX = Math.min(minimumX, vertex.x);
    maximumX = Math.max(maximumX, vertex.x);
    minimumY = Math.min(minimumY, vertex.y);
    maximumY = Math.max(maximumY, vertex.y);
  }

  bounds.minimumX = minimumX;
  bounds.maximumX = maximumX;
  bounds.minimumY = minimumY;
  bounds.maximumY = maximumY;
  return bounds;
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

/**
 * Return the first normalized position at which a segment reaches a circle.
 * Bullets use this swept test for the ship as well as the polygon test above,
 * so a fast projectile cannot pass through the circular hull between frames.
 */
function segmentCircleIntersectionParameter(start, end, circle) {
  const directionX = end.x - start.x;
  const directionY = end.y - start.y;
  const offsetX = start.x - circle.x;
  const offsetY = start.y - circle.y;
  const directionLengthSquared = directionX ** 2 + directionY ** 2;
  const radiusSquared = circle.radius ** 2;

  if (offsetX ** 2 + offsetY ** 2 <= radiusSquared) {
    return 0;
  }

  if (directionLengthSquared <= COLLISION_EPSILON) {
    return undefined;
  }

  const projectedOffset = offsetX * directionX + offsetY * directionY;
  const discriminant = projectedOffset ** 2 -
    directionLengthSquared * (offsetX ** 2 + offsetY ** 2 - radiusSquared);

  if (discriminant < -COLLISION_EPSILON) {
    return undefined;
  }

  const squareRootDiscriminant = Math.sqrt(Math.max(0, discriminant));
  const firstParameter = (-projectedOffset - squareRootDiscriminant) /
    directionLengthSquared;
  const secondParameter = (-projectedOffset + squareRootDiscriminant) /
    directionLengthSquared;

  if (firstParameter >= -COLLISION_EPSILON && firstParameter <= 1) {
    return Math.max(0, firstParameter);
  }

  return secondParameter >= -COLLISION_EPSILON && secondParameter <= 1
    ? Math.max(0, secondParameter)
    : undefined;
}

/**
 * @param {Asteroid} asteroid
 * @param {PhysicsBody} bullet
 * @param {Vector2} hitPoint
 * @param {Vector2} [cutDirection]
 * @returns {Asteroid[]}
 */
function splitAsteroid(
  asteroid,
  bullet,
  hitPoint,
  cutDirection = normalizedVector(bullet.velocityX, bullet.velocityY),
) {
  if (asteroid.localVertices.length <= 3) {
    return [];
  }

  const asteroidVertices = asteroid.collisionPolygon();
  const bulletDirection = cutDirection;
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
  // The bullet ricochets instead of being absorbed, so only the asteroid's
  // mass is distributed across its two geometric fragments. The caller has
  // already resolved the bullet/asteroid collision before this split.
  const totalMass = asteroid.mass;
  const firstMass = (totalMass * firstArea) / totalArea;
  const secondMass = (totalMass * secondArea) / totalArea;
  // Each fragment inherits the parent's rigid velocity field at its own
  // centroid. Giving both fragments the parent's angular velocity preserves
  // the parent's spin and the orbital angular momentum around its center.
  const firstCenter = polygonCentroid(firstPolygon);
  const secondCenter = polygonCentroid(secondPolygon);
  const firstVelocity = velocityAtPoint(asteroid, firstCenter);
  const secondVelocity = velocityAtPoint(asteroid, secondCenter);

  // Keep the physics calculation based on the complete cut, then remove any
  // undersized result so a grazing hit cannot leave a permanent sliver.
  return [
    {
      area: firstArea,
      asteroid: createAsteroidFromPolygon(
        firstPolygon,
        firstVelocity.x,
        firstVelocity.y,
        firstMass,
        asteroid.density,
        asteroid.rotation,
        asteroid.angularVelocity,
        asteroid.opacity,
      ),
    },
    {
      area: secondArea,
      asteroid: createAsteroidFromPolygon(
        secondPolygon,
        secondVelocity.x,
        secondVelocity.y,
        secondMass,
        asteroid.density,
        asteroid.rotation,
        asteroid.angularVelocity,
        asteroid.opacity,
      ),
    },
  ]
    .filter(({ area }) => area >= ASTEROID_MIN_FRAGMENT_AREA)
    .map(({ asteroid: fragment }) => fragment);
}

function boundaryHit(start, end, width, height) {
  const directionX = end.x - start.x;
  const directionY = end.y - start.y;
  let nearestParameter = Infinity;
  let normal;

  const considerBoundary = (parameter, candidateNormal) => {
    if (
      parameter >= -COLLISION_EPSILON &&
      parameter <= 1 + COLLISION_EPSILON &&
      parameter < nearestParameter
    ) {
      nearestParameter = Math.max(0, parameter);
      normal = candidateNormal;
    }
  };

  if (directionX < -COLLISION_EPSILON) {
    considerBoundary(-start.x / directionX, { x: -1, y: 0 });
  } else if (directionX > COLLISION_EPSILON) {
    considerBoundary((width - start.x) / directionX, { x: 1, y: 0 });
  }

  if (directionY < -COLLISION_EPSILON) {
    considerBoundary(-start.y / directionY, { x: 0, y: -1 });
  } else if (directionY > COLLISION_EPSILON) {
    considerBoundary((height - start.y) / directionY, { x: 0, y: 1 });
  }

  return normal === undefined
    ? undefined
    : { parameter: nearestParameter, normal };
}

function polygonNormalAtPoint(
  vertices,
  point,
  incomingVelocityX,
  incomingVelocityY,
) {
  let polygonTwiceArea = 0;
  let nearestDistanceSquared = Infinity;
  let nearestNormal = { x: 1, y: 0 };

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

  for (let vertexIndex = 0; vertexIndex < vertices.length; vertexIndex += 1) {
    const firstVertex = vertices[vertexIndex];
    const secondVertex = vertices[(vertexIndex + 1) % vertices.length];
    const edgeX = secondVertex.x - firstVertex.x;
    const edgeY = secondVertex.y - firstVertex.y;
    const edgeLength = Math.hypot(edgeX, edgeY);

    if (edgeLength <= COLLISION_EPSILON) {
      continue;
    }

    const pointAlongEdge = Math.min(
      1,
      Math.max(
        0,
        ((point.x - firstVertex.x) * edgeX +
          (point.y - firstVertex.y) * edgeY) / (edgeLength ** 2),
      ),
    );
    const closestX = firstVertex.x + edgeX * pointAlongEdge;
    const closestY = firstVertex.y + edgeY * pointAlongEdge;
    const distanceSquared = (point.x - closestX) ** 2 +
      (point.y - closestY) ** 2;

    if (distanceSquared < nearestDistanceSquared) {
      nearestDistanceSquared = distanceSquared;
      nearestNormal = polygonTwiceArea >= 0
        ? { x: edgeY / edgeLength, y: -edgeX / edgeLength }
        : { x: -edgeY / edgeLength, y: edgeX / edgeLength };
    }
  }

  if (
    incomingVelocityX * nearestNormal.x +
        incomingVelocityY * nearestNormal.y >
      0
  ) {
    nearestNormal.x *= -1;
    nearestNormal.y *= -1;
  }

  return nearestNormal;
}

function circleNormalAtPoint(
  circle,
  point,
  incomingVelocityX,
  incomingVelocityY,
) {
  const fallbackNormal = normalizedVector(
    -incomingVelocityX,
    -incomingVelocityY,
  );
  const normal = normalizedVector(
    point.x - circle.x,
    point.y - circle.y,
    fallbackNormal.x,
    fallbackNormal.y,
  );

  if (incomingVelocityX * normal.x + incomingVelocityY * normal.y > 0) {
    normal.x *= -1;
    normal.y *= -1;
  }

  return normal;
}

/**
 * Apply a rigid-body contact impulse. The normal points from the first body
 * toward the second body, and the returned vector is the impulse received by
 * the second body. The same contact point drives linear motion, spin, and
 * friction, so an off-center shoulder naturally exchanges angular momentum.
 */
/**
 * @param {PhysicsBody} firstBody
 * @param {PhysicsBody} secondBody
 * @param {Vector2} normal
 * @param {Vector2} contactPoint
 * @returns {ContactResponse}
 */
function applyContactImpulse(firstBody, secondBody, normal, contactPoint) {
  const firstOffsetX = contactPoint.x - firstBody.x;
  const firstOffsetY = contactPoint.y - firstBody.y;
  const secondOffsetX = contactPoint.x - secondBody.x;
  const secondOffsetY = contactPoint.y - secondBody.y;
  const inverseFirstMass = bodyInverseMass(firstBody);
  const inverseSecondMass = bodyInverseMass(secondBody);
  const inverseFirstMoment = bodyInverseMomentOfInertia(firstBody);
  const inverseSecondMoment = bodyInverseMomentOfInertia(secondBody);
  const firstNormalLever = cross2D(
    firstOffsetX,
    firstOffsetY,
    normal.x,
    normal.y,
  );
  const secondNormalLever = cross2D(
    secondOffsetX,
    secondOffsetY,
    normal.x,
    normal.y,
  );
  const normalEffectiveMass = inverseFirstMass + inverseSecondMass +
    firstNormalLever ** 2 * inverseFirstMoment +
    secondNormalLever ** 2 * inverseSecondMoment;
  const firstContactVelocity = velocityAtPoint(firstBody, contactPoint);
  const secondContactVelocity = velocityAtPoint(secondBody, contactPoint);
  const relativeVelocityX = secondContactVelocity.x -
    firstContactVelocity.x;
  const relativeVelocityY = secondContactVelocity.y -
    firstContactVelocity.y;
  const relativeNormalVelocity = relativeVelocityX * normal.x +
    relativeVelocityY * normal.y;

  // A separating contact needs no impulse. Applying a response to only one
  // body would change both linear and angular momentum without a counterpart.
  if (
    relativeNormalVelocity >= 0 ||
    normalEffectiveMass <= COLLISION_EPSILON
  ) {
    return {
      x: 0,
      y: 0,
      normalImpulse: 0,
      tangentImpulse: 0,
      firstAngularImpulse: 0,
      secondAngularImpulse: 0,
    };
  }

  const normalImpulseMagnitude = -(1 + BOUNCINESS) * relativeNormalVelocity /
    normalEffectiveMass;
  const normalImpulseX = normalImpulseMagnitude * normal.x;
  const normalImpulseY = normalImpulseMagnitude * normal.y;

  applyBodyImpulse(firstBody, -normalImpulseX, -normalImpulseY, contactPoint);
  applyBodyImpulse(secondBody, normalImpulseX, normalImpulseY, contactPoint);

  // Friction is solved after the normal impulse so the tangent sees the
  // shoulder's updated angular velocity. Clamping it by Coulomb friction
  // keeps the contact from manufacturing energy while allowing spin transfer.
  const tangent = { x: -normal.y, y: normal.x };
  const firstNormalTangentLever = cross2D(
    firstOffsetX,
    firstOffsetY,
    tangent.x,
    tangent.y,
  );
  const secondNormalTangentLever = cross2D(
    secondOffsetX,
    secondOffsetY,
    tangent.x,
    tangent.y,
  );
  const tangentEffectiveMass = inverseFirstMass + inverseSecondMass +
    firstNormalTangentLever ** 2 * inverseFirstMoment +
    secondNormalTangentLever ** 2 * inverseSecondMoment;
  const firstPostNormalVelocity = velocityAtPoint(firstBody, contactPoint);
  const secondPostNormalVelocity = velocityAtPoint(secondBody, contactPoint);
  const relativeTangentVelocity =
    (secondPostNormalVelocity.x - firstPostNormalVelocity.x) * tangent.x +
    (secondPostNormalVelocity.y - firstPostNormalVelocity.y) * tangent.y;
  const unconstrainedTangentImpulse = tangentEffectiveMass >
      COLLISION_EPSILON
    ? -relativeTangentVelocity / tangentEffectiveMass
    : 0;
  const maximumTangentImpulse = FRICTION_COEFFICIENT *
    normalImpulseMagnitude;
  const tangentImpulseMagnitude = Math.min(
    maximumTangentImpulse,
    Math.max(-maximumTangentImpulse, unconstrainedTangentImpulse),
  );
  const tangentImpulseX = tangentImpulseMagnitude * tangent.x;
  const tangentImpulseY = tangentImpulseMagnitude * tangent.y;

  applyBodyImpulse(firstBody, -tangentImpulseX, -tangentImpulseY, contactPoint);
  applyBodyImpulse(secondBody, tangentImpulseX, tangentImpulseY, contactPoint);

  const impulseX = normalImpulseX + tangentImpulseX;
  const impulseY = normalImpulseY + tangentImpulseY;

  return {
    x: impulseX,
    y: impulseY,
    normalImpulse: normalImpulseMagnitude,
    tangentImpulse: tangentImpulseMagnitude,
    firstAngularImpulse: cross2D(
      firstOffsetX,
      firstOffsetY,
      -impulseX,
      -impulseY,
    ),
    secondAngularImpulse: cross2D(
      secondOffsetX,
      secondOffsetY,
      impulseX,
      impulseY,
    ),
  };
}

/**
 * Use the total impulse exchanged at a contact as the collision's momentum
 * measure. Friction is included because it is part of the same interaction.
 * @param {ContactResponse} response Contact impulse response from the solver.
 * @returns {number} Momentum transferred during the contact.
 */
function contactImpulseMagnitude(response) {
  return Math.hypot(response.x, response.y);
}

function resolveBulletCollisions(width, height) {
  const ship = playerBody();

  for (
    let bulletIndex = bullets.length - 1;
    bulletIndex >= 0;
    bulletIndex -= 1
  ) {
    const bullet = bullets[bulletIndex];
    let segmentStart = { x: bullet.previousX, y: bullet.previousY };
    let segmentEnd = { x: bullet.x, y: bullet.y };
    const ignoredAsteroids = new Set();
    let shipIgnored = false;

    // A single animation step can contain more than one collision after a
    // bounce. Rebuild the remaining swept segment after every interaction so
    // the bullet can cut, ricochet, and reach another body immediately.
    for (
      let interactionIndex = 0;
      interactionIndex < 16;
      interactionIndex += 1
    ) {
      const bulletMinimumX = Math.min(segmentStart.x, segmentEnd.x);
      const bulletMaximumX = Math.max(segmentStart.x, segmentEnd.x);
      const bulletMinimumY = Math.min(segmentStart.y, segmentEnd.y);
      const bulletMaximumY = Math.max(segmentStart.y, segmentEnd.y);
      let hitAsteroidIndex = -1;
      let nearestHitParameter = Infinity;

      for (
        let asteroidIndex = 0;
        asteroidIndex < asteroids.length;
        asteroidIndex += 1
      ) {
        const asteroid = asteroids[asteroidIndex];

        if (
          ignoredAsteroids.has(asteroid) ||
          bulletMaximumX < asteroid.x - asteroid.radius ||
          bulletMinimumX > asteroid.x + asteroid.radius ||
          bulletMaximumY < asteroid.y - asteroid.radius ||
          bulletMinimumY > asteroid.y + asteroid.radius
        ) {
          continue;
        }

        const hitParameter = segmentPolygonIntersectionParameter(
          segmentStart,
          segmentEnd,
          asteroid.collisionPolygon(),
        );

        if (
          hitParameter !== undefined &&
          hitParameter < nearestHitParameter
        ) {
          nearestHitParameter = hitParameter;
          hitAsteroidIndex = asteroidIndex;
        }
      }

      const wallHit = boundaryHit(segmentStart, segmentEnd, width, height);
      const asteroidIsFirst = hitAsteroidIndex >= 0 &&
        nearestHitParameter <= (wallHit?.parameter ?? Infinity);
      const shipHitParameter = shipIgnored
        ? Infinity
        : segmentCircleIntersectionParameter(segmentStart, segmentEnd, ship);
      const shipIsFirst = shipHitParameter !== undefined &&
        shipHitParameter < nearestHitParameter &&
        shipHitParameter <= (wallHit?.parameter ?? Infinity);
      const bodyIsFirst = asteroidIsFirst || shipIsFirst;

      if (!bodyIsFirst && wallHit === undefined) {
        break;
      }

      const hitParameter = asteroidIsFirst
        ? nearestHitParameter
        : shipIsFirst
        ? shipHitParameter
        : wallHit.parameter;
      const hitPoint = {
        x: segmentStart.x + (segmentEnd.x - segmentStart.x) * hitParameter,
        y: segmentStart.y + (segmentEnd.y - segmentStart.y) * hitParameter,
      };
      const remainingDistance = Math.hypot(
        segmentEnd.x - segmentStart.x,
        segmentEnd.y - segmentStart.y,
      ) * (1 - hitParameter);
      const canReflect = bullet.reflectionCount < MAX_BULLET_REFLECTIONS;

      let normal = bodyIsFirst ? undefined : wallHit.normal;

      if (asteroidIsFirst) {
        const asteroid = asteroids[hitAsteroidIndex];
        bullet.x = hitPoint.x;
        bullet.y = hitPoint.y;
        const beforeMomentum = {
          x: asteroid.mass * asteroid.velocityX +
            bullet.mass * bullet.velocityX,
          y: asteroid.mass * asteroid.velocityY +
            bullet.mass * bullet.velocityY,
        };
        const beforeAngularMomentum = bodyAngularMomentum(asteroid) +
          bodyAngularMomentum(bullet);
        const beforeEnergy = bodyKineticEnergy(asteroid) +
          bodyKineticEnergy(bullet);

        normal = polygonNormalAtPoint(
          asteroid.collisionPolygon(),
          hitPoint,
          bullet.velocityX,
          bullet.velocityY,
        );
        const incomingDirection = normalizedVector(
          bullet.velocityX,
          bullet.velocityY,
        );
        const bulletResponse = applyContactImpulse(
          asteroid,
          bullet,
          normal,
          hitPoint,
        );
        lastBulletLostMomentum = {
          x: -bulletResponse.x,
          y: -bulletResponse.y,
        };
        lastBulletShoulder = cross2D(
          hitPoint.x - asteroid.x,
          hitPoint.y - asteroid.y,
          normal.x,
          normal.y,
        );
        lastBulletAngularImpulse = bulletResponse.firstAngularImpulse;
        bullet.syncAngle();
        if (canReflect) {
          bullet.recordReflection();
        }
        const fragments = splitAsteroid(
          asteroid,
          bullet,
          hitPoint,
          incomingDirection,
        );
        asteroids.splice(hitAsteroidIndex, 1, ...fragments);

        for (const fragment of fragments) {
          ignoredAsteroids.add(fragment);
        }

        if (fragments.length === 2) {
          totalBulletCutCount += 1;
          const afterMomentum = fragments.reduce(
            (momentum, fragment) => ({
              x: momentum.x + fragment.mass * fragment.velocityX,
              y: momentum.y + fragment.mass * fragment.velocityY,
            }),
            {
              x: bullet.mass * bullet.velocityX,
              y: bullet.mass * bullet.velocityY,
            },
          );
          const afterAngularMomentum = fragments.reduce(
            (angularMomentum, fragment) =>
              angularMomentum + bodyAngularMomentum(fragment),
            bodyAngularMomentum(bullet),
          );
          const afterEnergy = fragments.reduce(
            (energy, fragment) => energy + bodyKineticEnergy(fragment),
            bodyKineticEnergy(bullet),
          );

          lastBulletMomentumDelta = {
            x: afterMomentum.x - beforeMomentum.x,
            y: afterMomentum.y - beforeMomentum.y,
          };
          lastBulletAngularMomentumDelta = afterAngularMomentum -
            beforeAngularMomentum;
          lastBulletKineticEnergyDelta = afterEnergy - beforeEnergy;
        }
      } else if (shipIsFirst) {
        bullet.x = hitPoint.x;
        bullet.y = hitPoint.y;
        const beforeMomentum = {
          x: ship.mass * ship.velocityX + bullet.mass * bullet.velocityX,
          y: ship.mass * ship.velocityY + bullet.mass * bullet.velocityY,
        };
        const beforeEnergy = bodyKineticEnergy(ship) +
          bodyKineticEnergy(bullet);

        normal = circleNormalAtPoint(
          ship,
          hitPoint,
          bullet.velocityX,
          bullet.velocityY,
        );
        const bulletImpulse = applyContactImpulse(
          ship,
          bullet,
          normal,
          hitPoint,
        );
        const shipImpulse = {
          x: -bulletImpulse.x,
          y: -bulletImpulse.y,
        };
        applyCollisionDamage(contactImpulseMagnitude(bulletImpulse));
        lastBulletLostMomentum = {
          x: -bulletImpulse.x,
          y: -bulletImpulse.y,
        };
        lastBulletShoulder = 0;
        lastBulletAngularImpulse = 0;
        bullet.syncAngle();

        if (canReflect) {
          bullet.recordReflection();
        }

        const afterMomentum = {
          x: ship.mass * ship.velocityX + bullet.mass * bullet.velocityX,
          y: ship.mass * ship.velocityY + bullet.mass * bullet.velocityY,
        };
        const afterEnergy = bodyKineticEnergy(ship) +
          bodyKineticEnergy(bullet);

        totalBulletShipCollisionCount += 1;
        lastBulletShipImpulse = shipImpulse;
        lastBulletShipMomentumDelta = {
          x: afterMomentum.x - beforeMomentum.x,
          y: afterMomentum.y - beforeMomentum.y,
        };
        lastBulletShipKineticEnergyDelta = afterEnergy - beforeEnergy;
        shipIgnored = true;
      }

      if (!canReflect) {
        bullets.splice(bulletIndex, 1);
        break;
      }

      if (!bodyIsFirst) {
        bullet.reflect(normal);
      }
      const direction = normalizedVector(bullet.velocityX, bullet.velocityY);
      const travelDistance = Math.max(
        0,
        remainingDistance - BULLET_COLLISION_OFFSET,
      );
      segmentStart = {
        x: hitPoint.x + direction.x * BULLET_COLLISION_OFFSET,
        y: hitPoint.y + direction.y * BULLET_COLLISION_OFFSET,
      };
      segmentEnd = {
        x: segmentStart.x + direction.x * travelDistance,
        y: segmentStart.y + direction.y * travelDistance,
      };
    }

    if (bulletIndex >= 0 && bulletIndex < bullets.length) {
      bullet.previousX = bullet.x;
      bullet.previousY = bullet.y;
      bullet.x = segmentEnd.x;
      bullet.y = segmentEnd.y;
    }
  }

  applyPlayerBody(ship);
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

  for (let vertexIndex = 1; vertexIndex < vertices.length; vertexIndex += 1) {
    const vertex = vertices[vertexIndex];
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

/** @param {Vector2[]} vertices @param {Vector2} direction @returns {Vector2} */
function supportPoint(vertices, direction) {
  const supportTolerance = COLLISION_EPSILON * 100;
  let greatestProjection = -Infinity;
  let supportX = 0;
  let supportY = 0;
  let supportCount = 0;

  for (const vertex of vertices) {
    const projection = vertex.x * direction.x + vertex.y * direction.y;

    if (projection > greatestProjection + supportTolerance) {
      greatestProjection = projection;
      supportX = vertex.x;
      supportY = vertex.y;
      supportCount = 1;
    } else if (Math.abs(projection - greatestProjection) <= supportTolerance) {
      supportX += vertex.x;
      supportY += vertex.y;
      supportCount += 1;
    }
  }

  return {
    x: supportX / supportCount,
    y: supportY / supportCount,
  };
}

/**
 * @param {PhysicsBody} firstBody
 * @param {PhysicsBody} secondBody
 * @param {Vector2} normal
 * @param {Vector2[]} [firstVertices]
 * @param {Vector2[]} [secondVertices]
 * @returns {Vector2}
 */
function contactPointForBodies(
  firstBody,
  secondBody,
  normal,
  firstVertices,
  secondVertices,
) {
  const firstPoint = firstVertices === undefined
    ? {
      x: firstBody.x + normal.x * firstBody.radius,
      y: firstBody.y + normal.y * firstBody.radius,
    }
    : supportPoint(firstVertices, normal);
  const secondPoint = secondVertices === undefined
    ? {
      x: secondBody.x - normal.x * secondBody.radius,
      y: secondBody.y - normal.y * secondBody.radius,
    }
    : supportPoint(secondVertices, { x: -normal.x, y: -normal.y });

  return {
    x: (firstPoint.x + secondPoint.x) / 2,
    y: (firstPoint.y + secondPoint.y) / 2,
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

/**
 * @param {PhysicsBody} firstBody
 * @param {PhysicsBody} secondBody
 * @param {Vector2[]} firstVertices
 * @param {Vector2[]} secondVertices
 * @returns {CollisionManifold | undefined}
 */
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
    ...(firstBody.collisionAxes ?? polygonAxes(firstVertices)),
    ...(secondBody.collisionAxes ?? polygonAxes(secondVertices)),
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

  const normal = orientCollisionAxis(firstBody, secondBody, minimumAxis);

  return {
    normal,
    penetration: Math.max(0, minimumPenetration),
    contactPoint: contactPointForBodies(
      firstBody,
      secondBody,
      normal,
      firstVertices,
      secondVertices,
    ),
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

/**
 * @param {PhysicsBody} circleBody
 * @param {PhysicsBody} polygonBody
 * @param {Vector2[]} polygonVertices
 * @returns {CollisionManifold | undefined}
 */
function circlePolygonManifold(
  circleBody,
  polygonBody,
  polygonVertices,
) {
  const axes = [
    ...(polygonBody.collisionAxes ?? polygonAxes(polygonVertices)),
  ];
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

  const normal = orientCollisionAxis(circleBody, polygonBody, minimumAxis);

  return {
    normal,
    penetration: Math.max(0, minimumPenetration),
    contactPoint: contactPointForBodies(
      circleBody,
      polygonBody,
      normal,
      undefined,
      polygonVertices,
    ),
  };
}

function invertedManifold(manifold) {
  return {
    normal: { x: -manifold.normal.x, y: -manifold.normal.y },
    penetration: manifold.penetration,
    contactPoint: manifold.contactPoint,
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

/**
 * @param {PhysicsBody} ship
 * @param {boolean} [includeBullets]
 * @returns {{momentumX: number, momentumY: number, kineticEnergy: number, angularMomentum: number, angularKineticEnergy: number}}
 */
function physicsSnapshot(ship, includeBullets = false) {
  const bodies = [
    ship,
    ...asteroids,
    ...(includeBullets ? bullets : []),
  ];
  let momentumX = 0;
  let momentumY = 0;
  let kineticEnergy = 0;
  let angularMomentum = 0;
  let angularKineticEnergy = 0;

  for (const body of bodies) {
    momentumX += body.mass * body.velocityX;
    momentumY += body.mass * body.velocityY;
    kineticEnergy += bodyKineticEnergy(body);
    angularMomentum += bodyAngularMomentum(body);
    angularKineticEnergy += Number.isFinite(body.momentOfInertia)
      ? 0.5 * body.momentOfInertia * bodyAngularVelocity(body) ** 2
      : 0;
  }

  return {
    momentumX,
    momentumY,
    kineticEnergy,
    angularMomentum,
    angularKineticEnergy,
  };
}

/**
 * Resolve a convex-shape contact with a single shared contact point. Equal
 * and opposite impulses at that point preserve total angular momentum for an
 * isolated asteroid pair, while the restitution and friction coefficients
 * account for the energy dissipated by a non-ideal collision.
 */
/**
 * @param {PhysicsBody} firstBody
 * @param {PhysicsBody} secondBody
 * @returns {ContactResponse | undefined} Contact response, or undefined when
 *   the bodies do not overlap.
 */
function resolveCollision(firstBody, secondBody) {
  const manifold = collisionManifold(firstBody, secondBody);

  if (manifold === undefined) {
    return undefined;
  }

  const { normal, penetration, contactPoint } = manifold;
  const offsetX = normal.x;
  const offsetY = normal.y;

  const inverseFirstMass = bodyInverseMass(firstBody);
  const inverseSecondMass = bodyInverseMass(secondBody);
  const inverseMassSum = inverseFirstMass + inverseSecondMass;
  const angularMomentumBeforeSeparation = bodyAngularMomentum(firstBody) +
    bodyAngularMomentum(secondBody);

  // Separate overlap proportionally to inverse mass. This keeps a large
  // asteroid from teleporting the ship while preventing repeated impulses
  // from a body that remains embedded after a large animation frame.
  if (penetration > 0) {
    const separation = penetration / inverseMassSum;
    firstBody.x -= offsetX * separation * inverseFirstMass;
    firstBody.y -= offsetY * separation * inverseFirstMass;
    secondBody.x += offsetX * separation * inverseSecondMass;
    secondBody.y += offsetY * separation * inverseSecondMass;
    restoreAngularMomentumAfterPositionCorrection(
      firstBody,
      secondBody,
      angularMomentumBeforeSeparation,
    );
  }

  const response = applyContactImpulse(firstBody, secondBody, {
    x: offsetX,
    y: offsetY,
  }, contactPoint);

  return response;
}

function playerBody() {
  return {
    x: playerX,
    y: playerY,
    radius: PLAYER_RADIUS,
    mass: STARSHIP_MASS,
    velocityX: playerVelocityX,
    velocityY: playerVelocityY,
  };
}

function applyPlayerBody(body) {
  playerX = body.x;
  playerY = body.y;
  playerVelocityX = body.velocityX;
  playerVelocityY = body.velocityY;
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
      const secondAsteroid = asteroids[secondIndex];

      if (!bodiesMayOverlap(firstAsteroid, secondAsteroid)) {
        continue;
      }

      collisionCount += Number(
        resolveCollision(firstAsteroid, secondAsteroid) !== undefined,
      );
    }
  }

  for (const asteroid of asteroids) {
    if (!bodiesMayOverlap(ship, asteroid)) {
      continue;
    }

    const response = resolveCollision(ship, asteroid);
    collisionCount += Number(response !== undefined);

    if (response !== undefined) {
      applyCollisionDamage(contactImpulseMagnitude(response));
    }
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
  lastAngularMomentumDelta = afterCollision.angularMomentum -
    beforeCollision.angularMomentum;
  lastAngularKineticEnergyDelta = afterCollision.angularKineticEnergy -
    beforeCollision.angularKineticEnergy;
  applyPlayerBody(ship);
}

function bodiesMayOverlap(firstBody, secondBody) {
  const distanceX = secondBody.x - firstBody.x;
  const distanceY = secondBody.y - firstBody.y;
  const radiusSum = firstBody.radius + secondBody.radius;

  return distanceX ** 2 + distanceY ** 2 <= radiusSum ** 2;
}

function updateFrameRate(frameTime) {
  if (previousFrameTime === undefined) {
    return;
  }

  const frameDuration = frameTime - previousFrameTime;

  if (frameDuration <= 0) {
    return;
  }

  if (frameTimeSampleCount === FPS_SAMPLE_COUNT) {
    frameTimeSampleTotal -= frameTimeSamples[frameTimeSampleIndex];
  } else {
    frameTimeSampleCount += 1;
  }

  frameTimeSamples[frameTimeSampleIndex] = frameDuration;
  frameTimeSampleTotal += frameDuration;
  frameTimeSampleIndex = (frameTimeSampleIndex + 1) % FPS_SAMPLE_COUNT;
  frameRate = 1000 / (frameTimeSampleTotal / frameTimeSampleCount);

  if (frameTimeSampleCount === FPS_SAMPLE_COUNT) {
    minimumFrameRate = Math.min(minimumFrameRate, frameRate);
  }
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
  const displayedFrameRate = frameRate > 0 ? frameRate.toFixed(1) : "--";
  const displayedMinimumFrameRate = Number.isFinite(minimumFrameRate)
    ? minimumFrameRate.toFixed(1)
    : "--";

  debugOutput.textContent = [
    `PHYSICS DEBUG  (${DEBUG_TOGGLE_KEY} toggles)`,
    `Game: ${gamePaused ? `${PAUSE_KEY_LABEL} toggles` : "running"}`,
    `Shield/ship: ${shieldState.toFixed(2)}%/${shipState.toFixed(2)}% (regen ${
      SHIELD_REGENERATION_RATE.toFixed(1)
    }/s)`,
    `Damage: momentum ${lastCollisionMomentum.toFixed(2)}, shield ${
      lastShieldDamage.toFixed(2)
    }, ship ${lastShipDamage.toFixed(2)}`,
    `Damage coefficients: shield ${
      SHIELD_DAMAGE_COEFFICIENT.toFixed(2)
    }, ship ${SHIP_DAMAGE_COEFFICIENT.toFixed(2)}`,
    `Ship restarts: ${totalShipRestartCount}`,
    `Asteroids: ${asteroids.length} (target: ${ASTEROID_COUNT})`,
    `FPS: ${displayedFrameRate} (rolling ${FPS_SAMPLE_COUNT}-frame avg)`,
    `FPS minimum: ${displayedMinimumFrameRate} (rolling window)`,
    `Asteroid: ${asteroidMass.toFixed(2)} mass, ${
      asteroidArea.toFixed(2)
    } area, density ${(firstAsteroid?.density ?? 0).toFixed(3)}`,
    `Spin: ${(firstAsteroid?.angularVelocity ?? 0).toFixed(5)} rad/s, inertia ${
      (firstAsteroid?.momentOfInertia ?? 0).toFixed(2)
    }`,
    `Collision: ${lastCollisionCount}/frame, ${totalCollisionCount} total`,
    `Material: e=${BOUNCINESS.toFixed(2)}, friction=${
      FRICTION_COEFFICIENT.toFixed(2)
    }`,
    `Bullets: ${totalBulletsEmitted} fired, ${bullets.length} active, ${totalBulletCutCount} cuts`,
    `Bullet mass/reflections: ${
      BULLET_MASS.toFixed(2)
    }/${totalBulletReflectionCount}`,
    `Bullet lost Δp: (${lastBulletLostMomentum.x.toFixed(5)}, ${
      lastBulletLostMomentum.y.toFixed(5)
    })`,
    `Bullet shoulder/ΔL: ${lastBulletShoulder.toFixed(5)}/${
      lastBulletAngularImpulse.toFixed(5)
    }`,
    `Last cut Δp: (${lastBulletMomentumDelta.x.toFixed(5)}, ${
      lastBulletMomentumDelta.y.toFixed(5)
    })`,
    `Last cut ΔL/ΔE: ${lastBulletAngularMomentumDelta.toFixed(5)}/${
      lastBulletKineticEnergyDelta.toFixed(5)
    }`,
    `Ship contacts: ${totalBulletShipCollisionCount}, last impulse (${
      lastBulletShipImpulse.x.toFixed(5)
    }, ${lastBulletShipImpulse.y.toFixed(5)})`,
    `Ship Δp/ΔE: (${lastBulletShipMomentumDelta.x.toFixed(5)}, ${
      lastBulletShipMomentumDelta.y.toFixed(5)
    })/${lastBulletShipKineticEnergyDelta.toFixed(5)}`,
    `Firing Δp/recoil: (${lastFiringImpulseDelta.x.toFixed(5)}, ${
      lastFiringImpulseDelta.y.toFixed(5)
    })/(${lastFiringRecoilVelocity.x.toFixed(5)}, ${
      lastFiringRecoilVelocity.y.toFixed(5)
    })`,
    `Contact Δp: (${lastMomentumDelta.x.toFixed(5)}, ${
      lastMomentumDelta.y.toFixed(5)
    })`,
    `Contact ΔL/ΔE: ${lastAngularMomentumDelta.toFixed(5)}/${
      lastKineticEnergyDelta.toFixed(5)
    }`,
    `Total p: (${totalPhysics.momentumX.toFixed(2)}, ${
      totalPhysics.momentumY.toFixed(2)
    })`,
    `Total angular momentum: ${totalPhysics.angularMomentum.toFixed(2)}`,
    `Total kinetic energy: ${totalPhysics.kineticEnergy.toFixed(2)}`,
  ].join("\n");
}

/**
 * Rotation changes the ship's facing only. The velocity vector remains free,
 * so a ship can drift sideways or backwards while its nose controls firing
 * and thrust. Down decelerates along the current travel vector rather than
 * steering the ship toward its nose.
 */
function updateGame(deltaTime, width, height) {
  regenerateShield(deltaTime);

  const turnsCounterClockwise = pressedKeys.has("ArrowLeft") ||
    pressedKeys.has("KeyA");
  const turnsClockwise = pressedKeys.has("ArrowRight") ||
    pressedKeys.has("KeyD");
  const rotationDirection = Number(turnsClockwise) -
    Number(turnsCounterClockwise);

  playerAngle += rotationDirection * ROTATION_SPEED * deltaTime;

  const accelerates = pressedKeys.has("ArrowUp") || pressedKeys.has("KeyW");
  const decelerates = pressedKeys.has("ArrowDown") || pressedKeys.has("KeyS");

  if (accelerates !== decelerates) {
    if (accelerates) {
      const acceleration = MOVEMENT_RESPONSIVENESS * deltaTime;
      playerVelocityX += Math.cos(playerAngle) * acceleration;
      playerVelocityY += Math.sin(playerAngle) * acceleration;

      const acceleratedSpeed = Math.hypot(
        playerVelocityX,
        playerVelocityY,
      );

      if (acceleratedSpeed > MAX_SPEED) {
        const speedRatio = MAX_SPEED / acceleratedSpeed;
        playerVelocityX *= speedRatio;
        playerVelocityY *= speedRatio;
      }
    } else {
      const currentSpeed = Math.hypot(playerVelocityX, playerVelocityY);

      if (currentSpeed > COLLISION_EPSILON) {
        const deceleration = Math.min(
          currentSpeed,
          MOVEMENT_RESPONSIVENESS * deltaTime,
        );
        const speedRatio = (currentSpeed - deceleration) / currentSpeed;
        playerVelocityX *= speedRatio;
        playerVelocityY *= speedRatio;
      }
    }
  }

  for (const asteroid of asteroids) {
    asteroid.update(width, height, deltaTime);
  }

  // The ship is a dynamic body just like an asteroid. In particular, walls
  // damp its normal velocity through BOUNCINESS instead of merely changing
  // its position, so wall collisions remove kinetic energy consistently.
  const ship = playerBody();
  advanceAndReflect(
    ship,
    "x",
    "velocityX",
    ship.velocityX * deltaTime,
    PLAYER_RADIUS,
    width - PLAYER_RADIUS,
    BOUNCINESS,
  );
  advanceAndReflect(
    ship,
    "y",
    "velocityY",
    ship.velocityY * deltaTime,
    PLAYER_RADIUS,
    height - PLAYER_RADIUS,
    BOUNCINESS,
  );
  applyPlayerBody(ship);

  updateBulletFiring(deltaTime);
  updateBullets(deltaTime);
  resolveBulletCollisions(width, height);
  resolveAsteroidCollisions();

  if (restartRequested) {
    restartGame(width, height);
  }
}

function animate(frameTime) {
  updateFrameRate(frameTime);
  const deltaTime = previousFrameTime === undefined
    ? 0
    : Math.min((frameTime - previousFrameTime) / 1000, 0.1);
  previousFrameTime = frameTime;

  const width = viewportWidth;
  const height = viewportHeight;
  generateAsteroids(width, height);
  updateHelpAttention(deltaTime);
  if (!gamePaused) {
    updateGame(deltaTime, width, height);
  }
  updateDebugOutput();
  drawGame(width, height);
  window.requestAnimationFrame(animate);
}

function controlKeyForEvent(event) {
  if (event.code === FIRE_KEY) {
    return FIRE_KEY;
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
  if (event.code === PAUSE_KEY && !event.repeat) {
    gamePaused = !gamePaused;
    resetHelpAttention();

    if (gamePaused) {
      // A pause freezes gameplay input as well as simulation time. Requiring a
      // fresh Space press after resuming avoids a held key firing unexpectedly.
      pressedKeys.clear();
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

    if (gamePaused) {
      return;
    }

    resetHelpAttention();
    if (controlKey === FIRE_KEY && !event.repeat) {
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
