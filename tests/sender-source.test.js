// Tests for source selection UI in sender.js using Node's built-in test runner

import { JSDOM } from 'jsdom';
import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';

let domInstance;

// Helper to create a minimal DOM required by sender.js
function setupDom() {
  const html = `<!DOCTYPE html>
    <html><head></head><body>
      <select id="sourceSelect">
        <option value="webcam">Webcam</option>
        <option value="screen">Screen share</option>
        <option value="file">Local File</option>
        <option value="url">Remote URL</option>
      </select>
      <div id="fileInputGroup"><input type="file" id="fileInput"/></div>
      <div id="urlInputGroup"><input type="text" id="urlInput"/></div>
      <div id="cameraSelectGroup"><select id="cameraSelect"></select></div>
      <select id="cameraResolution"></select>
      <button id="btnStart"></button>
      <video id="localVideo" autoplay muted></video>
      <div id="videoOverlay"></div>
      <div id="appWorkspace"></div>
    </body></html>`;
  domInstance = new JSDOM(html, { url: "http://localhost" });
  global.window = domInstance.window;
  global.document = domInstance.window.document;
  global.Event = domInstance.window.Event;
  global.HTMLVideoElement = domInstance.window.HTMLVideoElement;
}

describe('Sender source selection UI', () => {
  before(() => {
    setupDom();
    // Load the sender module after globals are set
    return import('../src/public/js/sender.js');
  });

  after(() => {
    if (domInstance && domInstance.window) {
      domInstance.window.close();
    }
  });

  test('Initial load hides both file and url groups when source is webcam by default', () => {
    const fileGroup = document.getElementById('fileInputGroup');
    const urlGroup = document.getElementById('urlInputGroup');
    const camGroup = document.getElementById('cameraSelectGroup');
    assert.strictEqual(fileGroup.style.display, 'none');
    assert.strictEqual(urlGroup.style.display, 'none');
    assert.strictEqual(camGroup.style.display, 'block');
  });

  test('Changing source to screen hides file and url groups, and hides cameraSelectGroup', () => {
    const sourceSelect = document.getElementById('sourceSelect');
    const fileGroup = document.getElementById('fileInputGroup');
    const urlGroup = document.getElementById('urlInputGroup');
    const camGroup = document.getElementById('cameraSelectGroup');
    sourceSelect.value = 'screen';
    sourceSelect.dispatchEvent(new Event('change'));
    assert.strictEqual(fileGroup.style.display, 'none');
    assert.strictEqual(urlGroup.style.display, 'none');
    assert.strictEqual(camGroup.style.display, 'none');
  });

  test('Changing source to file shows file input group and hides cameraSelectGroup', () => {
    const sourceSelect = document.getElementById('sourceSelect');
    const fileGroup = document.getElementById('fileInputGroup');
    const urlGroup = document.getElementById('urlInputGroup');
    const camGroup = document.getElementById('cameraSelectGroup');
    sourceSelect.value = 'file';
    sourceSelect.dispatchEvent(new Event('change'));
    assert.strictEqual(fileGroup.style.display, 'block');
    assert.strictEqual(urlGroup.style.display, 'none');
    assert.strictEqual(camGroup.style.display, 'none');
  });

  test('Changing source to url shows url input group and hides cameraSelectGroup', () => {
    const sourceSelect = document.getElementById('sourceSelect');
    const fileGroup = document.getElementById('fileInputGroup');
    const urlGroup = document.getElementById('urlInputGroup');
    const camGroup = document.getElementById('cameraSelectGroup');
    sourceSelect.value = 'url';
    sourceSelect.dispatchEvent(new Event('change'));
    assert.strictEqual(fileGroup.style.display, 'none');
    assert.strictEqual(urlGroup.style.display, 'block');
    assert.strictEqual(camGroup.style.display, 'none');
  });

  test('Changing source to webcam hides both file and url groups and shows cameraSelectGroup', () => {
    const sourceSelect = document.getElementById('sourceSelect');
    const fileGroup = document.getElementById('fileInputGroup');
    const urlGroup = document.getElementById('urlInputGroup');
    const camGroup = document.getElementById('cameraSelectGroup');
    sourceSelect.value = 'webcam';
    sourceSelect.dispatchEvent(new Event('change'));
    assert.strictEqual(fileGroup.style.display, 'none');
    assert.strictEqual(urlGroup.style.display, 'none');
    assert.strictEqual(camGroup.style.display, 'block');
  });
});
