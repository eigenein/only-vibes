const canvas = document.querySelector("#game-canvas");

/**
 * The first iteration intentionally renders nothing. Keeping the canvas
 * transparent gives the next gameplay step a clean surface to build on.
 *
 * The drawing buffer follows the displayed size and device pixel ratio so
 * future shapes remain sharp on both standard and high-density displays.
 */
function resizeCanvas() {
  const { width, height } = canvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;

  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();
