/**
 * @file mdns-detector.js
 * Detects mDNS local IP concealment (Anonymize local IPs exposed by WebRTC)
 * on Windows Chromium browsers (Comet, Edge, Chrome, Brave, Opera, Vivaldi, Arc)
 * and guides the sender to disable it for direct LAN streaming.
 * Strictly adheres to AGENTS.md conventions (no var, K&R braces).
 */

import { copyTextToClipboard } from './ui-utils.js';

/**
 * Detect browser identity and internal flags URL scheme.
 * @param {string} [customUserAgent]
 * @param {Object} [customNavigator]
 * @returns {{ browserName: string, flagScheme: string, flagUrl: string, flagId: string, flagSettingName: string, flagSettingDesc: string, recommendedValue: string }}
 */
export function detectBrowserFlagInfo(customUserAgent = null, customNavigator = null) {
  const nav = customNavigator || (typeof navigator !== 'undefined' ? navigator : {});
  const ua = customUserAgent || (nav && nav.userAgent ? nav.userAgent : '');

  let browserName = 'Chrome';
  let flagScheme = 'chrome';

  if (/comet/i.test(ua)) {
    browserName = 'Comet';
    flagScheme = 'comet';
  } else if (/edg([ea]|ios|\/)/i.test(ua)) {
    browserName = 'Microsoft Edge';
    flagScheme = 'edge';
  } else if ((nav && nav.brave && typeof nav.brave.isBrave === 'function') || /\bbrave\b/i.test(ua)) {
    browserName = 'Brave';
    flagScheme = 'brave';
  } else if (/\b(opr|opera)\b/i.test(ua)) {
    browserName = 'Opera';
    flagScheme = 'opera';
  } else if (/\bvivaldi\b/i.test(ua)) {
    browserName = 'Vivaldi';
    flagScheme = 'vivaldi';
  } else if (/\byabrowser\b/i.test(ua)) {
    browserName = 'Yandex';
    flagScheme = 'ybrowser';
  } else if (/\barc\b/i.test(ua)) {
    browserName = 'Arc';
    flagScheme = 'arc';
  }

  const flagId = 'enable-webrtc-hide-local-ips-with-mdns';
  const flagUrl = `${flagScheme}://flags/#${flagId}`;

  return {
    browserName,
    flagScheme,
    flagUrl,
    flagId,
    flagSettingName: 'Anonymize local IPs exposed by WebRTC',
    flagSettingDesc: 'Conceal local IP addresses with mDNS hostnames. — Mac, Windows, Linux, ChromeOS',
    recommendedValue: 'Disabled'
  };
}

/**
 * Check if the host platform is Windows.
 * @param {Object} [customNavigator]
 * @returns {boolean}
 */
export function isWindowsPlatform(customNavigator = null) {
  const nav = customNavigator || (typeof navigator !== 'undefined' ? navigator : null);
  if (!nav) {
    return false;
  }
  if (nav.userAgentData && nav.userAgentData.platform) {
    return /^win/i.test(nav.userAgentData.platform);
  }
  const platform = nav.platform || '';
  const ua = nav.userAgent || '';
  return /win/i.test(platform) || /windows/i.test(ua);
}

/**
 * Check if an IP address string is a private LAN IPv4 address.
 * @param {string} ip
 * @returns {boolean}
 */
