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

const pressedKeys = new Set();
let playerAngle = -Math.PI / 2;
let previousFrameTime;

/**
 * The drawing buffer follows the displayed size and device pixel ratio so
 */
function resizeCanvas() {
  const { width, height } = canvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;

  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawGame(width, height);
}

/**
 * Draw the black space and the player at the centre of the field.
 * The triangle points upward and has its tip and base endpoints on the hull's
 * circumference. Its base chord is intentionally shorter than its sides so
 * the tip communicates the ship's direction without extra UI.
 */
function drawGame(width, height) {
  const centerX = width / 2;
  const centerY = height / 2;
  const triangleTipAngle = playerAngle;
  const triangleBaseCenterAngle = triangleTipAngle + Math.PI;
  const baseLeftAngle =
    triangleBaseCenterAngle - PLAYER_TRIANGLE_HALF_ANGLE;
  const baseRightAngle =
    triangleBaseCenterAngle + PLAYER_TRIANGLE_HALF_ANGLE;

  context.fillStyle = "#000";
  context.fillRect(0, 0, width, height);

  // The circle remains unfilled so the black space is visible inside the hull.
  context.beginPath();
  context.arc(centerX, centerY, PLAYER_RADIUS, 0, Math.PI * 2);
  context.strokeStyle = "#fff";
  context.lineWidth = 2;
  context.stroke();

  const pointOnHull = (angle) => ({
    x: centerX + Math.cos(angle) * PLAYER_RADIUS,
    y: centerY + Math.sin(angle) * PLAYER_RADIUS,
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
 * Rotate while a steering key is held. Time-based motion prevents the ship
 * from turning faster on high-refresh-rate displays.
 */
function updateGame(deltaTime) {
  const turnsCounterClockwise =
    pressedKeys.has("ArrowLeft") || pressedKeys.has("KeyA");
  const turnsClockwise =
    pressedKeys.has("ArrowRight") || pressedKeys.has("KeyD");
  const rotationDirection =
    Number(turnsClockwise) - Number(turnsCounterClockwise);

  playerAngle += rotationDirection * ROTATION_SPEED * deltaTime;
}

function animate(frameTime) {
  const deltaTime =
    previousFrameTime === undefined
      ? 0
      : Math.min((frameTime - previousFrameTime) / 1000, 0.1);
  previousFrameTime = frameTime;

  updateGame(deltaTime);
  const { width, height } = canvas.getBoundingClientRect();
  drawGame(width, height);
  window.requestAnimationFrame(animate);
}

document.addEventListener("keydown", (event) => {
  if (
    event.key === "ArrowLeft" ||
    event.key === "ArrowRight" ||
    event.code === "KeyA" ||
    event.code === "KeyD"
  ) {
    event.preventDefault();
    pressedKeys.add(event.key.startsWith("Arrow") ? event.key : event.code);
  }
});

document.addEventListener("keyup", (event) => {
  pressedKeys.delete(event.key.startsWith("Arrow") ? event.key : event.code);
});

window.addEventListener("blur", () => pressedKeys.clear());

window.addEventListener("resize", resizeCanvas);
resizeCanvas();
window.requestAnimationFrame(animate);
