import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  calculateVideoRenderBox,
  translateScreenCoordinates,
  getScreenCoordinatesFromNormalized
} from '../src/public/js/control-coords.js';
import { ZoomController } from '../src/public/js/zoom-controller.js';

describe('Universal Zoom and Coordinate Mapping Verification', () => {
  const containerRect = {
    left: 100,
    top: 50,
    width: 1920,
    height: 1080
  };
  const videoWidth = 1920;
  const videoHeight = 1080;

  test('calculateVideoRenderBox correctly determines letterbox and pillarbox boundaries', () => {
    // 16:9 in 16:9 container -> exact fit
    const exact = calculateVideoRenderBox(1920, 1080, 1920, 1080);
    assert.strictEqual(exact.left, 0);
    assert.strictEqual(exact.top, 0);
    assert.strictEqual(exact.width, 1920);
    assert.strictEqual(exact.height, 1080);

    // Letterbox: 16:9 container showing 4:3 video (1440x1080)
    const letterbox = calculateVideoRenderBox(1920, 1080, 1440, 1080);
    assert.strictEqual(letterbox.top, 0);
    assert.strictEqual(letterbox.height, 1080);
    assert.strictEqual(letterbox.width, 1440);
    assert.strictEqual(letterbox.left, 240); // (1920 - 1440) / 2

    // Pillarbox: 1000x1000 container showing 16:9 video (1920x1080)
    const pillarbox = calculateVideoRenderBox(1000, 1000, 1920, 1080);
    assert.strictEqual(pillarbox.left, 0);
    assert.strictEqual(pillarbox.width, 1000);
    assert.strictEqual(Math.round(pillarbox.height), 563);
    assert.strictEqual(Math.round(pillarbox.top), 219);
  });

  test('translateScreenCoordinates maps unzoomed coordinates accurately', () => {
    // Center of container
    const center = translateScreenCoordinates(
      containerRect.left + 960,
      containerRect.top + 540,
      containerRect,
      videoWidth,
      videoHeight,
      false,
      1.0,
      0,
      0
    );
    assert.ok(center);
    assert.strictEqual(Math.round(center.x * 1000) / 1000, 0.5);
    assert.strictEqual(Math.round(center.y * 1000) / 1000, 0.5);

    // Top-left corner
    const topLeft = translateScreenCoordinates(
      containerRect.left,
      containerRect.top,
      containerRect,
      videoWidth,
      videoHeight,
      false,
      1.0,
      0,
      0
    );
    assert.ok(topLeft);
    assert.strictEqual(topLeft.x, 0);
    assert.strictEqual(topLeft.y, 0);

    // Bottom-right corner
    const bottomRight = translateScreenCoordinates(
      containerRect.left + 1920,
      containerRect.top + 1080,
      containerRect,
      videoWidth,
      videoHeight,
      false,
      1.0,
      0,
      0
    );
    assert.ok(bottomRight);
    assert.strictEqual(bottomRight.x, 1);
    assert.strictEqual(bottomRight.y, 1);
  });

  test('translateScreenCoordinates accurately inverts zoom scale and pan offset', () => {
    const scale = 2.0;
    const panX = 100;
    const panY = -50;

    // The center of the content was initially at container center (960, 540).
    // With panX = 100, panY = -50, the center of the content is displayed at (960 + 100, 540 - 50) = (1060, 490).
    const centerClick = translateScreenCoordinates(
      containerRect.left + 1060,
      containerRect.top + 490,
      containerRect,
      videoWidth,
      videoHeight,
      false,
      scale,
      panX,
      panY
    );
    assert.ok(centerClick);
    assert.strictEqual(Math.round(centerClick.x * 1000) / 1000, 0.5);
    assert.strictEqual(Math.round(centerClick.y * 1000) / 1000, 0.5);
  });

  test('Round-trip coordinate fidelity between screen and normalized coordinates', () => {
    const testCases = [
      { normX: 0.1, normY: 0.1, scale: 1.0, panX: 0, panY: 0 },
      { normX: 0.5, normY: 0.5, scale: 1.0, panX: 0, panY: 0 },
      { normX: 0.9, normY: 0.9, scale: 1.0, panX: 0, panY: 0 },
      { normX: 0.5, normY: 0.5, scale: 2.0, panX: 0, panY: 0 },
      { normX: 0.3, normY: 0.7, scale: 2.5, panX: 120, panY: -80 },
      { normX: 0.8, normY: 0.2, scale: 4.0, panX: -200, panY: 150 }
    ];

    for (const tc of testCases) {
      const screenPos = getScreenCoordinatesFromNormalized(
        tc.normX,
        tc.normY,
        containerRect,
        videoWidth,
        videoHeight,
        tc.scale,
        tc.panX,
        tc.panY
      );
      assert.ok(screenPos, `screenPos must not be null for scale=${tc.scale}`);

      const roundTrip = translateScreenCoordinates(
        screenPos.clientX,
        screenPos.clientY,
        containerRect,
        videoWidth,
        videoHeight,
        true,
        tc.scale,
        tc.panX,
        tc.panY
      );
      assert.ok(roundTrip, `roundTrip must not be null for scale=${tc.scale}`);

      assert.ok(
        Math.abs(roundTrip.x - tc.normX) < 0.0001,
        `X mismatch for scale ${tc.scale}: expected ${tc.normX}, got ${roundTrip.x}`
      );
      assert.ok(
        Math.abs(roundTrip.y - tc.normY) < 0.0001,
        `Y mismatch for scale ${tc.scale}: expected ${tc.normY}, got ${roundTrip.y}`
      );
    }
  });

  test('ZoomController manages zoom lifecycle, clamping, and CSS transforms', () => {
    const dom = new JSDOM('<div id="container" style="width: 800px; height: 600px;"><video id="video"></video></div>');
    const container = dom.window.document.getElementById('container');
    const video = dom.window.document.getElementById('video');

    let reportedState = null;
    const controller = new ZoomController(container, video, {
      minScale: 1.0,
      maxScale: 4.0,
      onZoomChange: (state) => {
        reportedState = state;
      }
    });

    // Initial state: Fit Screen
    assert.strictEqual(controller.scale, 1.0);
    assert.strictEqual(controller.panX, 0);
    assert.strictEqual(controller.panY, 0);

    // Zoom in
    controller.zoomIn(1.5);
    assert.strictEqual(controller.scale, 1.5);
    assert.ok(video.style.transform.includes('scale(1.5000)'));
    assert.ok(reportedState);
    assert.strictEqual(reportedState.scale, 1.5);

    // Zoom out back to 1.0
    controller.zoomOut(1.5);
    assert.strictEqual(controller.scale, 1.0);
    assert.strictEqual(controller.panX, 0);
    assert.strictEqual(controller.panY, 0);

    // Pan when scale > 1
    controller.setZoom(2.0);
    controller.panBy(50, -30);
    assert.strictEqual(controller.scale, 2.0);
    assert.strictEqual(controller.panX, 50);
    assert.strictEqual(controller.panY, -30);
    assert.ok(video.style.transform.includes('translate(50.00px, -30.00px)'));
    assert.ok(video.style.transform.includes('scale(2.0000)'));

    // Reset zoom returns to 1.0 and 0,0
    controller.resetZoom();
    assert.strictEqual(controller.scale, 1.0);
    assert.strictEqual(controller.panX, 0);
    assert.strictEqual(controller.panY, 0);

    // Scale cannot exceed maxScale
    controller.setZoom(10.0);
    assert.strictEqual(controller.scale, 4.0);
  });
});
