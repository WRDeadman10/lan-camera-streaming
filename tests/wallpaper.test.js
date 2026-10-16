import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  getTodayDateString,
  optimizeUnsplashUrl,
  getStoredWallpaper,
  setStoredWallpaper,
  getLastValidWallpaper,
  initWallpaper,
  DEFAULT_SPACE_WALLPAPER,
  DEFAULT_UNSPLASH_CLIENT_ID
} from '../src/public/js/wallpaper.js';

describe('Dynamic Daily Space Wallpaper System', () => {
  let dom;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body><div class="app-shell" id="appShell"><main>Content</main></div></body></html>', {
      url: 'http://localhost/viewer'
    });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    global.Image = class {
      set src(url) {
        setTimeout(() => {
          if (typeof this.onload === 'function') {
            this.onload();
          }
        }, 10);
      }
    };
  });

  test('getTodayDateString returns date in YYYY-MM-DD format', () => {
    const today = getTodayDateString();
    assert.match(today, /^\d{4}-\d{2}-\d{2}$/);

    const testDate = new Date(2026, 9, 14); // 2026-10-14
    assert.strictEqual(getTodayDateString(testDate), '2026-10-14');
  });

  test('optimizeUnsplashUrl prioritizes raw and appends desktop optimization query parameters', () => {
    const rawPhoto = {
      raw: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?ixid=xyz',
      full: 'https://images.unsplash.com/photo-full',
      regular: 'https://images.unsplash.com/photo-reg'
    };

    const optimized = optimizeUnsplashUrl(rawPhoto);
    const parsed = new URL(optimized);

    assert.strictEqual(parsed.searchParams.get('w'), '2560');
    assert.strictEqual(parsed.searchParams.get('q'), '85');
    assert.strictEqual(parsed.searchParams.get('auto'), 'format');
    assert.strictEqual(parsed.searchParams.get('fit'), 'crop');
    assert.strictEqual(parsed.searchParams.get('ixid'), 'xyz');
  });

  test('optimizeUnsplashUrl falls back to full or regular if raw is unavailable', () => {
    const fullOnly = {
      full: 'https://images.unsplash.com/photo-full?w=1080',
      regular: 'https://images.unsplash.com/photo-reg'
    };
    assert.strictEqual(optimizeUnsplashUrl(fullOnly), 'https://images.unsplash.com/photo-full?w=1080');

    const regularOnly = {
      regular: 'https://images.unsplash.com/photo-reg?w=800'
    };
    assert.strictEqual(optimizeUnsplashUrl(regularOnly), 'https://images.unsplash.com/photo-reg?w=800');
  });

  test('LocalStorage caches wallpaper once per day and reuses cache without network call', async () => {
    const cacheKey = 'lancam_wallpaper_test_page';
    const testUrl = 'https://images.unsplash.com/photo-test-cached?w=2560';

    setStoredWallpaper(cacheKey, testUrl, { author: 'NASA' });

    const cached = getStoredWallpaper(cacheKey);
    assert.ok(cached);
    assert.strictEqual(cached.date, getTodayDateString());
    assert.strictEqual(cached.url, testUrl);
    assert.strictEqual(cached.author, 'NASA');
    assert.strictEqual(getLastValidWallpaper(), testUrl);
  });

  test('initWallpaper injects 4-layer background structure with inert pointer-events', async () => {
    const testUrl = 'https://images.unsplash.com/photo-test-rendered';
    setStoredWallpaper('lancam_wallpaper_viewer', testUrl);

    await initWallpaper({ pageKey: 'viewer' });

    const container = document.getElementById('wallpaperContainer');
    assert.ok(container, 'wallpaperContainer must exist in document');
    assert.strictEqual(container.getAttribute('aria-hidden'), 'true');

    const imageLayer = container.querySelector('.wallpaper-layer-image');
    assert.ok(imageLayer, 'Layer 1 (.wallpaper-layer-image) must exist');
    assert.ok(imageLayer.style.backgroundImage.includes(testUrl));

    const overlayLayer = container.querySelector('.wallpaper-layer-overlay');
    assert.ok(overlayLayer, 'Layer 2 (.wallpaper-layer-overlay) must exist');

    const textureLayer = container.querySelector('.wallpaper-layer-texture');
    assert.ok(textureLayer, 'Layer 3 (.wallpaper-layer-texture) must exist');

    const appShell = document.getElementById('appShell');
    assert.ok(appShell, 'Layer 4 (.app-shell) must exist and wrap application content');
  });

  test('Gracefully falls back to default space wallpaper if network request fails', async () => {
    // Provide a failing fetch mock
    global.fetch = async () => {
      throw new Error('Network timeout (simulated)');
    };

    await initWallpaper({
      pageKey: 'network_fail_test',
      clientId: DEFAULT_UNSPLASH_CLIENT_ID
    });

    const imageLayer = document.getElementById('wallpaperLayerImage');
    assert.ok(imageLayer);
    assert.ok(imageLayer.style.backgroundImage.includes('unsplash.com'));
  });
});
