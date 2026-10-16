/**
 * @file control-coords.js
 * Normalized screen coordinate translation accounting for letterbox/pillarbox display scaling.
 * Strictly adheres to AGENTS.md conventions (explicit types, no var).
 */

/**
 * Calculate the rendered video content rectangle inside a container with object-fit: contain.
 * @param {number} containerWidth
 * @param {number} containerHeight
 * @param {number} videoWidth
 * @param {number} videoHeight
 * @returns {{ left: number, top: number, width: number, height: number }}
 */
export function calculateVideoRenderBox(containerWidth, containerHeight, videoWidth, videoHeight) {
  if (!containerWidth || !containerHeight || !videoWidth || !videoHeight) {
    return {
      left: 0,
      top: 0,
      width: Math.max(0, containerWidth || 0),
      height: Math.max(0, containerHeight || 0)
    };
  }

  const containerRatio = containerWidth / containerHeight;
  const videoRatio = videoWidth / videoHeight;

  let renderWidth = containerWidth;
  let renderHeight = containerHeight;
  let left = 0;
  let top = 0;

  if (containerRatio > videoRatio) {
    // Pillarboxed (black bars left and right)
    renderWidth = containerHeight * videoRatio;
    left = (containerWidth - renderWidth) / 2;
  } else {
    // Letterboxed (black bars top and bottom)
    renderHeight = containerWidth / videoRatio;
    top = (containerHeight - renderHeight) / 2;
  }

  return {
    left,
    top,
    width: renderWidth,
    height: renderHeight
  };
}

/**
 * Translate client coordinates (from mouse event) into normalized (0.0 to 1.0) coordinates.
 * @param {number} clientX
 * @param {number} clientY
 * @param {{ left: number, top: number, width: number, height: number }} boundingRect
 * @param {number} videoWidth
 * @param {number} videoHeight
 * @param {boolean} [clampIfOutside=false]
 * @returns {{ x: number, y: number }|null}
 */
export function translateScreenCoordinates(clientX, clientY, boundingRect, videoWidth, videoHeight, clampIfOutside = false) {
  if (!boundingRect || boundingRect.width <= 0 || boundingRect.height <= 0) {
    return null;
  }

  const clickX = clientX - boundingRect.left;
  const clickY = clientY - boundingRect.top;

  const box = calculateVideoRenderBox(boundingRect.width, boundingRect.height, videoWidth, videoHeight);
  if (box.width <= 0 || box.height <= 0) {
    return null;
  }

  // Check if click is inside the rendered video area
  const isInside = clickX >= box.left && clickX <= box.left + box.width &&
                   clickY >= box.top && clickY <= box.top + box.height;

  if (!isInside && !clampIfOutside) {
    return null;
  }

  const relativeX = clickX - box.left;
  const relativeY = clickY - box.top;

  const normX = Math.max(0, Math.min(1, relativeX / box.width));
  const normY = Math.max(0, Math.min(1, relativeY / box.height));

  return { x: normX, y: normY };
}
