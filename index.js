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

const pressedKeys = new Set();
let playerAngle = -Math.PI / 2;
let playerSpeed = 0;
let playerX;
let playerY;
let previousFrameTime;

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
    playerX = Math.min(
      Math.max(playerX, PLAYER_RADIUS),
      width - PLAYER_RADIUS,
    );
    playerY = Math.min(
      Math.max(playerY, PLAYER_RADIUS),
      height - PLAYER_RADIUS,
    );
  }

  drawGame(width, height);
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
function updateGame(deltaTime) {
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

  const directionX = Math.cos(playerAngle);
  const directionY = Math.sin(playerAngle);
  const horizontalBounds = reflectPosition(
    playerX,
    directionX * playerSpeed * deltaTime,
    PLAYER_RADIUS,
    canvas.clientWidth - PLAYER_RADIUS,
  );
  const verticalBounds = reflectPosition(
    playerY,
    directionY * playerSpeed * deltaTime,
    PLAYER_RADIUS,
    canvas.clientHeight - PLAYER_RADIUS,
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

  updateGame(deltaTime);
  const { width, height } = canvas.getBoundingClientRect();
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