export function isPrivateIpv4(ip) {
  if (!ip || typeof ip !== 'string') {
    return false;
  }
  const trimmed = ip.trim();
  return (
    trimmed.startsWith('10.') ||
    trimmed.startsWith('192.168.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(trimmed) ||
    trimmed.startsWith('127.')
  );
}

/**
 * Probe WebRTC ICE host candidate gathering to detect whether mDNS is concealing local IPs.
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=1200]
 * @param {Function} [options.RTCPeerConnectionClass]
 * @returns {Promise<{ isSupported: boolean, isHiding: boolean, hasMdnsCandidate: boolean, hasPrivateIpv4: boolean, candidates: string[] }>}
 */
export async function probeMdnsLocalIpHiding(options = {}) {
  const PeerConnectionClass = options.RTCPeerConnectionClass ||
    (typeof RTCPeerConnection !== 'undefined' ? RTCPeerConnection : (typeof window !== 'undefined' ? window.RTCPeerConnection : null));

  if (!PeerConnectionClass) {
    return {
      isSupported: false,
      isHiding: false,
      hasMdnsCandidate: false,
      hasPrivateIpv4: false,
      candidates: []
    };
  }

  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 1200;

  return new Promise((resolve) => {
    let finished = false;
    let hasMdnsCandidate = false;
    let hasPrivateIpv4 = false;
    const candidates = [];

    let pc = null;
    let timer = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (pc) {
        try {
          pc.onicecandidate = null;
          pc.close();
        } catch (_) {}
        pc = null;
      }
    };

    const finish = () => {
      if (!finished) {
        finished = true;
        const isHiding = hasMdnsCandidate && !hasPrivateIpv4;
        cleanup();
        resolve({
          isSupported: true,
          isHiding,
          hasMdnsCandidate,
          hasPrivateIpv4,
          candidates
        });
      }
    };

    timer = setTimeout(finish, timeoutMs);

    try {
      pc = new PeerConnectionClass({ iceServers: [] });
      if (typeof pc.createDataChannel === 'function') {
        pc.createDataChannel('mdns_probe');
      }

      pc.onicecandidate = (event) => {
        if (!event || !event.candidate) {
          finish();
          return;
        }

        const rawCand = event.candidate.candidate || '';
        const address = event.candidate.address || event.candidate.ip || '';
        candidates.push(rawCand || address);

        const isHost = (event.candidate.type === 'host') || rawCand.includes('typ host');
        if (isHost) {
          if (address.endsWith('.local') || rawCand.includes('.local')) {
            hasMdnsCandidate = true;
          } else if (isPrivateIpv4(address) || /\b(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(rawCand)) {
            hasPrivateIpv4 = true;
          }
        }
      };

      pc.createOffer()
        .then((offer) => {
          if (pc && typeof pc.setLocalDescription === 'function') {
            return pc.setLocalDescription(offer);
          }
        })
        .catch(() => finish());
    } catch (_) {
      finish();
    }
  });
}

/**
 * Initialize mDNS warning banner and interactive guidance modal on the sender page.
 * @param {Object} [elements]
 * @returns {{ browserInfo: Object, isWindows: boolean, openModal: Function, closeModal: Function, retest: Function }}
 */
export function setupMdnsWarningAndGuidance(elements = {}) {
  const doc = elements.document || (typeof document !== 'undefined' ? document : null);
  if (!doc) {
    return null;
  }

  const banner = elements.banner || doc.getElementById('mdnsWarningBanner');
  const bannerBrowserEl = elements.bannerBrowser || doc.getElementById('mdnsDetectedBrowser');
  const btnCopyFlag = elements.btnCopyFlag || doc.getElementById('btnCopyMdnsFlag');
  const btnOpenGuide = elements.btnOpenGuide || doc.getElementById('btnOpenMdnsGuide');
  const btnDismiss = elements.btnDismiss || doc.getElementById('btnDismissMdnsBanner');

  const modal = elements.modal || doc.getElementById('mdnsGuidanceModal');
  const modalClose = elements.modalClose || doc.getElementById('btnCloseMdnsModal');
  const modalCancel = elements.modalCancel || doc.getElementById('btnCancelMdnsModal');
  const modalCopyFlag = elements.modalCopyFlag || doc.getElementById('btnModalCopyMdnsFlag');
  const modalRetest = elements.modalRetest || doc.getElementById('btnModalRetestMdns');
  const modalStatus = elements.modalStatus || doc.getElementById('mdnsModalStatus');
  const modalFlagUrlDisplay = elements.modalFlagUrlDisplay || doc.getElementById('mdnsFlagUrlDisplay');
  const modalBrowserBadge = elements.modalBrowserBadge || doc.getElementById('mdnsModalBrowserBadge');

  const browserInfo = detectBrowserFlagInfo();

  if (bannerBrowserEl) {
    bannerBrowserEl.textContent = browserInfo.browserName;
  }
  if (modalBrowserBadge) {
    modalBrowserBadge.textContent = browserInfo.browserName;
  }
  if (modalFlagUrlDisplay) {
    modalFlagUrlDisplay.textContent = browserInfo.flagUrl;
  }

  const copyFlagUrl = async (btn) => {
    if (btn) {
      await copyTextToClipboard(browserInfo.flagUrl, btn, '✓ Flag URL Copied!');
    }
  };

  if (btnCopyFlag) {
    btnCopyFlag.addEventListener('click', () => copyFlagUrl(btnCopyFlag));
  }
  if (modalCopyFlag) {
    modalCopyFlag.addEventListener('click', () => copyFlagUrl(modalCopyFlag));
  }

  const openModal = () => {
    if (modal) {
      modal.style.display = 'flex';
    }
  };

  const closeModal = () => {
    if (modal) {
      modal.style.display = 'none';
    }
  };

  if (btnOpenGuide) {
    btnOpenGuide.addEventListener('click', openModal);
  }
  if (modalClose) {
    modalClose.addEventListener('click', closeModal);
  }
  if (modalCancel) {
    modalCancel.addEventListener('click', closeModal);
  }
  if (btnDismiss) {
    btnDismiss.addEventListener('click', () => {
      if (banner) {
        banner.style.display = 'none';
      }
      try {
        sessionStorage.setItem('lancam_mdns_banner_dismissed', 'true');
      } catch (_) {}
    });
  }

  const retest = async () => {
    if (modalStatus) {
      modalStatus.innerHTML = '<span style="color: var(--accent-cyan);">Testing WebRTC local IP exposure...</span>';
    }
    const probe = await probeMdnsLocalIpHiding({ timeoutMs: 1500 });
    if (!modalStatus) {
      return probe;
    }
    if (!probe.isSupported) {
      modalStatus.innerHTML = '<span style="color: var(--text-secondary);">WebRTC probe unsupported in this environment.</span>';
    } else if (probe.isHiding) {
      modalStatus.innerHTML = '<span style="color: var(--accent-amber);">⚠️ Local IPs are still concealed with mDNS hostnames (.local). Make sure "Disabled" is selected in flags and your browser was relaunched.</span>';
    } else {
      modalStatus.innerHTML = '<span style="color: var(--accent-emerald);">✓ Perfect! Local IP addresses are exposed. Your phone can now connect directly over LAN.</span>';
      if (banner) {
        banner.style.display = 'none';
      }
    }
    return probe;
  };

  if (modalRetest) {
    modalRetest.addEventListener('click', retest);
  }

  // Automatic evaluation if on Windows
  const isWindows = isWindowsPlatform();
  if (isWindows) {
    const isDismissed = (() => {
      try {
        return sessionStorage.getItem('lancam_mdns_banner_dismissed') === 'true';
      } catch (_) {
        return false;
      }
    })();

    probeMdnsLocalIpHiding().then((probe) => {
      if (probe.isHiding && !isDismissed && banner) {
        banner.style.display = 'block';
      }
    }).catch(() => {});
  }

  return {
    browserInfo,
    isWindows,
    openModal,
    closeModal,
    retest
  };
}
