const canvas = document.querySelector("#game-canvas");
// Every frame paints the full playfield black, so the drawing buffer never
// needs browser-page transparency. Asking for an opaque buffer avoids a
// full-canvas compositing pass that can make Safari miss display refreshes and
// fall back to a stable fraction of the screen rate (commonly 30 FPS).
const context = canvas.getContext("2d", { alpha: false });

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
// The canvas remains keyboard-focusable, but its native focus ring is a
// distracting one-pixel blue frame around the game arena.
canvas.style.outline = "none";
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
// This inertia is only the scale used to convert a collision's angular impulse
// into one immediate heading adjustment; the ship does not retain angular
// velocity or intrinsic angular momentum after the contact.
const STARSHIP_COLLISION_TURN_INERTIA =
  (STARSHIP_MASS * PLAYER_RADIUS ** 2) / 2;
// Collision turning is intentionally a subtle heading nudge rather than a
// physical spin replacement. The cap prevents a high-speed scrape from
// producing a chaotic turn-around in ordinary play.
const SHIP_COLLISION_TURN_RESPONSE = 0.2;
const MAX_SHIP_COLLISION_TURN_ANGLE = Math.PI / 12;
// Direct angular control keeps the ship responsive and independent from its
// one-time collision heading adjustments.
const ROTATION_SPEED = Math.PI * 2;
// Movement is deliberately expressed in CSS pixels per second so the game
// behaves the same at different device pixel ratios and display refresh rates.
const MAX_SPEED = 360;
// This is the rate at which the ship gains or loses speed while a throttle key
// is held. Keeping it global makes the handling easy to tune.
const MOVEMENT_RESPONSIVENESS = 480;

// The LCARS palette is shared by every presentation layer so the arena,
// objects, and overlays read as one interface rather than independent styles.
// Warm operational colors carry the strongest emphasis; lilac is reserved for
// shields and low-density material, while black keeps the playfield spacious.
const LCARS_BLACK = "#000000";
const LCARS_AMBER = "#ff9900";
const LCARS_GOLD = "#ffcc66";
const LCARS_CORAL = "#ff8866";
const LCARS_RED = "#cc6666";
const LCARS_LILAC = "#9999ff";
const LCARS_LAVENDER = "#cc99cc";
const LCARS_TEXT = "#fff4dd";
const LCARS_MUTED_TEXT = "#d6c5dc";
const LCARS_PANEL = "rgba(12, 8, 18, 0.92)";
// Antonio keeps the tall, narrow geometry associated with LCARS while offering
// enough weight variation for readable data and instructions. The local
// fallbacks preserve a condensed silhouette if the CDN font is unavailable.
const LCARS_FONT_FAMILY = 'Antonio, "Arial Narrow", "Aptos Narrow", sans-serif';
const LCARS_BODY_FONT_FAMILY = LCARS_FONT_FAMILY;
const LCARS_FRAME_MARGIN = 14;
const LCARS_CONSOLE_TOP = 10;
// This is the smallest fixed width that keeps “FLIGHT CONTROL” and its
// horizontal padding legible at the command-strip title size.
const LCARS_MODE_WIDTH = 164;
// The command strip turns the keyboard map into persistent LCARS controls.
// Compact gaps keep the keycaps grouped at the left, while their square-like
// width makes the keyboard map immediately recognizable.
const FLIGHT_CONTROL_GAP = 5;
const FLIGHT_CONTROL_KEY_WIDTH = 64;
const FLIGHT_CONTROL_TITLE_WEIGHT = 700;
const FLIGHT_CONTROL_DETAIL_WEIGHT = 500;
const FLIGHT_CONTROL_ACTIVE_INSET = 4;

// The shield and hull are intentionally separate gameplay states. Collision
// impulse is scaled into readable percentage points, while the different
// coefficients make the shield absorb slightly more of every impact than the
// unprotected hull would receive.
const SHIELD_MAX_STATE = 100;
const SHIP_MAX_STATE = 100;
const SHIELD_REGENERATION_RATE = 7.5;
const COLLISION_DAMAGE_SCALE = 1 / 7500;
const SHIELD_DAMAGE_COEFFICIENT = 1.1;
const SHIP_DAMAGE_COEFFICIENT = 1.0;
// Collision damage is stronger per impact, but a short contact burst shares
// one replenishing budget. A full budget represents the maximum damage that
// can pass through immediately; it refills completely over this interval, so
// a player can survive repeated solver contacts without making collisions
// harmless.
const COLLISION_DAMAGE_BUDGET_CAP = 34;
const COLLISION_DAMAGE_BUDGET_WINDOW_SECONDS = 0.45;
const COLLISION_DAMAGE_BUDGET_REFILL_RATE =
  COLLISION_DAMAGE_BUDGET_CAP / COLLISION_DAMAGE_BUDGET_WINDOW_SECONDS;
const STATUS_BAR_WIDTH = 220;
const STATUS_BAR_HEIGHT = 26;
const STATUS_BAR_GAP = 10;
const STATUS_BAR_MARGIN = LCARS_FRAME_MARGIN;
// The bars are presentation values that catch up to the authoritative state
// at a readable speed. Keeping this separate from damage simulation makes a
// large impact legible without changing when a collision actually resolves.
const STATUS_BAR_ANIMATION_SPEED = 190;
const STATUS_POINTS_WIDTH = 92;
const STATUS_POINTS_GAP = 6;
const STATUS_POINTS_HEIGHT = STATUS_BAR_HEIGHT * 2 + STATUS_BAR_GAP;
// The command-console band encloses its two-row controls with matching
// 10-pixel margins above and below.
const LCARS_CONSOLE_HEIGHT = LCARS_CONSOLE_TOP * 2 + STATUS_POINTS_HEIGHT;
// Hold the failure message long enough for a new player to connect the empty
// hull bar with the collision that ended the current life.
const SHIP_FAILURE_DISPLAY_SECONDS = 2.4;
const SHIP_FAILURE_PANEL_WIDTH = 560;
const SHIP_FAILURE_PANEL_HEIGHT = 286;
const SHIP_FAILURE_BACKDROP_ALPHA = 0.68;
const SHIP_FAILURE_REASON = "Hull depleted by a collision.";
// The win state is intentionally frozen so the player can read the result and
// see the final score before choosing to start another field.
const WIN_SCREEN_PANEL_WIDTH = 560;
const WIN_SCREEN_PANEL_HEIGHT = 300;
const WIN_SCREEN_BACKDROP_ALPHA = 0.58;
const WIN_SCREEN_TITLE = "YOU WIN";
const WIN_SCREEN_REASON = "All asteroids destroyed.";

// Bullets are intentionally fast and short-lived. The frequency is expressed
// in shots per second so holding Space feels regular at every frame rate.
const BULLET_FREQUENCY = 8;
const BULLET_FIRE_INTERVAL = 1 / BULLET_FREQUENCY;
// A bullet's mass is deliberately independent of its visual length. The
// collision response uses this value for both bullet momentum and bullet
// kinetic energy while the projectile remains an independent body.
const BULLET_MASS = 10;
const BULLET_SPEED = 720;
const BULLET_HALF_LENGTH = 10;
const BULLET_LINE_WIDTH = 3;
// Ricochets are deliberately finite: an active bullet can make a short chain
// of useful asteroid cuts without becoming an unbounded simulation object.
const MAX_BULLET_REFLECTIONS = 3;
const BULLET_COLLISION_OFFSET = 0.01;

// Autopilot is deliberately an input producer rather than a second gameplay
// implementation. It only contributes the same held controls a player can
// use, which keeps thrust, turning, firing, recoil, and collision handling on
// the normal gameplay paths.
const AUTOPILOT_TOGGLE_KEY = "KeyT";
const AUTOPILOT_TOGGLE_KEY_LABEL = "T";
const AUTOPILOT_AIM_TOLERANCE = Math.PI / 10;
const AUTOPILOT_MAX_LOOKAHEAD_SECONDS = 1.8;
const AUTOPILOT_BASE_SAFE_MARGIN = 80;
const AUTOPILOT_SHIELD_RECOVERY_MARGIN = 110;
const AUTOPILOT_HULL_DAMAGE_MARGIN = 140;
const AUTOPILOT_WALL_SAFE_MARGIN = 180;
const AUTOPILOT_THRUST_ALIGNMENT_TOLERANCE = Math.PI / 4;
const AUTOPILOT_FLEE_THRUST_SPEED = 110;
const AUTOPILOT_CRUISE_SPEED = 210;
const AUTOPILOT_ENDGAME_CRUISE_SPEED = 260;
const AUTOPILOT_MIN_COAST_SPEED = 70;
const AUTOPILOT_BRAKE_SPEED = 300;
const AUTOPILOT_LEAD_TIME_CAP = 0.9;
const AUTOPILOT_SHIELD_RECOVERY_THRESHOLD = 0.65;
const AUTOPILOT_CLOSE_TARGET_BRAKE_SPEED = 35;
const AUTOPILOT_FIRE_SPEED_LIMIT = 340;
const AUTOPILOT_POINT_BLANK_MARGIN = 100;
const AUTOPILOT_UPDATE_INTERVAL = 1 / 15;
const AUTOPILOT_BURST_SECONDS = 0.38;
const AUTOPILOT_BURST_COOLDOWN = 0.85;
const AUTOPILOT_TARGET_COMMITMENT_SECONDS = 0.9;
const AUTOPILOT_TARGET_RECHECK_SECONDS = 0.3;
const AUTOPILOT_TARGET_SWITCH_ADVANTAGE = 90;
const AUTOPILOT_FLOW_HEADING_SPEED = 80;
const AUTOPILOT_TURN_START_TOLERANCE = Math.PI / 14;
const AUTOPILOT_TURN_STOP_TOLERANCE = Math.PI / 36;
const AUTOPILOT_TURN_REVERSAL_DELAY = 0.35;

// Sparks turn dissipated kinetic energy into a readable, non-gameplay visual.
// One spark represents a fixed slice of energy so larger impacts create denser
// bursts while the cap keeps a single destruction event inexpensive to draw.
const SPARK_ENERGY_PER_PARTICLE = 150000;
const MAX_SPARKS_PER_INTERACTION = 64;
// Keep the visual queue bounded when several bodies collide in one frame.
// This cap affects only presentation; collision response and energy state
// continue to run for every body regardless of particle availability.
const MAX_ACTIVE_SPARKS = 360;
const SPARK_MIN_LIFETIME = 0.12;
const SPARK_MAX_LIFETIME = 0.24;
const SPARK_MIN_SPEED = 80;
const SPARK_MAX_SPEED = 125;
const SPARK_VELOCITY_DAMPING = 0.72;
// Narrow intensity bounds keep the burst coherent while preserving a little
// organic variation between individual sparks.
const SPARK_MIN_INTENSITY = 0.84;
const SPARK_MAX_INTENSITY = 1.0;
const SPARK_CORE_RADIUS = 3;
const SPARK_GLOW_RADIUS = 10;
const SPARK_GLOW_ALPHA = 0.18;
const SPARK_COLOR = LCARS_GOLD;
// Backquote is an uncommon gameplay key and is separate from the ship's
// letter-key controls, so it leaves D available for clockwise rotation.
const DEBUG_TOGGLE_KEY = "Backquote";
const PAUSE_KEY = "KeyP";
const PAUSE_KEY_LABEL = "P";
const FIRE_KEY = "Space";
const FIRE_KEY_LABEL = "SPACE";

// Keep the detailed paused-help controls in one compact table. The persistent
// command strip uses shorter LCARS action names suited to its button geometry.
const PLAY_HELP = Object.freeze([
  Object.freeze({
    label: FIRE_KEY_LABEL,
    description: "shoot",
  }),
  Object.freeze({
    label: "W / S",
    description: "thrust / brake",
  }),
  Object.freeze({
    label: "A / D",
    description: "turn counter-clockwise / clockwise",
  }),
  Object.freeze({
    label: PAUSE_KEY_LABEL,
    description: "pause / resume",
  }),
  Object.freeze({
    label: AUTOPILOT_TOGGLE_KEY_LABEL,
    description: "autopilot on / off",
  }),
  Object.freeze({
    label: "COLOR",
    description: "redder asteroids are denser",
  }),
]);
const HELP_PANEL_WIDTH = 540;
const HELP_PANEL_HEIGHT = 500;

// A faint two-line phrase brands the arena without participating in the game
// simulation. It is ordinary canvas text rendered as background decoration.
const PHRASE_LINES = Object.freeze(["KANE CLI", "HACKATHON"]);
const PHRASE_FONT_FAMILY = LCARS_FONT_FAMILY;
const PHRASE_FONT_WEIGHT = 700;
const PHRASE_BASE_FONT_SIZE = 100;
const PHRASE_LINE_GAP = 24;
const PHRASE_MARGIN = 48;
const PHRASE_OPACITY = 0.22;
const PAUSE_BACKDROP_ALPHA = 0.44;
// The arena boundary is a gameplay hazard, so its warm gradient and soft
// bloom should be visible without obscuring the ship or asteroid silhouettes.
const WALL_GLOW_THICKNESS = 14;
const WALL_GLOW_COLOR = "rgba(204, 102, 102, 0.88)";
const WALL_GLOW_FADE_COLOR = "rgba(204, 102, 102, 0)";
const ASTEROID_COUNT = 8;
const ASTEROID_MIN_RADIUS = 24;
const ASTEROID_MAX_RADIUS = 52;
const ASTEROID_MIN_VERTICES = 6;
const ASTEROID_MAX_VERTICES = 10;
const ASTEROID_MIN_SPEED = 70;
const ASTEROID_MAX_SPEED = 170;
const ASTEROID_MIN_ANGULAR_SPEED = -1.8;
const ASTEROID_MAX_ANGULAR_SPEED = 1.8;
// A grazing cut can produce a technically valid but visually meaningless
// sliver. Discarding fragments below this area keeps the asteroid population
// useful while leaving the cutoff easy to tune for the game's scale.
const ASTEROID_MIN_FRAGMENT_AREA = 500;
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
const ASTEROID_MIN_COLOR_HUE = 250;
const ASTEROID_MAX_COLOR_HUE = 8;
// A value of one is a fully elastic collision. At 0.9, an impact loses 19% of
// the kinetic energy in the contact-normal component while preserving tangent
// motion. The same coefficient is used for asteroid contacts and wall hits so
// the field stays lively through the middle and end of a run.
const BOUNCINESS = 0.9;
// A modest Coulomb friction coefficient lets a shoulder scrape exchange spin
// instead of making every contact behave like two frictionless billiard balls.
const FRICTION_COEFFICIENT = 0.35;
// The shield uses the same material model as asteroid contacts, but keeps a
// named coefficient so the wall response can be tuned independently later.
const SHIELD_WALL_FRICTION_COEFFICIENT = FRICTION_COEFFICIENT;
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
// Debug telemetry is deliberately human-paced. Rebuilding and laying out the
// large preformatted panel every animation frame can itself create a visible
// stutter while the panel is being used to inspect frame rate.
const DEBUG_REFRESH_INTERVAL = 0.1;

