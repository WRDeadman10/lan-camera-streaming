/**
 * @file mdns-detector.test.js
 * Unit test suite for WebRTC mDNS local IP concealment detector and browser guidance.
 * Strictly adheres to AGENTS.md conventions.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  detectBrowserFlagInfo,
  isWindowsPlatform,
  isPrivateIpv4,
  probeMdnsLocalIpHiding,
  setupMdnsWarningAndGuidance
} from '../src/public/js/mdns-detector.js';

describe('WebRTC mDNS Local IP Detector and Browser Guidance', () => {
  test('detectBrowserFlagInfo identifies Comet browser and formats comet://flags URL', () => {
    const cometUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Comet/1.2.0';
    const info = detectBrowserFlagInfo(cometUa);

    assert.strictEqual(info.browserName, 'Comet');
    assert.strictEqual(info.flagScheme, 'comet');
    assert.strictEqual(info.flagUrl, 'comet://flags/#enable-webrtc-hide-local-ips-with-mdns');
    assert.strictEqual(info.flagId, 'enable-webrtc-hide-local-ips-with-mdns');
    assert.strictEqual(info.flagSettingName, 'Anonymize local IPs exposed by WebRTC');
    assert.strictEqual(info.recommendedValue, 'Disabled');
  });

  test('detectBrowserFlagInfo identifies various Chromium browsers with their respective flag schemes', () => {
    // 1. Microsoft Edge
    const edgeUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
    const edgeInfo = detectBrowserFlagInfo(edgeUa);
    assert.strictEqual(edgeInfo.browserName, 'Microsoft Edge');
    assert.strictEqual(edgeInfo.flagScheme, 'edge');
    assert.strictEqual(edgeInfo.flagUrl, 'edge://flags/#enable-webrtc-hide-local-ips-with-mdns');

    // 2. Brave Browser
    const braveNav = { brave: { isBrave: () => Promise.resolve(true) } };
    const braveInfo = detectBrowserFlagInfo('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0', braveNav);
    assert.strictEqual(braveInfo.browserName, 'Brave');
    assert.strictEqual(braveInfo.flagScheme, 'brave');
    assert.strictEqual(braveInfo.flagUrl, 'brave://flags/#enable-webrtc-hide-local-ips-with-mdns');

    // 3. Opera / Opera GX
    const operaUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/114.0.0.0';
    const operaInfo = detectBrowserFlagInfo(operaUa);
    assert.strictEqual(operaInfo.browserName, 'Opera');
    assert.strictEqual(operaInfo.flagScheme, 'opera');
    assert.strictEqual(operaInfo.flagUrl, 'opera://flags/#enable-webrtc-hide-local-ips-with-mdns');

    // 4. Vivaldi
    const vivaldiUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Vivaldi/7.0.3495.29';
    const vivaldiInfo = detectBrowserFlagInfo(vivaldiUa);
    assert.strictEqual(vivaldiInfo.browserName, 'Vivaldi');
    assert.strictEqual(vivaldiInfo.flagScheme, 'vivaldi');

    // 5. Yandex
    const yandexUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 YaBrowser/24.10.0.0';
    const yandexInfo = detectBrowserFlagInfo(yandexUa);
    assert.strictEqual(yandexInfo.browserName, 'Yandex');
    assert.strictEqual(yandexInfo.flagScheme, 'ybrowser');

    // 6. Arc
    const arcUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Arc/1.65.0';
    const arcInfo = detectBrowserFlagInfo(arcUa);
    assert.strictEqual(arcInfo.browserName, 'Arc');
    assert.strictEqual(arcInfo.flagScheme, 'arc');

    // 7. Google Chrome / Standard Chromium fallback
    const chromeUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
    const chromeInfo = detectBrowserFlagInfo(chromeUa);
    assert.strictEqual(chromeInfo.browserName, 'Chrome');
    assert.strictEqual(chromeInfo.flagScheme, 'chrome');
    assert.strictEqual(chromeInfo.flagUrl, 'chrome://flags/#enable-webrtc-hide-local-ips-with-mdns');
  });

  test('isWindowsPlatform detects Windows OS accurately', () => {
    // Windows via userAgentData
    assert.strictEqual(isWindowsPlatform({ userAgentData: { platform: 'Windows' } }), true);

    // Windows via navigator.platform
    assert.strictEqual(isWindowsPlatform({ platform: 'Win32', userAgent: '' }), true);
    assert.strictEqual(isWindowsPlatform({ platform: 'Win64', userAgent: '' }), true);

    // Windows via userAgent
    assert.strictEqual(isWindowsPlatform({ platform: '', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }), true);

    // Non-Windows platforms
    assert.strictEqual(isWindowsPlatform({ platform: 'MacIntel', userAgent: 'Macintosh; Intel Mac OS X 10_15_7' }), false);
    assert.strictEqual(isWindowsPlatform({ platform: 'Linux x86_64', userAgent: 'X11; Ubuntu; Linux x86_64' }), false);
    assert.strictEqual(isWindowsPlatform({ platform: 'Linux armv81', userAgent: 'Android 14; Pixel 8' }), false);
  });

  test('isPrivateIpv4 correctly categorizes IP addresses', () => {
    assert.strictEqual(isPrivateIpv4('192.168.1.100'), true);
    assert.strictEqual(isPrivateIpv4('10.0.2.15'), true);
    assert.strictEqual(isPrivateIpv4('172.16.5.20'), true);
    assert.strictEqual(isPrivateIpv4('172.31.255.254'), true);
    assert.strictEqual(isPrivateIpv4('127.0.0.1'), true);

    // Non-private addresses
    assert.strictEqual(isPrivateIpv4('8.8.8.8'), false);
    assert.strictEqual(isPrivateIpv4('1.1.1.1'), false);
    assert.strictEqual(isPrivateIpv4('2606:4700:4700::1111'), false);
    assert.strictEqual(isPrivateIpv4('9b2d86f7-b3db-4cb8-8f83-e07e868c227d.local'), false);
  });

  test('probeMdnsLocalIpHiding detects mDNS host candidate concealment', async () => {
    // Mock RTCPeerConnection gathering an mDNS host candidate
    class MockMdnsPeerConnection {
      constructor() {
        this.onicecandidate = null;
      }
      createDataChannel() {}
      createOffer() {
        return Promise.resolve({ type: 'offer', sdp: 'v=0...' });
      }
      setLocalDescription() {
        setTimeout(() => {
          if (typeof this.onicecandidate === 'function') {
            this.onicecandidate({
              candidate: {
                candidate: 'candidate:1 1 udp 2122260223 9b2d86f7-b3db-4cb8-8f83-e07e868c227d.local 58342 typ host generation 0',
                type: 'host',
                address: '9b2d86f7-b3db-4cb8-8f83-e07e868c227d.local'
              }
            });
            this.onicecandidate(null); // End of candidates
          }
        }, 10);
        return Promise.resolve();
      }
      close() {}
    }

    const result = await probeMdnsLocalIpHiding({
      RTCPeerConnectionClass: MockMdnsPeerConnection,
      timeoutMs: 500
    });

    assert.strictEqual(result.isSupported, true);
    assert.strictEqual(result.isHiding, true);
    assert.strictEqual(result.hasMdnsCandidate, true);
    assert.strictEqual(result.hasPrivateIpv4, false);
  });

  test('probeMdnsLocalIpHiding detects unmasked local IPv4 host candidate (flag disabled)', async () => {
    // Mock RTCPeerConnection gathering a real private LAN IPv4 candidate
    class MockUnmaskedPeerConnection {
      constructor() {
        this.onicecandidate = null;
      }
      createDataChannel() {}
      createOffer() {
        return Promise.resolve({ type: 'offer', sdp: 'v=0...' });
      }
      setLocalDescription() {
        setTimeout(() => {
          if (typeof this.onicecandidate === 'function') {
            this.onicecandidate({
              candidate: {
                candidate: 'candidate:1 1 udp 2122260223 192.168.1.150 58342 typ host generation 0',
                type: 'host',
                address: '192.168.1.150'
              }
            });
            this.onicecandidate(null);
          }
        }, 10);
        return Promise.resolve();
      }
      close() {}
    }

    const result = await probeMdnsLocalIpHiding({
      RTCPeerConnectionClass: MockUnmaskedPeerConnection,
      timeoutMs: 500
    });

    assert.strictEqual(result.isSupported, true);
    assert.strictEqual(result.isHiding, false);
    assert.strictEqual(result.hasPrivateIpv4, true);
  });

  test('setupMdnsWarningAndGuidance wires DOM elements and interactions', () => {
    const dom = new JSDOM(`
      <div id="mdnsWarningBanner" style="display: none;">
        <span id="mdnsDetectedBrowser">Browser</span>
        <button id="btnCopyMdnsFlag">Copy Flag</button>
        <button id="btnOpenMdnsGuide">Guide</button>
        <button id="btnDismissMdnsBanner">Dismiss</button>
      </div>
      <div id="mdnsGuidanceModal" style="display: none;">
        <span id="mdnsModalBrowserBadge"></span>
        <span id="mdnsFlagUrlDisplay"></span>
        <button id="btnCloseMdnsModal"></button>
        <button id="btnCancelMdnsModal"></button>
        <button id="btnModalCopyMdnsFlag">Copy</button>
        <button id="btnModalRetestMdns">Retest</button>
        <div id="mdnsModalStatus"></div>
      </div>
    `, { url: 'http://localhost/' });

    const doc = dom.window.document;
    const banner = doc.getElementById('mdnsWarningBanner');
    const modal = doc.getElementById('mdnsGuidanceModal');
    const btnOpenGuide = doc.getElementById('btnOpenMdnsGuide');
    const btnCloseModal = doc.getElementById('btnCloseMdnsModal');
    const btnDismiss = doc.getElementById('btnDismissMdnsBanner');

    const controller = setupMdnsWarningAndGuidance({ document: doc });
    assert.ok(controller, 'setupMdnsWarningAndGuidance must return controller');

    // Verify browser badge and flag URL were hydrated
    const browserBadge = doc.getElementById('mdnsModalBrowserBadge');
    const flagDisplay = doc.getElementById('mdnsFlagUrlDisplay');
    assert.ok(browserBadge.textContent.length > 0);
    assert.ok(flagDisplay.textContent.includes('://flags/#enable-webrtc-hide-local-ips-with-mdns'));

    // Test Open Modal
    btnOpenGuide.dispatchEvent(new dom.window.Event('click'));
    assert.strictEqual(modal.style.display, 'flex');

    // Test Close Modal
    btnCloseModal.dispatchEvent(new dom.window.Event('click'));
    assert.strictEqual(modal.style.display, 'none');

    // Test Dismiss Banner
    banner.style.display = 'block';
    btnDismiss.dispatchEvent(new dom.window.Event('click'));
    assert.strictEqual(banner.style.display, 'none');
  });
});
