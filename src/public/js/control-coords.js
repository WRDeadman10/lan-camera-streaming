/**
 * @file control-coords.js
 * Normalized screen coordinate translation accounting for letterbox/pillarbox display scaling,
 * zoom scale factors, and panning translation offsets.
 * Strictly adheres to AGENTS.md conventions (explicit types, no var, K&R braces).
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
 * Translate client coordinates (from touch or mouse event) into normalized (0.0 to 1.0) desktop coordinates.
 * Inverts the display render box, zoom scale, and pan offset.
 *
 * @param {number} clientX
 * @param {number} clientY
 * @param {{ left: number, top: number, width: number, height: number }} boundingRect
 * @param {number} videoWidth
 * @param {number} videoHeight
 * @param {boolean} [clampIfOutside=false]
 * @param {number} [zoomScale=1.0]
 * @param {number} [panX=0]
 * @param {number} [panY=0]
 * @returns {{ x: number, y: number }|null}
 */
export function translateScreenCoordinates(
  clientX,
  clientY,
  boundingRect,
  videoWidth,
  videoHeight,
  clampIfOutside = false,
  zoomScale = 1.0,
  panX = 0,
  panY = 0
) {
  if (!boundingRect || boundingRect.width <= 0 || boundingRect.height <= 0) {
    return null;
  }

  const box = calculateVideoRenderBox(boundingRect.width, boundingRect.height, videoWidth, videoHeight);
  if (box.width <= 0 || box.height <= 0) {
    return null;
  }

  const clickRelX = clientX - boundingRect.left;
  const clickRelY = clientY - boundingRect.top;

  const effectiveScale = zoomScale > 0 ? zoomScale : 1.0;
  const effectivePanX = panX || 0;
  const effectivePanY = panY || 0;

  // Center of the unzoomed render box relative to container top-left
  const boxCenterX = box.left + box.width / 2;
  const boxCenterY = box.top + box.height / 2;

  // Invert the CSS transform: translate(panX, panY) scale(effectiveScale) with transform-origin: center center
  const contentRelX = (clickRelX - boxCenterX - effectivePanX) / effectiveScale + boxCenterX;
  const contentRelY = (clickRelY - boxCenterY - effectivePanY) / effectiveScale + boxCenterY;

  // Offset relative to top-left of unzoomed render box
  const relativeX = contentRelX - box.left;
  const relativeY = contentRelY - box.top;

  const isInside = relativeX >= 0 && relativeX <= box.width &&
                   relativeY >= 0 && relativeY <= box.height;

  if (!isInside && !clampIfOutside) {
    return null;
  }

  const normX = Math.max(0, Math.min(1, relativeX / box.width));
  const normY = Math.max(0, Math.min(1, relativeY / box.height));

  return { x: normX, y: normY };
}

/**
 * Calculate client and container-relative coordinates from normalized desktop coordinates.
 * Applies the display render box, zoom scale, and pan offset.
 *
 * @param {number} normX
 * @param {number} normY
 * @param {{ left: number, top: number, width: number, height: number }} boundingRect
 * @param {number} videoWidth
 * @param {number} videoHeight
 * @param {number} [zoomScale=1.0]
 * @param {number} [panX=0]
 * @param {number} [panY=0]
 * @returns {{ clientX: number, clientY: number, screenRelX: number, screenRelY: number }|null}
 */
export function getScreenCoordinatesFromNormalized(
  normX,
  normY,
  boundingRect,
  videoWidth,
  videoHeight,
  zoomScale = 1.0,
  panX = 0,
  panY = 0
) {
  if (!boundingRect || boundingRect.width <= 0 || boundingRect.height <= 0) {
    return null;
  }

  const box = calculateVideoRenderBox(boundingRect.width, boundingRect.height, videoWidth, videoHeight);
  if (box.width <= 0 || box.height <= 0) {
    return null;
  }

  const clampedX = Math.max(0, Math.min(1, normX));
  const clampedY = Math.max(0, Math.min(1, normY));

  const contentRelX = box.left + clampedX * box.width;
  const contentRelY = box.top + clampedY * box.height;

  const effectiveScale = zoomScale > 0 ? zoomScale : 1.0;
  const effectivePanX = panX || 0;
  const effectivePanY = panY || 0;

  const boxCenterX = box.left + box.width / 2;
  const boxCenterY = box.top + box.height / 2;

  // Apply CSS transform: translate(panX, panY) scale(effectiveScale)
  const screenRelX = boxCenterX + effectivePanX + (contentRelX - boxCenterX) * effectiveScale;
  const screenRelY = boxCenterY + effectivePanY + (contentRelY - boxCenterY) * effectiveScale;

  const clientX = boundingRect.left + screenRelX;
  const clientY = boundingRect.top + screenRelY;

  return {
    clientX,
    clientY,
    screenRelX,
    screenRelY
  };
}
