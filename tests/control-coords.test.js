/**
 * @file control-coords.test.js
 * Unit tests for coordinate translation and letterbox/pillarbox calculation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateVideoRenderBox, translateScreenCoordinates } from '../src/public/js/control-coords.js';

test('control-coords — calculateVideoRenderBox with matching aspect ratio', () => {
  const box = calculateVideoRenderBox(1920, 1080, 1920, 1080);
  assert.equal(box.left, 0);
  assert.equal(box.top, 0);
  assert.equal(box.width, 1920);
  assert.equal(box.height, 1080);
});

test('control-coords — calculateVideoRenderBox letterbox (wider container than height aspect)', () => {
  // Container 1920x1080 (16:9), Video 1000x1000 (1:1) -> pillarboxed
  const boxPillar = calculateVideoRenderBox(1920, 1080, 1000, 1000);
  assert.equal(boxPillar.height, 1080);
  assert.equal(boxPillar.width, 1080);
  assert.equal(boxPillar.left, (1920 - 1080) / 2);
  assert.equal(boxPillar.top, 0);

  // Container 1000x1000 (1:1), Video 1920x1080 (16:9) -> letterboxed
  const boxLetter = calculateVideoRenderBox(1000, 1000, 1920, 1080);
  assert.equal(boxLetter.width, 1000);
  assert.equal(Math.round(boxLetter.height), Math.round(1000 / (16 / 9)));
  assert.ok(boxLetter.top > 0);
  assert.equal(boxLetter.left, 0);
});

test('control-coords — translateScreenCoordinates mapping and clamping', () => {
  const rect = { left: 100, top: 50, width: 800, height: 600 };
  const vidW = 1600;
  const vidH = 900; // 16:9

  // Center of element should be exactly (0.5, 0.5)
  const centerCoord = translateScreenCoordinates(100 + 400, 50 + 300, rect, vidW, vidH);
  assert.ok(centerCoord);
  assert.equal(Math.round(centerCoord.x * 100) / 100, 0.5);
  assert.equal(Math.round(centerCoord.y * 100) / 100, 0.5);

  // Click in black bar outside active video area
  const box = calculateVideoRenderBox(800, 600, vidW, vidH);
  // Top letterbox bar
  const outsideCoord = translateScreenCoordinates(100 + 400, 50 + 5, rect, vidW, vidH, false);
  assert.equal(outsideCoord, null);

  // With clampIfOutside = true
  const clampedCoord = translateScreenCoordinates(100 + 400, 50 + 5, rect, vidW, vidH, true);
  assert.ok(clampedCoord);
  assert.equal(clampedCoord.y, 0.0);
});