const pressedKeys = new Set();
const manualPressedKeys = new Set();
const autopilotPressedKeys = new Set();
const asteroids = [];
const bullets = [];
const sparks = [];
let playerAngle = -Math.PI / 2;
let playerVelocityX = 0;
let playerVelocityY = 0;
let playerX;
let playerY;
let shieldState = SHIELD_MAX_STATE;
let shipState = SHIP_MAX_STATE;
let displayedShieldState = SHIELD_MAX_STATE;
let displayedShipState = SHIP_MAX_STATE;
let restartRequested = false;
let shipFailureActive = false;
let shipFailureTimeRemaining = 0;
let gameWon = false;
let totalShipRestartCount = 0;
let lastCollisionMomentum = 0;
let lastShieldDamage = 0;
let lastShipDamage = 0;
let lastRawCollisionDamage = 0;
let lastAppliedCollisionDamage = 0;
let collisionDamageBudget = COLLISION_DAMAGE_BUDGET_CAP;
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
// Autopilot starts off for predictable player-first startup. Its state is
// retained across automatic life restarts so a long demonstration can keep
// playing after an allowed collision, while any gameplay key immediately
// turns it off.
let autopilotEnabled = false;
let autopilotShotCooldown = 0;
let autopilotBurstTimeRemaining = 0;
let autopilotBurstTarget;
let autopilotTargetLock;
let autopilotTargetLockTimeRemaining = 0;
let autopilotTurnDirection = 0;
let autopilotLastTurnDirection = 0;
let autopilotTurnReversalTimeRemaining = 0;
let autopilotDecisionTime = 0;
let autopilotManeuverMode = "coast";
let lastCollisionCount = 0;
let totalCollisionCount = 0;
let lastMomentumDelta = { x: 0, y: 0 };
let lastKineticEnergyDelta = 0;
let totalBulletCutCount = 0;
let totalBulletShipCollisionCount = 0;
// Points measure material that really leaves the playfield. A successful cut
// preserves area across its retained fragments, while fragments below the
// minimum area (and terminal asteroids) contribute the area that disappears.
let points = 0;
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
let totalSparksEmitted = 0;
let lastFrameSparkCount = 0;
let lastFrameSparkEnergy = 0;
let frameRate = 0;
let minimumFrameRate = Infinity;
const frameTimeSamples = new Float64Array(FPS_SAMPLE_COUNT);
let frameTimeSampleIndex = 0;
let frameTimeSampleCount = 0;
let frameTimeSampleTotal = 0;
let debugRefreshTimeRemaining = 0;
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
  `color:${LCARS_AMBER};background:${LCARS_PANEL};` +
  `font:13px/1.45 ${LCARS_BODY_FONT_FAMILY};letter-spacing:.25px;` +
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
  const angles = Array.from({ length: vertexCount }, () =>
    randomBetween(0, Math.PI * 2),
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
  const densityRatio =
    densityRange > 0
      ? Math.max(
          0,
          Math.min(1, (density - ASTEROID_MIN_DENSITY) / densityRange),
        )
      : 0.5;
  const hue =
    ASTEROID_MIN_COLOR_HUE +
    (ASTEROID_MAX_COLOR_HUE - ASTEROID_MIN_COLOR_HUE) * densityRatio;

  return `hsl(${hue} 72% 68%)`;
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
  }) {
    const sourceVertices =
      localVertices ??
      angles.map((angle) => ({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      }));
    const localCenter = polygonCentroid(sourceVertices);

    this.radius = Math.max(
      ...sourceVertices.map((vertex) =>
        Math.hypot(vertex.x - localCenter.x, vertex.y - localCenter.y),
      ),
    );
    this.localVertices = Object.freeze(
      sourceVertices.map((vertex) =>
        Object.freeze({
          x: vertex.x - localCenter.x,
          y: vertex.y - localCenter.y,
        }),
      ),
    );
    this.x = x;
    this.y = y;
    this.velocityX = velocityX;
    this.velocityY = velocityY;
    this.density = density;
    this.rotation = rotation;
    this.angularVelocity = angularVelocity;
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
    this.momentOfInertiaValue =
      this.surfaceAreaValue > COLLISION_EPSILON
        ? polygonMassMomentOfInertia(this.localVertices) *
          (this.massValue / this.surfaceAreaValue)
        : (this.massValue * this.radius ** 2) / 2;
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
    this.rotation = wrapAngle(this.rotation + this.angularVelocity * deltaTime);
    this.x += this.velocityX * deltaTime;
    this.y += this.velocityY * deltaTime;
    resolveAsteroidWallCollisions(this, width, height);
  }

  keepInside(width, height) {
    this.collisionPolygon();
    const bounds = this.worldBounds;
    const bodyWidth = bounds.maximumX - bounds.minimumX;
    const bodyHeight = bounds.maximumY - bounds.minimumY;

    this.x =
      bodyWidth >= width
        ? width / 2
        : this.x +
          (bounds.minimumX < 0
            ? -bounds.minimumX
            : bounds.maximumX > width
              ? width - bounds.maximumX
              : 0);
    this.y =
      bodyHeight >= height
        ? height / 2
        : this.y +
          (bounds.minimumY < 0
            ? -bounds.minimumY
            : bounds.maximumY > height
              ? height - bounds.maximumY
              : 0);
    this.collisionPolygon();
  }

  draw() {
    const vertices = this.collisionPolygon();
    const firstVertex = vertices[0];

    context.beginPath();
    context.moveTo(firstVertex.x, firstVertex.y);

    for (let vertexIndex = 1; vertexIndex < vertices.length; vertexIndex += 1) {
      const vertex = vertices[vertexIndex];
      context.lineTo(vertex.x, vertex.y);
    }

    context.closePath();
    const materialColor = asteroidColorForDensity(this.density);
    context.fillStyle = materialColor;
    context.fill();
    context.strokeStyle = LCARS_GOLD;
    context.globalAlpha = 0.72;
    context.lineWidth = 1.5;
    context.stroke();
    context.globalAlpha = 1;
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

  /**
   * Reflect from a wall and lose the normal component's dissipated energy.
   * @param {Vector2} normal Wall normal pointing along the incoming travel.
   * @param {number} [bounceCoefficient] Normal restitution coefficient.
   * @returns {void}
   */
  reflect(normal, bounceCoefficient = BOUNCINESS) {
    const normalVelocity =
      this.velocityX * normal.x + this.velocityY * normal.y;

    this.velocityX -= (1 + bounceCoefficient) * normalVelocity * normal.x;
    this.velocityY -= (1 + bounceCoefficient) * normalVelocity * normal.y;
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
    const gradient = context.createLinearGradient(startX, startY, endX, endY);

    // A symmetric gradient makes a bullet read as a luminous moving streak:
    // both ends fade to black while the midpoint carries the full brightness.
    gradient.addColorStop(0, "rgba(255, 153, 0, 0)");
    gradient.addColorStop(0.5, LCARS_GOLD);
    gradient.addColorStop(1, "rgba(255, 153, 0, 0)");

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
 * A short-lived visual particle emitted by a dissipative contact. Sparks have
 * no collision body and therefore cannot change gameplay state.
 */
class Spark {
  /**
   * @param {Vector2} origin Contact position where the spark begins.
   */
  constructor({ x, y }) {
    const direction = randomBetween(0, Math.PI * 2);
    const speed = randomBetween(SPARK_MIN_SPEED, SPARK_MAX_SPEED);

    this.x = x;
    this.y = y;
    this.velocityX = Math.cos(direction) * speed;
    this.velocityY = Math.sin(direction) * speed;
    this.lifetime = randomBetween(SPARK_MIN_LIFETIME, SPARK_MAX_LIFETIME);
    this.lifeRemaining = this.lifetime;
    this.intensity = randomBetween(SPARK_MIN_INTENSITY, SPARK_MAX_INTENSITY);
  }

  /**
   * Advance the particle and apply only presentation-level drag.
   * @param {number} deltaTime Elapsed real time in seconds.
   * @returns {void}
   */
  update(deltaTime) {
    if (!Number.isFinite(deltaTime)) {
      return;
    }

    const safeDeltaTime = Math.max(0, deltaTime);
    const damping = Math.exp(-SPARK_VELOCITY_DAMPING * safeDeltaTime);
    this.x += this.velocityX * safeDeltaTime;
    this.y += this.velocityY * safeDeltaTime;
    this.velocityX *= damping;
    this.velocityY *= damping;
    this.lifeRemaining -= safeDeltaTime;
  }

  /**
   * @returns {boolean} Whether the particle still has visible lifetime.
   */
  get isAlive() {
    return this.lifeRemaining > 0;
  }

  /**
   * Draw the particle as a small bright core with a soft additive glow.
   * @returns {void}
   */
  draw() {
    const lifeRatio = Math.max(0, this.lifeRemaining / this.lifetime);
    const alpha = this.intensity * lifeRatio ** 2;

    // The caller batches the canvas state for all particles. A translucent
    // outer disc provides a cheap additive glow without per-particle
    // save/restore or shadow-blur rasterization.
    context.globalAlpha = alpha * SPARK_GLOW_ALPHA;
    context.beginPath();
    context.arc(this.x, this.y, SPARK_GLOW_RADIUS, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = alpha;
    context.beginPath();
    context.arc(this.x, this.y, SPARK_CORE_RADIUS, 0, Math.PI * 2);
    context.fill();
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
  });
}

/**
 * Measure the phrase with the browser's actual font metrics. Canvas engines
 * do not agree on where `textBaseline = "top"` places Antonio's visible cap
 * height, so centering uses these bounds instead of nominal font pixels.
 * @param {number} fontSize Requested font size in CSS pixels.
 * @returns {{ ascent: number, lineHeight: number, widestLine: number }}
 */
function phraseTextMetrics(fontSize) {
  context.save();
  context.font = `${PHRASE_FONT_WEIGHT} ${fontSize}px ${PHRASE_FONT_FAMILY}`;
  const firstLineMetrics = context.measureText(PHRASE_LINES[0]);
  const widestLine = Math.max(
    ...PHRASE_LINES.map((phraseLine) => context.measureText(phraseLine).width),
  );
  context.restore();
  const ascent = Number.isFinite(firstLineMetrics.actualBoundingBoxAscent)
    ? firstLineMetrics.actualBoundingBoxAscent
    : fontSize;
  const descent = Number.isFinite(firstLineMetrics.actualBoundingBoxDescent)
    ? firstLineMetrics.actualBoundingBoxDescent
    : 0;

  return { ascent, lineHeight: Math.max(1, ascent + descent), widestLine };
}

/**
 * Choose one scale that keeps the background phrase inside the viewport.
 * @param {number} width Viewport width in CSS pixels.
 * @param {number} height Viewport height in CSS pixels.
 * @returns {number}
 */
function phraseFontSizeForViewport(width, height) {
  const availableWidth = Math.max(0, width - PHRASE_MARGIN * 2);
  const availableHeight = Math.max(0, height - PHRASE_MARGIN * 2);
  const baseMetrics = phraseTextMetrics(PHRASE_BASE_FONT_SIZE);
  const baseBlockHeight =
    baseMetrics.lineHeight * PHRASE_LINES.length +
    PHRASE_LINE_GAP * (PHRASE_LINES.length - 1);

  return Math.min(
    (PHRASE_BASE_FONT_SIZE * availableWidth) / baseMetrics.widestLine,
    (PHRASE_BASE_FONT_SIZE * availableHeight) / baseBlockHeight,
  );
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

  const finalTotalImpulseX = STARSHIP_MASS * playerVelocityX + bulletImpulseX;
  const finalTotalImpulseY = STARSHIP_MASS * playerVelocityY + bulletImpulseY;
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

/**
 * Advance and prune sparks independently from the gameplay simulation. This
 * lets an impact finish its visual fade while the player is reading a pause
 * or failure screen without giving the particles any gameplay influence.
 * @param {number} deltaTime Elapsed real time in seconds.
 * @returns {void}
 */
function updateSparks(deltaTime) {
  for (let sparkIndex = sparks.length - 1; sparkIndex >= 0; sparkIndex -= 1) {
    const spark = sparks[sparkIndex];
    spark.update(deltaTime);

    if (!spark.isAlive) {
      sparks.splice(sparkIndex, 1);
    }
  }
}

/**
 * Rebuild the effective held-key state from its two legitimate producers.
 * Keeping manual and autopilot keys separate lets a human input disable the
 * autopilot without allowing one producer to forge the other producer's
 * events. The gameplay loop still consumes only `pressedKeys`, as before.
 * @returns {void}
 */
function syncPressedKeys() {
  pressedKeys.clear();

  for (const key of manualPressedKeys) {
    pressedKeys.add(key);
  }

  for (const key of autopilotPressedKeys) {
    pressedKeys.add(key);
  }
}

/**
 * Clear both input sources. This is used for pause, focus loss, and life
 * transitions so no stale held key can survive a state boundary.
 * @returns {void}
 */
function clearPressedKeys() {
  manualPressedKeys.clear();
  autopilotPressedKeys.clear();
  pressedKeys.clear();
}

/**
 * Disable autopilot because a player supplied a gameplay input.
 * @returns {void}
 */
function disableAutopilotForManualInput() {
  if (!autopilotEnabled) {
    return;
  }

  autopilotEnabled = false;
  autopilotPressedKeys.clear();
  autopilotBurstTimeRemaining = 0;
  autopilotBurstTarget = undefined;
  autopilotTurnDirection = 0;
  autopilotLastTurnDirection = 0;
  autopilotTurnReversalTimeRemaining = 0;
  syncPressedKeys();
}

/**
 * Toggle autopilot and reset the input edge state. T itself is a mode
 * control, not one of the simulated gameplay inputs, so it is never added to
 * either held-key set.
 * @returns {void}
 */
function toggleAutopilot() {
  autopilotEnabled = !autopilotEnabled;
  autopilotShotCooldown = 0;
  autopilotBurstTimeRemaining = 0;
  autopilotBurstTarget = undefined;
  autopilotTargetLock = undefined;
  autopilotTargetLockTimeRemaining = 0;
  autopilotTurnDirection = 0;
  autopilotLastTurnDirection = 0;
  autopilotTurnReversalTimeRemaining = 0;
  autopilotDecisionTime = autopilotEnabled ? AUTOPILOT_UPDATE_INTERVAL : 0;
  autopilotManeuverMode = "coast";
  clearPressedKeys();
}

/**
 * Supply the autopilot's current held controls through the same set consumed
 * by normal movement and firing. No ship, asteroid, health, or bullet state
 * is changed here.
 * @param {Iterable<string>} keys W/A/S/D/Space controls to hold.
 * @returns {void}
 */
function setAutopilotInput(keys) {
  autopilotPressedKeys.clear();

  if (autopilotEnabled && !shipFailureActive && !gameWon) {
    for (const key of keys) {
      autopilotPressedKeys.add(key);
    }
  }

  syncPressedKeys();
}

/**
 * Return the signed shortest turn from the current angle to a desired angle.
 * Positive values correspond to the existing clockwise D input.
 * @param {number} desiredAngle
 * @param {number} currentAngle
 * @returns {number}
 */
function shortestAngleDifference(desiredAngle, currentAngle) {
  const fullTurn = Math.PI * 2;
  return (
    ((((desiredAngle - currentAngle + Math.PI) % fullTurn) + fullTurn) %
      fullTurn) -
    Math.PI
  );
}

/**
 * Convert current shield and hull state into extra avoidance distance. A full
 * shield is intentionally treated as a renewable buffer: only shield below
 * the recovery threshold adds caution, while hull damage always adds caution.
 * @returns {number} Additional safe distance in CSS pixels.
 */
function autopilotHealthSafetyMargin() {
  const shieldRatio = Math.max(0, Math.min(1, shieldState / SHIELD_MAX_STATE));
  const hullRatio = Math.max(0, Math.min(1, shipState / SHIP_MAX_STATE));
  const shieldRecoveryRatio = Math.max(
    0,
    (AUTOPILOT_SHIELD_RECOVERY_THRESHOLD - shieldRatio) /
      AUTOPILOT_SHIELD_RECOVERY_THRESHOLD,
  );
  const hullDamageRatio = 1 - hullRatio;

  return (
    shieldRecoveryRatio * AUTOPILOT_SHIELD_RECOVERY_MARGIN +
    hullDamageRatio * AUTOPILOT_HULL_DAMAGE_MARGIN
  );
}

/**
 * Apply hysteresis and a reversal delay to the autopilot's A/D choice. The
 * ship may stop turning as soon as it is aligned, but it cannot immediately
 * reverse direction. This avoids both CW/CCW chatter and the overshoot caused
 * by forcing a fast-turning ship to hold a key for a minimum duration.
 * @param {Set<string>} input Held controls for the current frame.
 * @param {number} desiredAngle Heading selected by the current policy.
 * @param {number} deltaTime Seconds since the previous simulation step.
 * @returns {void}
 */
function applyAutopilotTurnInput(input, desiredAngle, deltaTime) {
  const angleDifference = shortestAngleDifference(desiredAngle, playerAngle);
  autopilotTurnReversalTimeRemaining = Math.max(
    0,
    autopilotTurnReversalTimeRemaining - Math.max(0, deltaTime),
  );
  let requestedDirection = 0;

  if (Math.abs(angleDifference) > AUTOPILOT_TURN_START_TOLERANCE) {
    requestedDirection = Math.sign(angleDifference);
  } else if (
    Math.abs(angleDifference) > AUTOPILOT_TURN_STOP_TOLERANCE &&
    Math.sign(angleDifference) === autopilotTurnDirection
  ) {
    requestedDirection = autopilotTurnDirection;
  }

  const reversesCommittedTurn =
    requestedDirection !== 0 &&
    autopilotLastTurnDirection !== 0 &&
    requestedDirection !== autopilotLastTurnDirection;

  if (reversesCommittedTurn && autopilotTurnReversalTimeRemaining > 0) {
    autopilotTurnDirection = 0;
  } else {
    autopilotTurnDirection = requestedDirection;

    if (reversesCommittedTurn || autopilotLastTurnDirection === 0) {
      autopilotLastTurnDirection = requestedDirection;
      autopilotTurnReversalTimeRemaining = AUTOPILOT_TURN_REVERSAL_DELAY;
    }
  }

  if (autopilotTurnDirection > 0) {
    input.add("KeyD");
  } else if (autopilotTurnDirection < 0) {
    input.add("KeyA");
  }
}

/**
 * Score a navigation target by how naturally it fits the ship's current
 * momentum. Distance still matters, but a target ahead of the velocity vector
 * is preferable to one that requires a hard reversal.
 * @param {Asteroid} asteroid Candidate read from the world.
 * @returns {number} Lower scores are easier fly-by engagements.
 */
function autopilotTargetScore(asteroid) {
  const offsetX = asteroid.x - playerX;
  const offsetY = asteroid.y - playerY;
  const distance = Math.hypot(offsetX, offsetY);
  const targetAngle = Math.atan2(offsetY, offsetX);
  const speed = Math.hypot(playerVelocityX, playerVelocityY);
  const flowAngle =
    speed >= AUTOPILOT_FLOW_HEADING_SPEED
      ? Math.atan2(playerVelocityY, playerVelocityX)
      : playerAngle;
  const flowTurn = Math.abs(shortestAngleDifference(targetAngle, flowAngle));
  const noseTurn = Math.abs(shortestAngleDifference(targetAngle, playerAngle));

  return distance + flowTurn * 180 + noseTurn * 70 - asteroid.radius * 1.5;
}

/**
 * Pick a convenient navigation target with a short commitment and switching
 * hysteresis. A target far behind the ship's momentum may be released early;
 * this lets a fly-by continue naturally instead of forcing an ugly reversal.
 * @param {number} deltaTime Seconds since the previous autopilot decision.
 * @returns {Asteroid | undefined}
 */
function autopilotTarget(deltaTime) {
  autopilotTargetLockTimeRemaining = Math.max(
    0,
    autopilotTargetLockTimeRemaining - Math.max(0, deltaTime),
  );
  const lockedTargetIsPresent =
    autopilotTargetLock !== undefined &&
    asteroids.includes(autopilotTargetLock);
  const isEndgame = asteroids.length <= 2;
  const speed = Math.hypot(playerVelocityX, playerVelocityY);
  const flowAngle =
    speed >= AUTOPILOT_FLOW_HEADING_SPEED
      ? Math.atan2(playerVelocityY, playerVelocityX)
      : playerAngle;
  const lockedTargetAngle = lockedTargetIsPresent
    ? Math.atan2(
        autopilotTargetLock.y - playerY,
        autopilotTargetLock.x - playerX,
      )
    : flowAngle;
  const lockedTargetIsBehind =
    lockedTargetIsPresent &&
    speed >= AUTOPILOT_FLOW_HEADING_SPEED &&
    Math.abs(shortestAngleDifference(lockedTargetAngle, flowAngle)) >
      (Math.PI * 2) / 3;

  if (
    lockedTargetIsPresent &&
    (isEndgame ||
      (autopilotTargetLockTimeRemaining > 0 && !lockedTargetIsBehind))
  ) {
    return autopilotTargetLock;
  }

  let selectedAsteroid;
  let selectedScore = Infinity;

  for (const asteroid of asteroids) {
    const score = autopilotTargetScore(asteroid);

    if (score < selectedScore) {
      selectedAsteroid = asteroid;
      selectedScore = score;
    }
  }

  if (lockedTargetIsPresent && !lockedTargetIsBehind) {
    const lockedScore = autopilotTargetScore(autopilotTargetLock);

    if (lockedScore <= selectedScore + AUTOPILOT_TARGET_SWITCH_ADVANTAGE) {
      autopilotTargetLockTimeRemaining = AUTOPILOT_TARGET_RECHECK_SECONDS;
      return autopilotTargetLock;
    }
  }

  autopilotTargetLock = selectedAsteroid;
  autopilotTargetLockTimeRemaining = AUTOPILOT_TARGET_COMMITMENT_SECONDS;
  return autopilotTargetLock;
}

/**
 * Find any asteroid already crossing the firing cone. This target is separate
 * from navigation, allowing opportunistic fly-by bursts without steering the
 * ship away from its momentum-friendly course.
 * @returns {Asteroid | undefined}
 */
function autopilotFiringTarget() {
  let selectedAsteroid;
  let selectedScore = Infinity;

  for (const asteroid of asteroids) {
    const distance = Math.hypot(asteroid.x - playerX, asteroid.y - playerY);
    const leadTime =
      distance <= PLAYER_RADIUS + asteroid.radius + AUTOPILOT_POINT_BLANK_MARGIN
        ? 0
        : Math.min(AUTOPILOT_LEAD_TIME_CAP, distance / BULLET_SPEED);
    const aimAngle = Math.atan2(
      asteroid.y + asteroid.velocityY * leadTime - playerY,
      asteroid.x + asteroid.velocityX * leadTime - playerX,
    );
    const angularRadius = Math.asin(
      Math.min(1, asteroid.radius / Math.max(distance, asteroid.radius)),
    );
    const aimError = Math.abs(shortestAngleDifference(aimAngle, playerAngle));
    const tolerance = Math.max(AUTOPILOT_AIM_TOLERANCE, angularRadius * 0.8);

    if (aimError > tolerance) {
      continue;
    }

    const score = aimError * 400 + distance - asteroid.radius * 2;

    if (score < selectedScore) {
      selectedAsteroid = asteroid;
      selectedScore = score;
    }
  }

  return selectedAsteroid;
}

/**
 * Find an asteroid whose predicted closest approach is uncomfortably near.
 * Relative linear motion is enough for a useful warning between frames; the
 * collision solver remains the authority when bodies actually touch.
 * @returns {{ asteroid: Asteroid, futureX: number, futureY: number,
 *   distance: number, closingSpeed: number } | undefined}
 */
function autopilotThreat() {
  const safeMargin = AUTOPILOT_BASE_SAFE_MARGIN + autopilotHealthSafetyMargin();
  let selectedThreat;
  let selectedScore = Infinity;

  for (const asteroid of asteroids) {
    const relativeX = asteroid.x - playerX;
    const relativeY = asteroid.y - playerY;
    const relativeVelocityX = asteroid.velocityX - playerVelocityX;
    const relativeVelocityY = asteroid.velocityY - playerVelocityY;
    const distance = Math.hypot(relativeX, relativeY);
    const safeDistance = PLAYER_RADIUS + asteroid.radius + safeMargin;
    const velocitySquared = relativeVelocityX ** 2 + relativeVelocityY ** 2;
    const closestTime =
      velocitySquared > COLLISION_EPSILON
        ? Math.max(
            0,
            Math.min(
              AUTOPILOT_MAX_LOOKAHEAD_SECONDS,
              -(relativeX * relativeVelocityX + relativeY * relativeVelocityY) /
                velocitySquared,
            ),
          )
        : 0;
    const futureX = relativeX + relativeVelocityX * closestTime;
    const futureY = relativeY + relativeVelocityY * closestTime;
    const futureDistance = Math.hypot(futureX, futureY);
    const closingSpeed =
      distance > COLLISION_EPSILON
        ? -(relativeX * relativeVelocityX + relativeY * relativeVelocityY) /
          distance
        : 0;
    const isNearNow = distance <= safeDistance;
    const isPredictedNear =
      closingSpeed > 0 &&
      futureDistance <= safeDistance &&
      closestTime <= AUTOPILOT_MAX_LOOKAHEAD_SECONDS;

    if (!isNearNow && !isPredictedNear) {
      continue;
    }

    const score = futureDistance + closestTime * 80 + asteroid.radius;

    if (score < selectedScore) {
      selectedThreat = {
        asteroid,
        futureX: playerX + futureX,
        futureY: playerY + futureY,
        distance,
        closingSpeed,
      };
      selectedScore = score;
    }
  }

  return selectedThreat;
}

/**
 * Find a nearby arena edge and return the inward direction. Wall damage is
 * resolved by the normal physics path, so the safest intervention available
 * to autopilot is an early turn and a braking/thrust input before the ship
 * reaches the boundary.
 * @param {number} width Viewport width in CSS pixels.
 * @param {number} height Viewport height in CSS pixels.
 * @returns {{ desiredAngle: number, distance: number,
 *   movingOutward: boolean } | undefined}
 */
function autopilotWallThreat(width, height) {
  const safeMargin = AUTOPILOT_WALL_SAFE_MARGIN + autopilotHealthSafetyMargin();
  const edgeDistances = [
    { distance: playerX, inwardX: 1, inwardY: 0 },
    { distance: width - playerX, inwardX: -1, inwardY: 0 },
    { distance: playerY, inwardX: 0, inwardY: 1 },
    { distance: height - playerY, inwardX: 0, inwardY: -1 },
  ];
  const nearestEdge = edgeDistances.reduce((closestEdge, edge) =>
    edge.distance < closestEdge.distance ? edge : closestEdge,
  );

  if (nearestEdge.distance > safeMargin) {
    return undefined;
  }

  const velocityInward =
    playerVelocityX * nearestEdge.inwardX +
    playerVelocityY * nearestEdge.inwardY;

  return {
    desiredAngle: Math.atan2(nearestEdge.inwardY, nearestEdge.inwardX),
    distance: nearestEdge.distance,
    movingOutward: velocityInward < -AUTOPILOT_FLEE_THRUST_SPEED,
  };
}

/**
 * Choose only held W/A/S/D/Space input for the current frame. A committed
 * attack pass keeps the nose on the locked target for useful shooting, then a
 * committed breakaway creates another dynamic pass instead of settling into
 * a stationary firing solution. Walls and unrelated collision threats still
 * preempt either maneuver. Health widens the avoidance margin without
 * bypassing the ordinary collision, recoil, or firing systems.
 * @param {number} deltaTime Elapsed simulation time in seconds.
 * @param {number} width Viewport width in CSS pixels.
 * @param {number} height Viewport height in CSS pixels.
 * @returns {void}
 */
function updateAutopilotInput(deltaTime, width, height) {
  if (!autopilotEnabled || gamePaused || shipFailureActive || gameWon) {
    autopilotDecisionTime = 0;
    setAutopilotInput([]);
    return;
  }

  autopilotDecisionTime += Math.max(0, deltaTime);

  if (autopilotDecisionTime < AUTOPILOT_UPDATE_INTERVAL) {
    return;
  }

  const decisionDeltaTime = autopilotDecisionTime;
  autopilotDecisionTime = 0;
  autopilotShotCooldown = Math.max(
    0,
    autopilotShotCooldown - decisionDeltaTime,
  );
  autopilotBurstTimeRemaining = Math.max(
    0,
    autopilotBurstTimeRemaining - decisionDeltaTime,
  );
  const input = new Set();
  const wallThreat = autopilotWallThreat(width, height);
  const threat = wallThreat === undefined ? autopilotThreat() : undefined;
  const target = autopilotTarget(decisionDeltaTime);
  const targetDistance =
    target === undefined
      ? Infinity
      : Math.hypot(target.x - playerX, target.y - playerY);
  const targetCollisionDistance =
    target === undefined ? Infinity : PLAYER_RADIUS + target.radius;
  const pointBlankDistance =
    targetCollisionDistance + AUTOPILOT_POINT_BLANK_MARGIN;
  const targetIsPointBlank =
    target !== undefined && targetDistance <= pointBlankDistance;
  const targetLeadTime = targetIsPointBlank
    ? 0
    : Math.min(AUTOPILOT_LEAD_TIME_CAP, targetDistance / BULLET_SPEED);
  const targetAimAngle =
    target === undefined
      ? playerAngle
      : Math.atan2(
          target.y + target.velocityY * targetLeadTime - playerY,
          target.x + target.velocityX * targetLeadTime - playerX,
        );
  let desiredAngle = playerAngle;
  const targetRelativeVelocityX =
    target === undefined ? 0 : target.velocityX - playerVelocityX;
  const targetRelativeVelocityY =
    target === undefined ? 0 : target.velocityY - playerVelocityY;
  const targetClosingSpeed =
    target === undefined || targetDistance <= COLLISION_EPSILON
      ? 0
      : -(
          (target.x - playerX) * targetRelativeVelocityX +
          (target.y - playerY) * targetRelativeVelocityY
        ) / targetDistance;
  const targetIsEmergency =
    target !== undefined &&
    targetDistance <= targetCollisionDistance + AUTOPILOT_BASE_SAFE_MARGIN &&
    targetClosingSpeed > AUTOPILOT_CLOSE_TARGET_BRAKE_SPEED;
  const threatIsTarget = threat !== undefined && threat.asteroid === target;

  if (wallThreat !== undefined) {
    autopilotManeuverMode = "wall evade";
    desiredAngle = wallThreat.desiredAngle;
    const speed = Math.hypot(playerVelocityX, playerVelocityY);
    const wallAngleDifference = shortestAngleDifference(
      desiredAngle,
      playerAngle,
    );

    if (
      (wallThreat.movingOutward && speed > AUTOPILOT_MIN_COAST_SPEED) ||
      speed > AUTOPILOT_BRAKE_SPEED
    ) {
      input.add("KeyS");
    } else if (
      Math.abs(wallAngleDifference) <= AUTOPILOT_THRUST_ALIGNMENT_TOLERANCE
    ) {
      input.add("KeyW");
    }
  } else if (threat !== undefined && (!threatIsTarget || targetIsEmergency)) {
    autopilotManeuverMode = "asteroid evade";
    const escapeX = playerX - threat.futureX;
    const escapeY = playerY - threat.futureY;
    const escapeLength = Math.hypot(escapeX, escapeY);
    desiredAngle =
      escapeLength > COLLISION_EPSILON
        ? Math.atan2(escapeY, escapeX)
        : Math.atan2(-playerVelocityY, -playerVelocityX);

    const escapeDirectionX = Math.cos(desiredAngle);
    const escapeDirectionY = Math.sin(desiredAngle);
    const velocityAwayFromThreat =
      playerVelocityX * escapeDirectionX + playerVelocityY * escapeDirectionY;
    const escapeAngleDifference = shortestAngleDifference(
      desiredAngle,
      playerAngle,
    );

    if (
      velocityAwayFromThreat < -AUTOPILOT_FLEE_THRUST_SPEED ||
      (threat.closingSpeed > AUTOPILOT_BRAKE_SPEED &&
        threat.distance < AUTOPILOT_BASE_SAFE_MARGIN * 2)
    ) {
      if (
        Math.hypot(playerVelocityX, playerVelocityY) > AUTOPILOT_MIN_COAST_SPEED
      ) {
        input.add("KeyS");
      }
    } else if (
      velocityAwayFromThreat < AUTOPILOT_CRUISE_SPEED &&
      Math.abs(escapeAngleDifference) <= AUTOPILOT_THRUST_ALIGNMENT_TOLERANCE
    ) {
      input.add("KeyW");
    }
  } else if (target !== undefined) {
    autopilotManeuverMode = "fly-by";
    desiredAngle = targetAimAngle;
    const speed = Math.hypot(playerVelocityX, playerVelocityY);
    const aimAngleDifference = shortestAngleDifference(
      desiredAngle,
      playerAngle,
    );
    const velocityTowardTarget =
      playerVelocityX * Math.cos(desiredAngle) +
      playerVelocityY * Math.sin(desiredAngle);
    const desiredCruiseSpeed =
      asteroids.length <= 2
        ? AUTOPILOT_ENDGAME_CRUISE_SPEED
        : AUTOPILOT_CRUISE_SPEED;

    if (
      targetIsPointBlank &&
      targetClosingSpeed > AUTOPILOT_CLOSE_TARGET_BRAKE_SPEED &&
      speed > AUTOPILOT_MIN_COAST_SPEED
    ) {
      // Braking does not alter facing, so a close approach remains a firing
      // opportunity while speed is removed before it becomes a ram.
      input.add("KeyS");
    } else if (
      targetDistance >
        targetCollisionDistance + AUTOPILOT_POINT_BLANK_MARGIN * 0.6 &&
      velocityTowardTarget < desiredCruiseSpeed &&
      Math.abs(aimAngleDifference) <= AUTOPILOT_THRUST_ALIGNMENT_TOLERANCE
    ) {
      input.add("KeyW");
    }
  } else {
    autopilotManeuverMode = "coast";
  }

  applyAutopilotTurnInput(input, desiredAngle, decisionDeltaTime);

  const speed = Math.hypot(playerVelocityX, playerVelocityY);
  const burstTargetIsPresent =
    autopilotBurstTarget !== undefined &&
    asteroids.includes(autopilotBurstTarget);

  if (!burstTargetIsPresent) {
    autopilotBurstTarget = undefined;
    autopilotBurstTimeRemaining = 0;
  }

  if (
    autopilotBurstTimeRemaining <= 0 &&
    autopilotShotCooldown <= 0 &&
    wallThreat === undefined
  ) {
    const firingTarget = autopilotFiringTarget();
    const firingDistance =
      firingTarget === undefined
        ? Infinity
        : Math.hypot(firingTarget.x - playerX, firingTarget.y - playerY);
    const firingTargetIsPointBlank =
      firingTarget !== undefined &&
      firingDistance <=
        PLAYER_RADIUS + firingTarget.radius + AUTOPILOT_POINT_BLANK_MARGIN;

    if (
      firingTarget !== undefined &&
      (firingTargetIsPointBlank || speed <= AUTOPILOT_FIRE_SPEED_LIMIT)
    ) {
      autopilotBurstTarget = firingTarget;
      autopilotBurstTimeRemaining = AUTOPILOT_BURST_SECONDS;
      autopilotShotCooldown = AUTOPILOT_BURST_COOLDOWN;
    }
  }

  if (
    autopilotBurstTimeRemaining > 0 &&
    autopilotBurstTarget !== undefined &&
    wallThreat === undefined
  ) {
    input.add(FIRE_KEY);
  }

  setAutopilotInput(input);
}

function updateBulletFiring(deltaTime) {
  // Keep firing paused even if the key was held before the game was paused.
  // The simulation normally skips this function while paused, but this guard
  // keeps the firing rule local and prevents future callers from bypassing it.
  if (gamePaused || shipFailureActive || !pressedKeys.has(FIRE_KEY)) {
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
  const gameplayHeight = gameplayHeightForViewport(height);

  viewportWidth = width;
  viewportHeight = height;

  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  if (playerX === undefined || playerY === undefined) {
    playerX = width / 2;
    playerY = gameplayHeight / 2;
  } else {
    playerX = constrainPosition(playerX, PLAYER_RADIUS, width);
    playerY = constrainPosition(playerY, PLAYER_RADIUS, gameplayHeight);
  }

  generateAsteroids(width, gameplayHeight);

  for (const asteroid of asteroids) {
    asteroid.keepInside(width, gameplayHeight);
  }

  drawGame(width, height);
}

/**
 * Reserve the fixed command-console band outside the physical simulation.
 * @param {number} viewportHeight Full canvas height in CSS pixels.
 * @returns {number} Height available to gameplay and wall collisions.
 */
function gameplayHeightForViewport(viewportHeight) {
  return Math.max(0, viewportHeight - LCARS_CONSOLE_HEIGHT);
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
 * Refill the collision damage budget while the game is simulating. Pausing
 * therefore freezes both contacts and their protection window together.
 * @param {number} deltaTime Elapsed simulation time in seconds.
 * @returns {void}
 */
function refillCollisionDamageBudget(deltaTime) {
  if (!Number.isFinite(deltaTime)) {
    return;
  }

  collisionDamageBudget = Math.min(
    COLLISION_DAMAGE_BUDGET_CAP,
    collisionDamageBudget +
      Math.max(0, deltaTime) * COLLISION_DAMAGE_BUDGET_REFILL_RATE,
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
  const rawImpactDamage = safeCollisionMomentum * COLLISION_DAMAGE_SCALE;
  const impactDamage = Math.min(rawImpactDamage, collisionDamageBudget);
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
  collisionDamageBudget = Math.max(0, collisionDamageBudget - impactDamage);
  lastCollisionMomentum = safeCollisionMomentum;
  lastRawCollisionDamage = rawImpactDamage;
  lastAppliedCollisionDamage = impactDamage;
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
  playerX = width / 2;
  playerY = height / 2;
  playerAngle = 0;
  playerVelocityX = 0;
  playerVelocityY = 0;
  shieldState = SHIELD_MAX_STATE;
  shipState = SHIP_MAX_STATE;
  displayedShieldState = SHIELD_MAX_STATE;
  displayedShipState = SHIP_MAX_STATE;
  collisionDamageBudget = COLLISION_DAMAGE_BUDGET_CAP;
  restartRequested = false;
  shipFailureActive = false;
  shipFailureTimeRemaining = 0;
  gameWon = false;
  totalShipRestartCount += 1;
  bulletCooldown = 0;
  bullets.length = 0;
  sparks.length = 0;
  clearPressedKeys();
  autopilotShotCooldown = 0;
  autopilotBurstTimeRemaining = 0;
  autopilotBurstTarget = undefined;
  autopilotTargetLock = undefined;
  autopilotTargetLockTimeRemaining = 0;
  autopilotTurnDirection = 0;
  autopilotLastTurnDirection = 0;
  autopilotTurnReversalTimeRemaining = 0;
  autopilotDecisionTime = autopilotEnabled ? AUTOPILOT_UPDATE_INTERVAL : 0;
  autopilotManeuverMode = "coast";
  asteroids.length = 0;
  asteroidsGenerated = false;
  generateAsteroids(width, height);
}

/**
 * Start the short frozen state shown after the hull reaches zero. The render
 * loop remains alive so the animated bars and the explanation stay visible.
 * @returns {void}
 */
function beginShipFailure() {
  if (shipFailureActive) {
    return;
  }

  shipFailureActive = true;
  shipFailureTimeRemaining = SHIP_FAILURE_DISPLAY_SECONDS;
  restartRequested = false;
  clearPressedKeys();
  bulletCooldown = 0;
}

/**
 * Freeze the completed field and show the final score until the player starts
 * another game. Keeping this separate from pause makes the win screen a real
 * terminal gameplay state rather than a paused empty arena.
 * @returns {void}
 */
function beginWin() {
  if (gameWon || shipFailureActive || asteroids.length > 0) {
    return;
  }

  gameWon = true;
  gamePaused = true;
  for (const bullet of bullets) {
    emitSparksAt({ x: bullet.x, y: bullet.y }, bodyKineticEnergy(bullet));
  }
  bullets.length = 0;
  clearPressedKeys();
  bulletCooldown = 0;
}

/**
 * Count down the failure message and start the next life when it has been
 * readable for the configured display interval.
 * @param {number} deltaTime Elapsed real time in seconds.
 * @param {number} width Viewport width in CSS pixels.
 * @param {number} height Viewport height in CSS pixels.
 * @returns {void}
 */
function updateShipFailure(deltaTime, width, height) {
  if (!shipFailureActive || !Number.isFinite(deltaTime)) {
    return;
  }

  shipFailureTimeRemaining = Math.max(
    0,
    shipFailureTimeRemaining - Math.max(0, deltaTime),
  );

  if (shipFailureTimeRemaining <= 0) {
    restartGame(width, height);
  }
}

/**
 * Add the area removed when a cut replaces one asteroid with its retained
 * fragments. Keeping this calculation at the replacement boundary makes the
 * score follow both the minimum-fragment rule and the terminal-asteroid rule.
 * @param {Asteroid} asteroid Asteroid removed by the cut.
 * @param {Asteroid[]} fragments Fragments that remain after the area cutoff.
 * @returns {void}
 */
function countVanishedAsteroidArea(asteroid, fragments) {
  const retainedArea = fragments.reduce(
    (area, fragment) => area + fragment.surfaceArea,
    0,
  );
  const vanishedArea = Math.max(0, asteroid.surfaceArea - retainedArea);

  points += vanishedArea;
}

/**
 * Render the score beside the health bars, with a stacked fallback for narrow
 * viewports where a horizontal score block would overlap the canvas edge.
 * @param {number} rightX Right edge of the score block in CSS pixels.
 * @param {number} topY Top of the score block in CSS pixels.
 * @returns {void}
 */
function drawPoints(rightX, topY) {
  const blockLeft = rightX - STATUS_POINTS_WIDTH;

  context.save();
  context.beginPath();
  context.roundRect(
    blockLeft,
    topY,
    STATUS_POINTS_WIDTH,
    STATUS_POINTS_HEIGHT,
    [STATUS_POINTS_HEIGHT / 2, 3, 3, STATUS_POINTS_HEIGHT / 2],
  );
  context.fillStyle = LCARS_AMBER;
  context.fill();
  context.textAlign = "right";
  context.textBaseline = "middle";
  context.fillStyle = LCARS_BLACK;
  context.font = `700 11px ${LCARS_BODY_FONT_FAMILY}`;
  context.fillText("SCORE", rightX - 10, topY + 13);
  context.font = `700 22px ${LCARS_BODY_FONT_FAMILY}`;
  context.fillText(Math.round(points).toString(), rightX - 10, topY + 39);
  context.restore();
}

/**
 * Move one displayed bar value toward its authoritative target.
 * @param {number} currentValue Current displayed percentage.
 * @param {number} targetValue Authoritative percentage.
 * @param {number} maximumChange Maximum movement this frame.
 * @returns {number}
 */
function moveBarValueToward(currentValue, targetValue, maximumChange) {
  if (!Number.isFinite(targetValue)) {
    return currentValue;
  }

  const distance = targetValue - currentValue;

  return Math.abs(distance) <= maximumChange
    ? targetValue
    : currentValue + Math.sign(distance) * maximumChange;
}

/**
 * Animate both status bars toward their real gameplay values.
 * @param {number} deltaTime Elapsed real time in seconds.
 * @returns {void}
 */
function updateDisplayedStatusBars(deltaTime) {
  if (!Number.isFinite(deltaTime)) {
    return;
  }

  const maximumChange = STATUS_BAR_ANIMATION_SPEED * Math.max(0, deltaTime);
  displayedShieldState = moveBarValueToward(
    displayedShieldState,
    shieldState,
    maximumChange,
  );
  displayedShipState = moveBarValueToward(
    displayedShipState,
    shipState,
    maximumChange,
  );
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
  const pointsFitsBesideBars =
    barX - STATUS_BAR_MARGIN >= STATUS_POINTS_WIDTH + STATUS_POINTS_GAP;
  const barTop = pointsFitsBesideBars
    ? LCARS_CONSOLE_TOP
    : LCARS_CONSOLE_TOP + STATUS_POINTS_HEIGHT + STATUS_BAR_GAP;

  drawPoints(
    pointsFitsBesideBars ? barX - STATUS_POINTS_GAP : width - STATUS_BAR_MARGIN,
    pointsFitsBesideBars ? LCARS_CONSOLE_TOP : LCARS_CONSOLE_TOP / 2,
  );

  const bars = [
    { label: "SHIELD", state: displayedShieldState, color: LCARS_LILAC },
    { label: "HULL", state: displayedShipState, color: LCARS_CORAL },
  ];

  context.save();
  context.font = `700 13px ${LCARS_BODY_FONT_FAMILY}`;
  context.textBaseline = "middle";

  for (let barIndex = 0; barIndex < bars.length; barIndex += 1) {
    const bar = bars[barIndex];
    const barY = barTop + barIndex * (STATUS_BAR_HEIGHT + STATUS_BAR_GAP);
    const fillWidth = barWidth * (bar.state / SHIELD_MAX_STATE);

    context.beginPath();
    context.roundRect(barX, barY, barWidth, STATUS_BAR_HEIGHT, 11);
    // A quiet tinted track keeps the indicator in the same filled, borderless
    // LCARS vocabulary as the command strip; the previous outlined lettering
    // read like a legacy widget beside the solid controls.
    context.fillStyle = bar.color;
    context.globalAlpha = 0.35;
    context.fill();
    context.globalAlpha = 1;
    context.save();
    context.clip();
    context.fillStyle = bar.color;
    context.fillRect(barX, barY, fillWidth, STATUS_BAR_HEIGHT);
    context.restore();

    context.fillStyle = LCARS_BLACK;
    context.textAlign = "left";
    context.fillText(bar.label, barX + 8, barY + STATUS_BAR_HEIGHT / 2);
    context.textAlign = "right";
    context.fillText(
      `${Math.round(bar.state)}%`,
      barX + barWidth - 8,
      barY + STATUS_BAR_HEIGHT / 2,
    );
  }

  context.restore();
}

/**
 * Draw the event phrase as a quiet, non-physical arena background.
 * @param {number} width Viewport width in CSS pixels.
 * @param {number} height Viewport height in CSS pixels.
 * @returns {void}
 */
function drawPhraseBackground(width, height) {
  const fontSize = phraseFontSizeForViewport(width, height);
  const metrics = phraseTextMetrics(fontSize);
  const lineHeight = metrics.lineHeight + PHRASE_LINE_GAP;
  const blockHeight =
    metrics.lineHeight * PHRASE_LINES.length +
    PHRASE_LINE_GAP * (PHRASE_LINES.length - 1);
  const firstBaseline = (height - blockHeight) / 2 + metrics.ascent;

  context.save();
  context.font = `${PHRASE_FONT_WEIGHT} ${fontSize}px ${PHRASE_FONT_FAMILY}`;
  context.fillStyle = LCARS_LAVENDER;
  context.globalAlpha = PHRASE_OPACITY;
  context.textAlign = "center";
  context.textBaseline = "alphabetic";

  for (let lineIndex = 0; lineIndex < PHRASE_LINES.length; lineIndex += 1) {
    context.fillText(
      PHRASE_LINES[lineIndex],
      width / 2,
      firstBaseline + lineIndex * lineHeight,
    );
  }

  context.restore();
}

/**
 * Draw the four physical arena boundaries as a restrained danger glow. The
 * gradients fade inward so the edge remains legible while the play field
 * stays clear; this is presentation only and does not change wall physics.
 * @param {number} width Viewport width in CSS pixels.
 * @param {number} height Viewport height in CSS pixels.
 * @returns {void}
 */
function drawDangerWalls(width, height) {
  const thickness = Math.min(
    WALL_GLOW_THICKNESS,
    Math.max(1, Math.min(width, height) / 2),
  );

  context.save();

  // Gradients provide the complete inward glow. A shadow on these full-edge
  // rectangles duplicates that effect while forcing Safari to rasterize four
  // large blur regions on every frame.
  const topGradient = context.createLinearGradient(0, 0, 0, thickness);
  topGradient.addColorStop(0, WALL_GLOW_COLOR);
  topGradient.addColorStop(1, WALL_GLOW_FADE_COLOR);
  context.fillStyle = topGradient;
  context.fillRect(0, 0, width, thickness);

  const bottomGradient = context.createLinearGradient(
    0,
    height,
    0,
    height - thickness,
  );
  bottomGradient.addColorStop(0, WALL_GLOW_COLOR);
  bottomGradient.addColorStop(1, WALL_GLOW_FADE_COLOR);
  context.fillStyle = bottomGradient;
  context.fillRect(0, height - thickness, width, thickness);

  const leftGradient = context.createLinearGradient(0, 0, thickness, 0);
  leftGradient.addColorStop(0, WALL_GLOW_COLOR);
  leftGradient.addColorStop(1, WALL_GLOW_FADE_COLOR);
  context.fillStyle = leftGradient;
  context.fillRect(0, 0, thickness, height);

  const rightGradient = context.createLinearGradient(
    width,
    0,
    width - thickness,
    0,
  );
  rightGradient.addColorStop(0, WALL_GLOW_COLOR);
  rightGradient.addColorStop(1, WALL_GLOW_FADE_COLOR);
  context.fillStyle = rightGradient;
  context.fillRect(width - thickness, 0, thickness, height);

  context.strokeStyle = WALL_GLOW_COLOR;
  context.lineWidth = 2;
  context.beginPath();
  context.rect(1, 1, Math.max(0, width - 2), Math.max(0, height - 2));
  context.stroke();
  context.restore();
}

/**
 * Draw all active impact particles above the bodies and below any help or
 * status overlay, keeping the burst visible without obscuring player-facing
 * instructions.
 * @returns {void}
 */
function drawSparks() {
  if (sparks.length === 0) {
    return;
  }

  context.save();
  context.globalCompositeOperation = "lighter";
  context.fillStyle = SPARK_COLOR;
  for (const spark of sparks) {
    spark.draw();
  }
  context.restore();
}

/**
 * Clear the LCARS command console above the physical arena. Buttons and status
 * read cleanly on black without decorative rails competing behind them.
 * @param {number} width Viewport width in CSS pixels.
 * @returns {void}
 */
function drawLCARSCommandConsole(width) {
  context.save();
  context.fillStyle = LCARS_BLACK;
  context.fillRect(0, 0, width, LCARS_CONSOLE_HEIGHT);
  context.restore();
}

/**
 * Draw the black space and the player in the bounded field.
 * The triangle points upward and has its tip and base endpoints on the hull's
 * circumference. Its base chord is intentionally shorter than its sides so
 * the tip communicates the ship's direction without extra UI.
 */
function drawGame(width, height) {
  const playfieldHeight = gameplayHeightForViewport(height);
  const triangleTipAngle = playerAngle;
  const triangleBaseCenterAngle = triangleTipAngle + Math.PI;
  const baseLeftAngle = triangleBaseCenterAngle - PLAYER_TRIANGLE_HALF_ANGLE;
  const baseRightAngle = triangleBaseCenterAngle + PLAYER_TRIANGLE_HALF_ANGLE;

  context.fillStyle = LCARS_BLACK;
  context.fillRect(0, 0, width, height);
  context.save();
  context.translate(0, LCARS_CONSOLE_HEIGHT);
  drawPhraseBackground(width, playfieldHeight);
  drawDangerWalls(width, playfieldHeight);

  // Asteroids are drawn after the background so the player remains visually
  // legible when the two shapes overlap. The phrase itself is never a physics
  // body and cannot be collided with, cut, or counted in telemetry.
  for (const asteroid of asteroids) {
    asteroid.draw();
  }

  for (const bullet of bullets) {
    bullet.draw();
  }

  // The circle remains unfilled so the black space is visible inside the hull.
  context.beginPath();
  context.arc(playerX, playerY, PLAYER_RADIUS, 0, Math.PI * 2);
  context.strokeStyle =
    shieldState > 0 ? LCARS_LILAC : "rgba(153, 153, 255, 0.3)";
  context.lineWidth = 3;
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
  context.fillStyle = LCARS_GOLD;
  context.fill();

  context.beginPath();
  context.moveTo(tip.x, tip.y);
  context.lineTo(playerX, playerY);
  context.strokeStyle = LCARS_CORAL;
  context.lineWidth = 2;
  context.stroke();

  drawSparks();

  if (shipFailureActive) {
    drawShipFailure(width, playfieldHeight);
  } else if (gameWon) {
    drawWinScreen(width, playfieldHeight);
  } else if (gamePaused) {
    drawPauseHelp(width, playfieldHeight);
  }
  context.restore();

  drawLCARSCommandConsole(width);
  drawFlightControls(width);
  drawStatusBars(width);
}

/**
 * Draw one LCARS control button with a large command and smaller action.
 * Active controls receive a bright inset, keeping their base color and label
 * readable while making held manual and autopilot input equally visible.
 * @param {number} x Left edge in CSS pixels.
 * @param {number} y Top edge in CSS pixels.
 * @param {number} width Button width in CSS pixels.
 * @param {number} height Button height in CSS pixels.
 * @param {string} title Large command label.
 * @param {string} detail Small action label.
 * @param {string} color Resting LCARS fill color.
 * @param {boolean} active Whether the control is currently engaged.
 * @param {boolean} [leftCap=false] Whether to round the left end of the row.
 * @returns {void}
 */
function drawFlightControlButton(
  x,
  y,
  width,
  height,
  title,
  detail,
  color,
  active,
  leftCap = false,
) {
  context.save();
  context.fillStyle = color;
  context.beginPath();
  context.roundRect(x, y, width, height, leftCap ? [height / 2, 4, 4, 4] : 4);
  context.fill();

  if (active) {
    context.strokeStyle = LCARS_TEXT;
    context.lineWidth = FLIGHT_CONTROL_ACTIVE_INSET;
    context.beginPath();
    context.roundRect(
      x + FLIGHT_CONTROL_ACTIVE_INSET / 2,
      y + FLIGHT_CONTROL_ACTIVE_INSET / 2,
      Math.max(0, width - FLIGHT_CONTROL_ACTIVE_INSET),
      Math.max(0, height - FLIGHT_CONTROL_ACTIVE_INSET),
      leftCap ? [height / 2, 3, 3, 3] : 3,
    );
    context.stroke();
  }

  const horizontalPadding = Math.min(16, Math.max(7, width * 0.12));
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillStyle = LCARS_BLACK;
  context.font = `${FLIGHT_CONTROL_TITLE_WEIGHT} 21px ${LCARS_FONT_FAMILY}`;
  context.fillText(
    title,
    x + horizontalPadding,
    y + 22,
    width - horizontalPadding * 2,
  );
  context.font = `${FLIGHT_CONTROL_DETAIL_WEIGHT} 12px ${LCARS_BODY_FONT_FAMILY}`;
  context.fillText(
    detail,
    x + horizontalPadding,
    y + 42,
    width - horizontalPadding * 2,
  );
  context.restore();
}

/**
 * Draw the persistent flight-control row. Gameplay buttons read the effective
 * key set shared by manual helm and autopilot. Each cap recognizes both keys
 * for its gameplay action, so arrow-key input is represented as faithfully as
 * the labelled WASD shortcut without adding a second state model.
 * @param {number} width The viewport width in CSS pixels.
 * @returns {void}
 */
function drawFlightControls(width) {
  if (width <= LCARS_FRAME_MARGIN * 2) {
    return;
  }

  const titleWidth = Math.min(
    LCARS_MODE_WIDTH,
    Math.max(0, width - LCARS_FRAME_MARGIN * 2),
  );
  const statusWidth = Math.min(
    STATUS_POINTS_WIDTH + STATUS_POINTS_GAP + STATUS_BAR_WIDTH,
    Math.max(0, width - LCARS_FRAME_MARGIN * 2 - titleWidth - 12),
  );
  const rowWidth = Math.max(
    0,
    width - LCARS_FRAME_MARGIN * 2 - statusWidth - FLIGHT_CONTROL_GAP,
  );
  const keyButtonCount = 7;
  const desiredKeyWidth = FLIGHT_CONTROL_KEY_WIDTH;
  const rowScale = Math.min(
    1,
    rowWidth /
      (titleWidth +
        desiredKeyWidth * keyButtonCount +
        FLIGHT_CONTROL_GAP * keyButtonCount),
  );
  const buttonHeight = STATUS_POINTS_HEIGHT;
  let buttonX = LCARS_FRAME_MARGIN;
  const controls = [
    ["T", "AUTOPILOT", LCARS_AMBER, autopilotEnabled],
    ["P", "PAUSE", LCARS_CORAL, gamePaused],
    [
      "W⏶",
      "THRUST",
      LCARS_LILAC,
      pressedKeys.has("KeyW") || pressedKeys.has("ArrowUp"),
    ],
    [
      "S⏷",
      "BRAKE",
      LCARS_LAVENDER,
      pressedKeys.has("KeyS") || pressedKeys.has("ArrowDown"),
    ],
    [
      "A⏴",
      "TURN CCW",
      LCARS_LILAC,
      pressedKeys.has("KeyA") || pressedKeys.has("ArrowLeft"),
    ],
    [
      "D⏵",
      "TURN CW",
      LCARS_LAVENDER,
      pressedKeys.has("KeyD") || pressedKeys.has("ArrowRight"),
    ],
    [FIRE_KEY_LABEL, "SHOOT", LCARS_AMBER, pressedKeys.has(FIRE_KEY)],
  ];

  drawFlightControlButton(
    buttonX,
    LCARS_CONSOLE_TOP,
    titleWidth * rowScale,
    buttonHeight,
    "FLIGHT CONTROL",
    autopilotEnabled ? "AUTOPILOT" : "MANUAL HELM",
    autopilotEnabled ? LCARS_AMBER : LCARS_LILAC,
    autopilotEnabled,
    true,
  );
  buttonX += titleWidth * rowScale + FLIGHT_CONTROL_GAP * rowScale;

  for (const [title, detail, color, active] of controls) {
    drawFlightControlButton(
      buttonX,
      LCARS_CONSOLE_TOP,
      desiredKeyWidth * rowScale,
      buttonHeight,
      title,
      detail,
      color,
      active,
    );
    buttonX += desiredKeyWidth * rowScale + FLIGHT_CONTROL_GAP * rowScale;
  }
}

/**
 * Draw the shared, deliberately open LCARS treatment for modal information.
 * Its asymmetric corners keep the window organic while a single perimeter
 * leaves the message area completely free of decorative, functionless blocks.
 * @param {number} panelWidth Overlay width in CSS pixels.
 * @param {number} panelHeight Overlay height in CSS pixels.
 * @param {string} accent Primary state color.
 * @returns {void}
 */
function drawLCARSOverlayFrame(panelWidth, panelHeight, accent) {
  context.save();
  // A calm silhouette restores a clear window boundary. The asymmetric radius
  // order avoids a generic card while keeping every edge unambiguous.
  context.beginPath();
  context.roundRect(0, 0, panelWidth, panelHeight, [52, 16, 52, 16]);
  context.fillStyle = LCARS_PANEL;
  context.fill();
  context.lineWidth = 5;
  context.strokeStyle = accent;
  context.stroke();
  context.restore();
}

/**
 * Explain why the current life ended while the next field is delayed. The
 * status bars are drawn afterward so their animated drainage remains visible
 * above the failure treatment.
 * @param {number} width Viewport width in CSS pixels.
 * @param {number} height Viewport height in CSS pixels.
 * @returns {void}
 */
function drawShipFailure(width, height) {
  const failureScale = Math.max(
    0,
    Math.min(
      1,
      (width - 32) / SHIP_FAILURE_PANEL_WIDTH,
      (height - 32) / SHIP_FAILURE_PANEL_HEIGHT,
    ),
  );

  context.save();
  context.fillStyle = `rgba(0, 0, 0, ${SHIP_FAILURE_BACKDROP_ALPHA})`;
  context.fillRect(0, 0, width, height);

  if (failureScale === 0) {
    context.restore();
    return;
  }

  const panelX = (width - SHIP_FAILURE_PANEL_WIDTH * failureScale) / 2;
  const panelY = (height - SHIP_FAILURE_PANEL_HEIGHT * failureScale) / 2;

  context.translate(panelX, panelY);
  context.scale(failureScale, failureScale);
  drawLCARSOverlayFrame(
    SHIP_FAILURE_PANEL_WIDTH,
    SHIP_FAILURE_PANEL_HEIGHT,
    LCARS_RED,
  );

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = LCARS_CORAL;
  context.font = `700 42px ${LCARS_FONT_FAMILY}`;
  context.fillText("SHIP DESTROYED", SHIP_FAILURE_PANEL_WIDTH / 2, 82);
  context.fillStyle = LCARS_TEXT;
  context.font = `500 22px ${LCARS_BODY_FONT_FAMILY}`;
  context.fillText(SHIP_FAILURE_REASON, SHIP_FAILURE_PANEL_WIDTH / 2, 142);
  context.fillStyle = LCARS_MUTED_TEXT;
  context.font = `400 19px ${LCARS_BODY_FONT_FAMILY}`;
  context.fillText(
    "Keep clear of the asteroids.",
    SHIP_FAILURE_PANEL_WIDTH / 2,
    182,
  );
  context.fillStyle = LCARS_AMBER;
  context.font = `600 23px ${LCARS_BODY_FONT_FAMILY}`;
  context.fillText(
    `NEW FIELD IN ${Math.max(1, Math.ceil(shipFailureTimeRemaining))}`,
    SHIP_FAILURE_PANEL_WIDTH / 2,
    230,
  );
  context.restore();
}

/**
 * Draw the final result over the empty arena and keep the restart instruction
 * aligned with the pause control used everywhere else in the game.
 * @param {number} width Viewport width in CSS pixels.
 * @param {number} height Viewport height in CSS pixels.
 * @returns {void}
 */
function drawWinScreen(width, height) {
  const winScale = Math.max(
    0,
    Math.min(
      1,
      (width - 32) / WIN_SCREEN_PANEL_WIDTH,
      (height - 32) / WIN_SCREEN_PANEL_HEIGHT,
    ),
  );

  context.save();
  context.fillStyle = `rgba(0, 0, 0, ${WIN_SCREEN_BACKDROP_ALPHA})`;
  context.fillRect(0, 0, width, height);

  if (winScale === 0) {
    context.restore();
    return;
  }

  const panelX = (width - WIN_SCREEN_PANEL_WIDTH * winScale) / 2;
  const panelY = (height - WIN_SCREEN_PANEL_HEIGHT * winScale) / 2;

  context.translate(panelX, panelY);
  context.scale(winScale, winScale);
  drawLCARSOverlayFrame(
    WIN_SCREEN_PANEL_WIDTH,
    WIN_SCREEN_PANEL_HEIGHT,
    LCARS_LILAC,
  );

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = LCARS_GOLD;
  context.font = `700 46px ${LCARS_FONT_FAMILY}`;
  context.fillText(WIN_SCREEN_TITLE, WIN_SCREEN_PANEL_WIDTH / 2, 86);
  context.fillStyle = LCARS_TEXT;
  context.font = `500 22px ${LCARS_BODY_FONT_FAMILY}`;
  context.fillText(WIN_SCREEN_REASON, WIN_SCREEN_PANEL_WIDTH / 2, 144);
  context.fillStyle = LCARS_AMBER;
  context.font = `500 15px ${LCARS_BODY_FONT_FAMILY}`;
  context.fillText("FINAL SCORE", WIN_SCREEN_PANEL_WIDTH / 2, 182);
  context.font = `700 30px ${LCARS_BODY_FONT_FAMILY}`;
  context.fillText(
    Math.round(points).toString(),
    WIN_SCREEN_PANEL_WIDTH / 2,
    212,
  );
  context.fillStyle = LCARS_MUTED_TEXT;
  context.font = `500 20px ${LCARS_BODY_FONT_FAMILY}`;
  context.fillText(
    `PRESS ${PAUSE_KEY_LABEL} TO PLAY AGAIN`,
    WIN_SCREEN_PANEL_WIDTH / 2,
    254,
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
  drawLCARSOverlayFrame(HELP_PANEL_WIDTH, HELP_PANEL_HEIGHT, LCARS_LAVENDER);

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = LCARS_GOLD;
  context.font = `800 32px ${LCARS_FONT_FAMILY}`;
  context.fillText("PAUSED", HELP_PANEL_WIDTH / 2, 82);
  context.fillStyle = LCARS_LILAC;
  context.font = `600 18px ${LCARS_BODY_FONT_FAMILY}`;
  context.fillText(
    `Press ${PAUSE_KEY_LABEL} to resume`,
    HELP_PANEL_WIDTH / 2,
    112,
  );

  context.textAlign = "left";
  context.font = `700 18px ${LCARS_FONT_FAMILY}`;
  for (let helpIndex = 0; helpIndex < PLAY_HELP.length; helpIndex += 1) {
    const helpItem = PLAY_HELP[helpIndex];
    const rowY = 166 + helpIndex * 42;

    context.fillStyle = helpIndex % 2 === 0 ? LCARS_AMBER : LCARS_LILAC;
    context.beginPath();
    context.roundRect(70, rowY - 16, 112, 30, [15, 3, 3, 15]);
    context.fill();
    context.fillStyle = LCARS_BLACK;
    context.fillText(helpItem.label, 82, rowY);
    context.fillStyle = LCARS_TEXT;
    context.font = `500 18px ${LCARS_BODY_FONT_FAMILY}`;
    context.fillText(helpItem.description, 208, rowY);
    context.font = `700 18px ${LCARS_FONT_FAMILY}`;
  }

  context.textAlign = "center";
  context.fillStyle = LCARS_MUTED_TEXT;
  context.font = `500 16px ${LCARS_BODY_FONT_FAMILY}`;
  context.fillText(
    "Shield regenerates; hull damage persists.",
    HELP_PANEL_WIDTH / 2,
    434,
  );
  context.fillText(
    "Walls damage the ship. Manual input disables autopilot.",
    HELP_PANEL_WIDTH / 2,
    464,
  );
  context.restore();
}

/**
 * Move one scalar body coordinate without allocating a result object. This is
 * the hot path used by every moving body on every frame; the loop retains the
 * defensive multi-bounce behavior for tiny viewports.
 * @param {PhysicsBody} body Body whose coordinate and velocity are updated.
 * @param {"x"|"y"} positionProperty Coordinate property to advance.
 * @param {"velocityX"|"velocityY"} velocityProperty Matching velocity property.
 * @param {number} displacement Signed coordinate displacement.
 * @param {number} minimum Inclusive lower coordinate bound.
 * @param {number} maximum Inclusive upper coordinate bound.
 * @param {number} [bounceCoefficient] Normal velocity multiplier without a callback.
 * @param {(normal: Vector2) => void} [onCollision] Contact handler for each wall hit.
 * @returns {void}
 */
function advanceAndReflect(
  body,
  positionProperty,
  velocityProperty,
  displacement,
  minimum,
  maximum,
  bounceCoefficient = 1,
  onCollision,
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
      body[positionProperty] = minimum;
      if (onCollision === undefined) {
        body[velocityProperty] *= bounceCoefficient;
      } else {
        onCollision(
          positionProperty === "x" ? { x: -1, y: 0 } : { x: 0, y: -1 },
        );
      }
    }

    if (nextPosition > maximum) {
      nextPosition = maximum - (nextPosition - maximum);
      directionMultiplier *= -1;
      body[positionProperty] = maximum;
      if (onCollision === undefined) {
        body[velocityProperty] *= bounceCoefficient;
      } else {
        onCollision(positionProperty === "x" ? { x: 1, y: 0 } : { x: 0, y: 1 });
      }
    }
  }

  body[positionProperty] = nextPosition;
  if (onCollision === undefined) {
    body[velocityProperty] *= directionMultiplier;
  }
}

/**
 * Resolve one ship-to-wall contact at the shield rim. The shared contact
 * solver applies restitution along the wall normal and a Coulomb-limited
 * friction impulse along the wall. Because the impulse is off-center, its
 * magnitude—and therefore the resulting turn and damage—depends on ship
 * momentum. The static wall has zero velocity and infinite mass, so it adds
 * no momentum of its own.
 * @param {PhysicsBody} ship
 * @param {Vector2} normal Normal pointing from the ship toward the wall.
 * @returns {ContactResponse}
 */
function resolveShipWallContact(ship, normal) {
  const contactPoint = {
    x: ship.x + normal.x * PLAYER_RADIUS,
    y: ship.y + normal.y * PLAYER_RADIUS,
  };
  const beforeEnergy = bodyKineticEnergy(ship);

  const response = applyContactImpulse(
    ship,
    STATIC_WALL_BODY,
    normal,
    contactPoint,
    SHIELD_WALL_FRICTION_COEFFICIENT,
  );
  const afterEnergy = bodyKineticEnergy(ship);

  emitSparksAt(
    contactPoint,
    interactionKineticEnergyLoss(beforeEnergy, afterEnergy),
  );

  if (response.normalImpulse > COLLISION_EPSILON) {
    applyCollisionDamage(contactImpulseMagnitude(response));
  }
  applyShipCollisionAngleAdjustment(response);
  return response;
}

/**
 * Turn the ship once at the collision moment without introducing persistent
 * angular momentum. The angular impulse still comes from the same friction
 * calculation, so greater contact momentum or friction produces a larger
 * heading adjustment.
 * @param {ContactResponse} response Contact response involving the ship.
 * @returns {void}
 */
function applyShipCollisionAngleAdjustment(response) {
  const uncappedAngleAdjustment =
    (response.firstAngularImpulse / STARSHIP_COLLISION_TURN_INERTIA) *
    SHIP_COLLISION_TURN_RESPONSE;
  const angleAdjustment = Math.max(
    -MAX_SHIP_COLLISION_TURN_ANGLE,
    Math.min(MAX_SHIP_COLLISION_TURN_ANGLE, uncappedAngleAdjustment),
  );

  if (Number.isFinite(uncappedAngleAdjustment)) {
    playerAngle = wrapAngle(playerAngle + angleAdjustment);
  }
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
      const beforeEnergy = bodyKineticEnergy(asteroid);
      const response = applyContactImpulse(
        asteroid,
        STATIC_WALL_BODY,
        normal,
        contactPoint,
      );
      const afterEnergy = bodyKineticEnergy(asteroid);

      emitSparksAt(
        contactPoint,
        interactionKineticEnergyLoss(beforeEnergy, afterEnergy),
      );
      changed ||= response.normalImpulse > COLLISION_EPSILON;
    };

    if (bounds.minimumX <= COLLISION_EPSILON) {
      resolveWall({ x: -1, y: 0 }, Math.max(0, -bounds.minimumX));
    }

    if (bounds.maximumX >= width - COLLISION_EPSILON) {
      resolveWall({ x: 1, y: 0 }, Math.max(0, bounds.maximumX - width));
    }

    if (bounds.minimumY <= COLLISION_EPSILON) {
      resolveWall({ x: 0, y: -1 }, Math.max(0, -bounds.minimumY));
    }

    if (bounds.maximumY >= height - COLLISION_EPSILON) {
      resolveWall({ x: 0, y: 1 }, Math.max(0, bounds.maximumY - height));
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
  const linearEnergy =
    0.5 * body.mass * (body.velocityX ** 2 + body.velocityY ** 2);
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
    body.angularVelocity +=
      cross2D(offsetX, offsetY, impulseX, impulseY) * inverseMomentOfInertia;
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
  const angularMomentumAfter =
    bodyAngularMomentum(firstBody) + bodyAngularMomentum(secondBody);
  const angularMomentumCorrection =
    angularMomentumBefore - angularMomentumAfter;
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
    const squaredRadiusSum =
      firstVertex.x ** 2 +
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
    const firstSide =
      sideMultiplier *
      cross2D(
        lineDirection.x,
        lineDirection.y,
        firstVertex.x - linePoint.x,
        firstVertex.y - linePoint.y,
      );
    const secondSide =
      sideMultiplier *
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
          x:
            firstVertex.x +
            (secondVertex.x - firstVertex.x) * intersectionRatio,
          y:
            firstVertex.y +
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
    const startSide =
      orientation *
      cross2D(edgeX, edgeY, start.x - firstVertex.x, start.y - firstVertex.y);
    const sideRate =
      orientation * cross2D(edgeX, edgeY, direction.x, direction.y);

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
  const discriminant =
    projectedOffset ** 2 -
    directionLengthSquared * (offsetX ** 2 + offsetY ** 2 - radiusSquared);

  if (discriminant < -COLLISION_EPSILON) {
    return undefined;
  }

  const squareRootDiscriminant = Math.sqrt(Math.max(0, discriminant));
  const firstParameter =
    (-projectedOffset - squareRootDiscriminant) / directionLengthSquared;
  const secondParameter =
    (-projectedOffset + squareRootDiscriminant) / directionLengthSquared;

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
          (point.y - firstVertex.y) * edgeY) /
          edgeLength ** 2,
      ),
    );
    const closestX = firstVertex.x + edgeX * pointAlongEdge;
    const closestY = firstVertex.y + edgeY * pointAlongEdge;
    const distanceSquared =
      (point.x - closestX) ** 2 + (point.y - closestY) ** 2;

    if (distanceSquared < nearestDistanceSquared) {
      nearestDistanceSquared = distanceSquared;
      nearestNormal =
        polygonTwiceArea >= 0
          ? { x: edgeY / edgeLength, y: -edgeX / edgeLength }
          : { x: -edgeY / edgeLength, y: edgeX / edgeLength };
    }
  }

  if (
    incomingVelocityX * nearestNormal.x + incomingVelocityY * nearestNormal.y >
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
 * @param {number} [frictionCoefficient]
 * @returns {ContactResponse}
 */
function applyContactImpulse(
  firstBody,
  secondBody,
  normal,
  contactPoint,
  frictionCoefficient = FRICTION_COEFFICIENT,
) {
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
  const normalEffectiveMass =
    inverseFirstMass +
    inverseSecondMass +
    firstNormalLever ** 2 * inverseFirstMoment +
    secondNormalLever ** 2 * inverseSecondMoment;
  const firstContactVelocity = velocityAtPoint(firstBody, contactPoint);
  const secondContactVelocity = velocityAtPoint(secondBody, contactPoint);
  const relativeVelocityX = secondContactVelocity.x - firstContactVelocity.x;
  const relativeVelocityY = secondContactVelocity.y - firstContactVelocity.y;
  const relativeNormalVelocity =
    relativeVelocityX * normal.x + relativeVelocityY * normal.y;

  // A separating contact needs no impulse. Applying a response to only one
  // body would change both linear and angular momentum without a counterpart.
  if (relativeNormalVelocity >= 0 || normalEffectiveMass <= COLLISION_EPSILON) {
    return {
      x: 0,
      y: 0,
      normalImpulse: 0,
      tangentImpulse: 0,
      firstAngularImpulse: 0,
      secondAngularImpulse: 0,
    };
  }

  const normalImpulseMagnitude =
    (-(1 + BOUNCINESS) * relativeNormalVelocity) / normalEffectiveMass;
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
  const tangentEffectiveMass =
    inverseFirstMass +
    inverseSecondMass +
    firstNormalTangentLever ** 2 * inverseFirstMoment +
    secondNormalTangentLever ** 2 * inverseSecondMoment;
  const firstPostNormalVelocity = velocityAtPoint(firstBody, contactPoint);
  const secondPostNormalVelocity = velocityAtPoint(secondBody, contactPoint);
  const relativeTangentVelocity =
    (secondPostNormalVelocity.x - firstPostNormalVelocity.x) * tangent.x +
    (secondPostNormalVelocity.y - firstPostNormalVelocity.y) * tangent.y;
  const unconstrainedTangentImpulse =
    tangentEffectiveMass > COLLISION_EPSILON
      ? -relativeTangentVelocity / tangentEffectiveMass
      : 0;
  const maximumTangentImpulse = frictionCoefficient * normalImpulseMagnitude;
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

/**
 * Convert an interaction's energy bookkeeping into a non-negative spark
 * budget. Energy from bodies that are removed is added after the physical
 * response, so a disappearing body contributes its full remaining energy.
 * @param {number} beforeEnergy Total kinetic energy before the interaction.
 * @param {number} afterEnergy Total kinetic energy after the response.
 * @param {number} [removedEnergy] Kinetic energy of bodies removed afterward.
 * @returns {number} Kinetic energy converted into the visual effect.
 */
function interactionKineticEnergyLoss(
  beforeEnergy,
  afterEnergy,
  removedEnergy = 0,
) {
  const safeBeforeEnergy = Number.isFinite(beforeEnergy)
    ? Math.max(0, beforeEnergy)
    : 0;
  const safeAfterEnergy = Number.isFinite(afterEnergy)
    ? Math.max(0, afterEnergy)
    : 0;
  const safeRemovedEnergy = Number.isFinite(removedEnergy)
    ? Math.max(0, removedEnergy)
    : 0;

  return Math.max(0, safeBeforeEnergy - safeAfterEnergy + safeRemovedEnergy);
}

/**
 * Keep spark density proportional to dissipated energy while ensuring even a
 * small real loss produces a visible hit. The cap protects the frame budget
 * when the full energy of a large asteroid is converted at once.
 * @param {number} kineticEnergyLoss Energy converted into sparks.
 * @returns {number} Number of particles to emit.
 */
function sparkCountForEnergyLoss(kineticEnergyLoss) {
  if (!Number.isFinite(kineticEnergyLoss) || kineticEnergyLoss <= 0) {
    return 0;
  }

  return Math.min(
    MAX_SPARKS_PER_INTERACTION,
    Math.max(1, Math.round(kineticEnergyLoss / SPARK_ENERGY_PER_PARTICLE)),
  );
}

/**
 * Emit a random-direction burst at a contact point. The particles are
 * presentation-only, so this function intentionally does not touch bodies,
 * scores, damage, or any other gameplay state.
 * @param {Vector2} contactPoint Position of the interaction.
 * @param {number} kineticEnergyLoss Energy available for the burst.
 * @returns {void}
 */
function emitSparksAt(contactPoint, kineticEnergyLoss) {
  const safeKineticEnergyLoss = Number.isFinite(kineticEnergyLoss)
    ? Math.max(0, kineticEnergyLoss)
    : 0;
  const sparkCount = sparkCountForEnergyLoss(safeKineticEnergyLoss);
  const availableSparkSlots = Math.max(0, MAX_ACTIVE_SPARKS - sparks.length);
  const emittedSparkCount = Math.min(sparkCount, availableSparkSlots);

  lastFrameSparkCount += emittedSparkCount;
  lastFrameSparkEnergy += safeKineticEnergyLoss;
  totalSparksEmitted += emittedSparkCount;

  for (let sparkIndex = 0; sparkIndex < emittedSparkCount; sparkIndex += 1) {
    sparks.push(new Spark(contactPoint));
  }
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

        if (hitParameter !== undefined && hitParameter < nearestHitParameter) {
          nearestHitParameter = hitParameter;
          hitAsteroidIndex = asteroidIndex;
        }
      }

      const wallHit = boundaryHit(segmentStart, segmentEnd, width, height);
      const asteroidIsFirst =
        hitAsteroidIndex >= 0 &&
        nearestHitParameter <= (wallHit?.parameter ?? Infinity);
      const shipHitParameter = shipIgnored
        ? Infinity
        : segmentCircleIntersectionParameter(segmentStart, segmentEnd, ship);
      const shipIsFirst =
        shipHitParameter !== undefined &&
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
      const remainingDistance =
        Math.hypot(
          segmentEnd.x - segmentStart.x,
          segmentEnd.y - segmentStart.y,
        ) *
        (1 - hitParameter);
      const canReflect = bullet.reflectionCount < MAX_BULLET_REFLECTIONS;

      let normal = bodyIsFirst ? undefined : wallHit.normal;
      let interactionBeforeEnergy = bodyKineticEnergy(bullet);
      let interactionAfterEnergy = interactionBeforeEnergy;
      let removedEnergy = 0;

      if (asteroidIsFirst) {
        const asteroid = asteroids[hitAsteroidIndex];
        bullet.x = hitPoint.x;
        bullet.y = hitPoint.y;
        const beforeMomentum = {
          x:
            asteroid.mass * asteroid.velocityX + bullet.mass * bullet.velocityX,
          y:
            asteroid.mass * asteroid.velocityY + bullet.mass * bullet.velocityY,
        };
        const beforeAngularMomentum =
          bodyAngularMomentum(asteroid) + bodyAngularMomentum(bullet);
        const beforeEnergy =
          bodyKineticEnergy(asteroid) + bodyKineticEnergy(bullet);
        interactionBeforeEnergy = beforeEnergy;

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
        const afterEnergy =
          fragments.reduce(
            (energy, fragment) => energy + bodyKineticEnergy(fragment),
            bodyKineticEnergy(bullet),
          ) + (fragments.length === 0 ? bodyKineticEnergy(asteroid) : 0);
        interactionAfterEnergy = afterEnergy;
        if (fragments.length === 0) {
          removedEnergy += bodyKineticEnergy(asteroid);
        }
        countVanishedAsteroidArea(asteroid, fragments);
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
          lastBulletMomentumDelta = {
            x: afterMomentum.x - beforeMomentum.x,
            y: afterMomentum.y - beforeMomentum.y,
          };
          lastBulletAngularMomentumDelta =
            afterAngularMomentum - beforeAngularMomentum;
          lastBulletKineticEnergyDelta = afterEnergy - beforeEnergy;
        }
      } else if (shipIsFirst) {
        bullet.x = hitPoint.x;
        bullet.y = hitPoint.y;
        const beforeMomentum = {
          x: ship.mass * ship.velocityX + bullet.mass * bullet.velocityX,
          y: ship.mass * ship.velocityY + bullet.mass * bullet.velocityY,
        };
        const beforeEnergy =
          bodyKineticEnergy(ship) + bodyKineticEnergy(bullet);
        interactionBeforeEnergy = beforeEnergy;

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
        applyShipCollisionAngleAdjustment(bulletImpulse);
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
        const afterEnergy = bodyKineticEnergy(ship) + bodyKineticEnergy(bullet);
        interactionAfterEnergy = afterEnergy;

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
        removedEnergy += bodyKineticEnergy(bullet);
        emitSparksAt(
          hitPoint,
          interactionKineticEnergyLoss(
            interactionBeforeEnergy,
            interactionAfterEnergy,
            removedEnergy,
          ),
        );
        bullets.splice(bulletIndex, 1);
        break;
      }

      if (!bodyIsFirst) {
        bullet.reflect(normal);
        interactionAfterEnergy = bodyKineticEnergy(bullet);
      }
      emitSparksAt(
        hitPoint,
        interactionKineticEnergyLoss(
          interactionBeforeEnergy,
          interactionAfterEnergy,
          removedEnergy,
        ),
      );
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
  const firstPoint =
    firstVertices === undefined
      ? {
          x: firstBody.x + normal.x * firstBody.radius,
          y: firstBody.y + normal.y * firstBody.radius,
        }
      : supportPoint(firstVertices, normal);
  const secondPoint =
    secondVertices === undefined
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
  const firstProjection =
    firstShape.type === "polygon"
      ? projectPolygon(firstShape.vertices, axis)
      : projectCircle(firstBody, axis);
  const secondProjection =
    secondShape.type === "polygon"
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

    if (relativeDirection.x * axis.x + relativeDirection.y * axis.y < 0) {
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
function circlePolygonManifold(circleBody, polygonBody, polygonVertices) {
  const axes = [...(polygonBody.collisionAxes ?? polygonAxes(polygonVertices))];
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
    Math.hypot(closestPoint.x - circleBody.x, closestPoint.y - circleBody.y) >
    COLLISION_EPSILON
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
  const bodies = [ship, ...asteroids, ...(includeBullets ? bullets : [])];
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
 * @param {CollisionManifold} [existingManifold] Precomputed contact geometry.
 * @returns {ContactResponse | undefined} Contact response, or undefined when
 *   the bodies do not overlap.
 */
function resolveCollision(firstBody, secondBody, existingManifold) {
  const manifold = existingManifold ?? collisionManifold(firstBody, secondBody);

  if (manifold === undefined) {
    return undefined;
  }

  const { normal, penetration, contactPoint } = manifold;
  const offsetX = normal.x;
  const offsetY = normal.y;

  const inverseFirstMass = bodyInverseMass(firstBody);
  const inverseSecondMass = bodyInverseMass(secondBody);
  const inverseMassSum = inverseFirstMass + inverseSecondMass;
  const angularMomentumBeforeSeparation =
    bodyAngularMomentum(firstBody) + bodyAngularMomentum(secondBody);

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

  const response = applyContactImpulse(
    firstBody,
    secondBody,
    {
      x: offsetX,
      y: offsetY,
    },
    contactPoint,
  );

  return response;
}

/**
 * Resolve an asteroid contact and turn the measured kinetic-energy loss into
 * sparks at the same manifold point. The physics solver remains the single
 * source of collision response behavior.
 * @param {PhysicsBody} firstBody
 * @param {PhysicsBody} secondBody
 * @returns {ContactResponse | undefined} Contact response, or undefined when
 *   the bodies do not overlap.
 */
function resolveCollisionWithSparks(firstBody, secondBody) {
  const manifold = collisionManifold(firstBody, secondBody);

  if (manifold === undefined) {
    return undefined;
  }

  const beforeEnergy =
    bodyKineticEnergy(firstBody) + bodyKineticEnergy(secondBody);
  const response = resolveCollision(firstBody, secondBody, manifold);

  if (response !== undefined) {
    const afterEnergy =
      bodyKineticEnergy(firstBody) + bodyKineticEnergy(secondBody);
    emitSparksAt(
      manifold.contactPoint,
      interactionKineticEnergyLoss(beforeEnergy, afterEnergy),
    );
  }

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
        resolveCollisionWithSparks(firstAsteroid, secondAsteroid) !== undefined,
      );
    }
  }

  for (const asteroid of asteroids) {
    if (!bodiesMayOverlap(ship, asteroid)) {
      continue;
    }

    const response = resolveCollisionWithSparks(ship, asteroid);
    collisionCount += Number(response !== undefined);

    if (response !== undefined) {
      applyCollisionDamage(contactImpulseMagnitude(response));
      applyShipCollisionAngleAdjustment(response);
    }
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
  lastAngularMomentumDelta =
    afterCollision.angularMomentum - beforeCollision.angularMomentum;
  lastAngularKineticEnergyDelta =
    afterCollision.angularKineticEnergy - beforeCollision.angularKineticEnergy;
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

/**
 * Refresh diagnostic text at a human-readable rate to keep inspection from
 * becoming a source of frame-time spikes itself.
 * @param {number} deltaTime Elapsed simulation time in seconds.
 * @returns {void}
 */
function updateDebugOutput(deltaTime) {
  if (!debugEnabled) {
    return;
  }

  debugRefreshTimeRemaining -= Math.max(0, deltaTime);

  if (debugRefreshTimeRemaining > 0) {
    return;
  }

  debugRefreshTimeRemaining = DEBUG_REFRESH_INTERVAL;

  const ship = playerBody();
  const firstAsteroid = asteroids[0];
  const totalPhysics = physicsSnapshot(ship, true);
  const asteroidArea = firstAsteroid?.surfaceArea ?? 0;
  const asteroidMass = firstAsteroid?.mass ?? 0;
  const displayedFrameRate = frameRate > 0 ? frameRate.toFixed(1) : "--";
  const displayedMinimumFrameRate = Number.isFinite(minimumFrameRate)
    ? minimumFrameRate.toFixed(1)
    : "--";
  const autopilotTargetIndex =
    autopilotTargetLock === undefined
      ? -1
      : asteroids.indexOf(autopilotTargetLock);
  const autopilotTargetDistance =
    autopilotTargetLock === undefined
      ? 0
      : Math.hypot(
          autopilotTargetLock.x - playerX,
          autopilotTargetLock.y - playerY,
        );
  const autopilotShieldRatio = shieldState / SHIELD_MAX_STATE;
  const autopilotHullRatio = shipState / SHIP_MAX_STATE;

  debugOutput.textContent = [
    `PHYSICS DEBUG  (${DEBUG_TOGGLE_KEY} toggles)`,
    `Game: ${
      shipFailureActive
        ? `ship destroyed (new game in ${Math.max(
            1,
            Math.ceil(shipFailureTimeRemaining),
          )})`
        : gameWon
          ? "won (P starts a new game)"
          : gamePaused
            ? `${PAUSE_KEY_LABEL} toggles`
            : "running"
    }`,
    `Autopilot: ${
      autopilotEnabled ? "ON" : "OFF"
    } (${AUTOPILOT_TOGGLE_KEY_LABEL} toggles; manual input disables)`,
    `Autopilot target: ${
      autopilotTargetIndex >= 0 ? autopilotTargetIndex + 1 : "none"
    } at ${autopilotTargetDistance.toFixed(0)}px, turn ${
      autopilotTurnDirection > 0
        ? "CW"
        : autopilotTurnDirection < 0
          ? "CCW"
          : "hold"
    }`,
    `Autopilot maneuver: ${autopilotManeuverMode}; burst ${
      autopilotBurstTimeRemaining > 0 ? "active" : "ready"
    }`,
    `Autopilot shield policy: shield ${(autopilotShieldRatio * 100).toFixed(
      0,
    )}%, hull ${(autopilotHullRatio * 100).toFixed(0)}%, margin ${autopilotHealthSafetyMargin().toFixed(
      0,
    )}px`,
    `Shield/ship: ${shieldState.toFixed(2)}%/${shipState.toFixed(2)}% (regen ${SHIELD_REGENERATION_RATE.toFixed(
      1,
    )}/s)`,
    `Damage: momentum ${lastCollisionMomentum.toFixed(2)}, raw/applied ${lastRawCollisionDamage.toFixed(
      2,
    )}/${lastAppliedCollisionDamage.toFixed(2)}, shield ${lastShieldDamage.toFixed(
      2,
    )}, ship ${lastShipDamage.toFixed(2)}`,
    `Damage budget: ${collisionDamageBudget.toFixed(2)}/${COLLISION_DAMAGE_BUDGET_CAP.toFixed(
      2,
    )} (refill ${COLLISION_DAMAGE_BUDGET_REFILL_RATE.toFixed(1)}/s)`,
    `Damage coefficients: shield ${SHIELD_DAMAGE_COEFFICIENT.toFixed(
      2,
    )}, ship ${SHIP_DAMAGE_COEFFICIENT.toFixed(2)}`,
    `Ship restarts: ${totalShipRestartCount}`,
    `Asteroids: ${asteroids.length} (target: ${ASTEROID_COUNT})`,
    `FPS: ${displayedFrameRate} (rolling ${FPS_SAMPLE_COUNT}-frame avg)`,
    `FPS minimum: ${displayedMinimumFrameRate} (rolling window)`,
    `Asteroid: ${asteroidMass.toFixed(2)} mass, ${asteroidArea.toFixed(
      2,
    )} area, density ${(firstAsteroid?.density ?? 0).toFixed(3)}`,
    `Spin: ${(firstAsteroid?.angularVelocity ?? 0).toFixed(5)} rad/s, inertia ${(
      firstAsteroid?.momentOfInertia ?? 0
    ).toFixed(2)}`,
    `Collision: ${lastCollisionCount}/frame, ${totalCollisionCount} total`,
    `Material: e=${BOUNCINESS.toFixed(2)}, friction=${FRICTION_COEFFICIENT.toFixed(
      2,
    )}`,
    `Bullets: ${totalBulletsEmitted} fired, ${bullets.length} active, ${totalBulletCutCount} cuts | Sparks: ${sparks.length} active, ${totalSparksEmitted} emitted (${lastFrameSparkCount}, ${lastFrameSparkEnergy.toFixed(
      0,
    )}E)`,
    `Bullet mass/reflections: ${BULLET_MASS.toFixed(
      2,
    )}/${totalBulletReflectionCount}`,
    `Bullet lost Δp: (${lastBulletLostMomentum.x.toFixed(5)}, ${lastBulletLostMomentum.y.toFixed(
      5,
    )})`,
    `Bullet shoulder/ΔL: ${lastBulletShoulder.toFixed(5)}/${lastBulletAngularImpulse.toFixed(
      5,
    )}`,
    `Last cut Δp: (${lastBulletMomentumDelta.x.toFixed(5)}, ${lastBulletMomentumDelta.y.toFixed(
      5,
    )})`,
    `Last cut ΔL/ΔE: ${lastBulletAngularMomentumDelta.toFixed(5)}/${lastBulletKineticEnergyDelta.toFixed(
      5,
    )}`,
    `Ship contacts: ${totalBulletShipCollisionCount}, last impulse (${lastBulletShipImpulse.x.toFixed(
      5,
    )}, ${lastBulletShipImpulse.y.toFixed(5)})`,
    `Ship Δp/ΔE: (${lastBulletShipMomentumDelta.x.toFixed(5)}, ${lastBulletShipMomentumDelta.y.toFixed(
      5,
    )})/${lastBulletShipKineticEnergyDelta.toFixed(5)}`,
    `Firing Δp/recoil: (${lastFiringImpulseDelta.x.toFixed(5)}, ${lastFiringImpulseDelta.y.toFixed(
      5,
    )})/(${lastFiringRecoilVelocity.x.toFixed(5)}, ${lastFiringRecoilVelocity.y.toFixed(
      5,
    )})`,
    `Contact Δp: (${lastMomentumDelta.x.toFixed(5)}, ${lastMomentumDelta.y.toFixed(
      5,
    )})`,
    `Contact ΔL/ΔE: ${lastAngularMomentumDelta.toFixed(5)}/${lastKineticEnergyDelta.toFixed(
      5,
    )}`,
    `Total p: (${totalPhysics.momentumX.toFixed(2)}, ${totalPhysics.momentumY.toFixed(
      2,
    )})`,
    `Total angular momentum: ${totalPhysics.angularMomentum.toFixed(2)}`,
    `Total kinetic energy: ${totalPhysics.kineticEnergy.toFixed(2)}`,
  ].join("\n");
}

/**
 * A/D and the left/right arrows directly change the ship's facing. Collision
 * friction applies separate one-time heading adjustments. The velocity vector
 * remains free, so a ship can drift sideways or backwards while its nose
 * controls firing and thrust. Down decelerates along the current travel vector
 * rather than steering the ship toward its nose.
 */
function updateGame(deltaTime, width, height) {
  lastFrameSparkCount = 0;
  lastFrameSparkEnergy = 0;
  refillCollisionDamageBudget(deltaTime);
  regenerateShield(deltaTime);
  updateAutopilotInput(deltaTime, width, height);

  const turnsCounterClockwise =
    pressedKeys.has("ArrowLeft") || pressedKeys.has("KeyA");
  const turnsClockwise =
    pressedKeys.has("ArrowRight") || pressedKeys.has("KeyD");
  const rotationDirection =
    Number(turnsClockwise) - Number(turnsCounterClockwise);

  playerAngle += rotationDirection * ROTATION_SPEED * deltaTime;

  const accelerates = pressedKeys.has("ArrowUp") || pressedKeys.has("KeyW");
  const decelerates = pressedKeys.has("ArrowDown") || pressedKeys.has("KeyS");

  if (accelerates !== decelerates) {
    if (accelerates) {
      const acceleration = MOVEMENT_RESPONSIVENESS * deltaTime;
      playerVelocityX += Math.cos(playerAngle) * acceleration;
      playerVelocityY += Math.sin(playerAngle) * acceleration;

      const acceleratedSpeed = Math.hypot(playerVelocityX, playerVelocityY);

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

  // The ship is a dynamic rigid body just like an asteroid. The wall callback
  // sends each shield contact through the shared normal/friction solver so a
  // tangential impact changes the ship's angular velocity instead of only
  // reflecting its center-of-mass velocity.
  const ship = playerBody();
  advanceAndReflect(
    ship,
    "x",
    "velocityX",
    ship.velocityX * deltaTime,
    PLAYER_RADIUS,
    width - PLAYER_RADIUS,
    BOUNCINESS,
    (normal) => resolveShipWallContact(ship, normal),
  );
  advanceAndReflect(
    ship,
    "y",
    "velocityY",
    ship.velocityY * deltaTime,
    PLAYER_RADIUS,
    height - PLAYER_RADIUS,
    BOUNCINESS,
    (normal) => resolveShipWallContact(ship, normal),
  );
  applyPlayerBody(ship);

  updateBulletFiring(deltaTime);
  updateBullets(deltaTime);
  resolveBulletCollisions(width, height);
  resolveAsteroidCollisions();

  if (restartRequested) {
    beginShipFailure();
  } else if (asteroids.length === 0) {
    beginWin();
  }
}

function animate(frameTime) {
  updateFrameRate(frameTime);
  const deltaTime =
    previousFrameTime === undefined
      ? 0
      : Math.min((frameTime - previousFrameTime) / 1000, 0.1);
  previousFrameTime = frameTime;

  const width = viewportWidth;
  const height = viewportHeight;
  const gameplayHeight = gameplayHeightForViewport(height);
  generateAsteroids(width, gameplayHeight);
  if (shipFailureActive) {
    updateShipFailure(deltaTime, width, gameplayHeight);
  } else if (!gamePaused) {
    updateGame(deltaTime, width, gameplayHeight);
  }
  updateSparks(deltaTime);
  updateDisplayedStatusBars(deltaTime);
  updateDebugOutput(deltaTime);
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
  if (event.code === AUTOPILOT_TOGGLE_KEY && !event.repeat) {
    toggleAutopilot();
    event.preventDefault();
    return;
  }

  if (event.code === PAUSE_KEY && !event.repeat) {
    if (gameWon) {
      restartGame(viewportWidth, gameplayHeightForViewport(viewportHeight));
      gamePaused = false;
    } else if (!shipFailureActive) {
      gamePaused = !gamePaused;
      if (gamePaused) {
        // A pause freezes gameplay input as well as simulation time. Requiring
        // a fresh Space press after resuming avoids a held key firing
        // unexpectedly.
        clearPressedKeys();
        bulletCooldown = 0;
      }
    }

    event.preventDefault();
    return;
  }

  if (event.code === DEBUG_TOGGLE_KEY && !event.repeat) {
    debugEnabled = !debugEnabled;
    debugOutput.hidden = !debugEnabled;
    debugRefreshTimeRemaining = 0;
    event.preventDefault();
    return;
  }

  if (shipFailureActive) {
    event.preventDefault();
    return;
  }

  const controlKey = controlKeyForEvent(event);

  if (controlKey !== undefined) {
    event.preventDefault();

    disableAutopilotForManualInput();

    if (gamePaused) {
      return;
    }

    if (controlKey === FIRE_KEY && !event.repeat) {
      emitBullet();
      bulletCooldown = BULLET_FIRE_INTERVAL;
    }
    manualPressedKeys.add(controlKey);
    syncPressedKeys();
  }
});

document.addEventListener("keyup", (event) => {
  const controlKey = controlKeyForEvent(event);

  if (controlKey !== undefined) {
    manualPressedKeys.delete(controlKey);
    syncPressedKeys();
  }
});

window.addEventListener("blur", clearPressedKeys);

window.addEventListener("resize", resizeCanvas);
resizeCanvas();
window.requestAnimationFrame(animate);
