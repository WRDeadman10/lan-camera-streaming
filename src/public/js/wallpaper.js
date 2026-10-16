/**
 * Dynamic Daily Space Wallpaper System
 *
 * Fetches high-definition space wallpapers from the Unsplash Random Photo API,
 * caches them locally once per day (YYYY-MM-DD), optimizes raw desktop URLs,
 * and renders a smooth 4-layer visual background behind app content.
 */

export const DEFAULT_SPACE_WALLPAPER =
  'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=2560&q=85&auto=format&fit=crop';

export const DEFAULT_UNSPLASH_CLIENT_ID = '15MDKvUVv4HMJ3DzyeRIwxCFvEB70QeNcKzOCX_Puf0';

/**
 * Returns today's date formatted as YYYY-MM-DD in local time.
 * @param {Date} [dateObj]
 * @returns {string}
 */
export function getTodayDateString(dateObj = new Date()) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Optimizes Unsplash raw photo URLs for desktop viewports.
 * Prioritizes urls.raw, falling back to urls.full or urls.regular.
 * If raw Unsplash URL, appends: &w=2560&q=85&auto=format&fit=crop
 *
 * @param {object} urls - The photo.urls object from Unsplash API
 * @returns {string}
 */
export function optimizeUnsplashUrl(urls) {
  if (!urls) {
    return '';
  }
  const isRaw = Boolean(urls.raw);
  const candidateUrl = urls.raw || urls.full || urls.regular || '';
  if (!candidateUrl) {
    return '';
  }

  try {
    const parsed = new URL(candidateUrl);
    if (parsed.hostname.includes('images.unsplash.com') && isRaw) {
      parsed.searchParams.set('w', '2560');
      parsed.searchParams.set('q', '85');
      parsed.searchParams.set('auto', 'format');
      parsed.searchParams.set('fit', 'crop');
      return parsed.toString();
    }
    return candidateUrl;
  } catch (err) {
    if (candidateUrl.includes('images.unsplash.com') && isRaw) {
      const sep = candidateUrl.includes('?') ? '&' : '?';
      return `${candidateUrl}${sep}w=2560&q=85&auto=format&fit=crop`;
    }
    return candidateUrl;
  }
}

/**
 * Retrieves the cached wallpaper entry from localStorage.
 * @param {string} cacheKey
 * @returns {{ date: string, url: string, id?: string } | null}
 */
export function getStoredWallpaper(cacheKey) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

/**
 * Stores the wallpaper entry in localStorage.
 * @param {string} cacheKey
 * @param {string} url
 * @param {object} [meta]
 */
export function setStoredWallpaper(cacheKey, url, meta = {}) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    const payload = {
      date: getTodayDateString(),
      url,
      ...meta
    };
    window.localStorage.setItem(cacheKey, JSON.stringify(payload));
    window.localStorage.setItem('lancam_wallpaper_last_valid_url', url);
  } catch (err) {}
}

/**
 * Retrieves the most recent cached wallpaper across any page.
 * @returns {string | null}
 */
export function getLastValidWallpaper() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  try {
    return window.localStorage.getItem('lancam_wallpaper_last_valid_url') || null;
  } catch (err) {
    return null;
  }
}

/**
 * Injects and mounts the 4-layer background DOM structure into the current page.
 * Ensures pointer-events: none and negative/zero z-indexes so existing controls are unaffected.
 *
 * @param {object} [options]
 * @param {string} [options.clientId]
 * @param {string} [options.query]
 * @param {string} [options.pageKey]
 * @param {string} [options.defaultFallbackUrl]
 */
export async function initWallpaper(options = {}) {
  if (typeof document === 'undefined') {
    return;
  }

  const clientId = options.clientId || DEFAULT_UNSPLASH_CLIENT_ID;
  const query = options.query || 'space wallpaper';
  const orientation = options.orientation || 'landscape';
  const defaultFallbackUrl = options.defaultFallbackUrl || DEFAULT_SPACE_WALLPAPER;

  const pageIdentifier = options.pageKey || (window.location.pathname ? window.location.pathname.replace(/[^a-zA-Z0-9]/g, '_') : 'global');
  const cacheKey = `lancam_wallpaper_${pageIdentifier}`;

  // Check or create container
  let container = document.getElementById('wallpaperContainer');
  let imageLayer = document.getElementById('wallpaperLayerImage');

  if (!container) {
    container = document.createElement('div');
    container.id = 'wallpaperContainer';
    container.className = 'wallpaper-container';
    container.setAttribute('aria-hidden', 'true');

    // Layer 1: Deepest Wallpaper
    imageLayer = document.createElement('div');
    imageLayer.id = 'wallpaperLayerImage';
    imageLayer.className = 'wallpaper-layer-image';
    container.appendChild(imageLayer);

    // Layer 2: Readability Overlay
    const overlayLayer = document.createElement('div');
    overlayLayer.className = 'wallpaper-layer-overlay';
    container.appendChild(overlayLayer);

    // Layer 3: Texture Noise
    const textureLayer = document.createElement('div');
    textureLayer.className = 'wallpaper-layer-texture';
    container.appendChild(textureLayer);

    document.body.prepend(container);
  }

  const today = getTodayDateString();
  const cached = getStoredWallpaper(cacheKey);

  // If already cached today, reuse directly to prevent UI flicker and rate limit hits
  if (cached && cached.date === today && cached.url) {
    applyWallpaperImage(imageLayer, cached.url, false);
    return;
  }

  // Pre-apply last valid URL or default fallback immediately so background is never blank
  const lastValid = getLastValidWallpaper();
  const initialFallback = (cached && cached.url) || lastValid || defaultFallbackUrl;
  applyWallpaperImage(imageLayer, initialFallback, false);

  // Fetch new wallpaper for today from Unsplash
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const endpoint = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=${encodeURIComponent(orientation)}&client_id=${encodeURIComponent(clientId)}`;
    const response = await fetch(endpoint, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Unsplash API HTTP status ${response.status}`);
    }

    const photo = await response.json();
    const optimizedUrl = optimizeUnsplashUrl(photo.urls);

    if (!optimizedUrl) {
      throw new Error('No usable image URL in Unsplash response');
    }

    // Preload before applying to prevent visual pop
    const preloader = new Image();
    preloader.src = optimizedUrl;
    preloader.onload = () => {
      setStoredWallpaper(cacheKey, optimizedUrl, {
        id: photo.id,
        author: photo.user?.name,
        authorUsername: photo.user?.username
      });
      applyWallpaperImage(imageLayer, optimizedUrl, true);
    };
  } catch (err) {
    clearTimeout(timeoutId);
    // Silent graceful fallback: existing applied background remains intact
  }
}

/**
 * Applies background image with smooth transition
 * @param {HTMLElement} element
 * @param {string} url
 * @param {boolean} smoothTransition
 */
function applyWallpaperImage(element, url, smoothTransition) {
  if (!element || !url) return;

  if (smoothTransition) {
    element.classList.remove('loaded');
    setTimeout(() => {
      element.style.backgroundImage = `url("${url}")`;
      element.classList.add('loaded');
    }, 50);
  } else {
    element.style.backgroundImage = `url("${url}")`;
    element.classList.add('loaded');
  }
}

// Auto-initialize when loaded in browser
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initWallpaper());
  } else {
    initWallpaper();
  }
}
