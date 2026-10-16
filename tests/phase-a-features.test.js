import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUrlStreamParams, buildShareUrl, StreamTransformController } from '../src/public/js/ui-utils.js';

test('parseUrlStreamParams parses query parameters correctly', () => {
  // Mock window.location
  const originalLocation = global.window ? global.window.location : null;
  global.window = {
    location: {
      search: '?room=room42&pin=998877&mode=tunnel-relay&autostart=1',
      origin: 'http://localhost:3000'
    }
  };

  const params = parseUrlStreamParams();
  assert.equal(params.roomId, 'room42');
  assert.equal(params.pin, '998877');
  assert.equal(params.mode, 'tunnel-relay');
  assert.equal(params.autostart, true);

  if (originalLocation) {
    global.window.location = originalLocation;
  }
});

test('buildShareUrl builds full URL with target path, room, pin and autostart', () => {
  global.window = {
    location: {
      origin: 'http://192.168.1.50:7777'
    }
  };

  const shareUrl = buildShareUrl('/viewer', {
    roomId: 'test-room',
    pin: '123456',
    autostart: true
  });

  const parsed = new URL(shareUrl);
  assert.equal(parsed.pathname, '/viewer');
  assert.equal(parsed.searchParams.get('room'), 'test-room');
  assert.equal(parsed.searchParams.get('pin'), '123456');
  assert.equal(parsed.searchParams.get('autostart'), '1');
});

test('StreamTransformController manages mirror, rotation and grid states', () => {
  const dummyVideo = { style: { transform: '' } };
  const dummyGrid = {
    classList: {
      classes: new Set(),
      add(c) { this.classes.add(c); },
      remove(c) { this.classes.delete(c); },
      contains(c) { return this.classes.has(c); }
    }
  };

  const controller = new StreamTransformController(dummyVideo, dummyGrid);

  // Mirror test
  assert.equal(controller.isMirrored, false);
  const m1 = controller.toggleMirror();
  assert.equal(m1, true);
  assert.equal(dummyVideo.style.transform, 'scaleX(-1)');

  // Rotation test
  const r1 = controller.rotate();
  assert.equal(r1, 90);
  assert.equal(dummyVideo.style.transform, 'rotate(90deg) scaleX(-1)');

  const r2 = controller.rotate();
  assert.equal(r2, 180);
  assert.equal(dummyVideo.style.transform, 'rotate(180deg) scaleX(-1)');

  // Grid test
  assert.equal(controller.isGridVisible, false);
  const g1 = controller.toggleGrid();
  assert.equal(g1, true);
  assert.equal(dummyGrid.classList.contains('active'), true);
  const g2 = controller.toggleGrid();
  assert.equal(g2, false);
  assert.equal(dummyGrid.classList.contains('active'), false);
});
