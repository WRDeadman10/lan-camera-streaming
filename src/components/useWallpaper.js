import { useState, useEffect, useCallback } from 'react';

/**
 * Default curated high-resolution space wallpaper fallback.
 * Used when network is offline, Unsplash rate limits are reached, or first fetch fails.
 */
export const DEFAULT_SPACE_WALLPAPER =
  'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=2560&q=85&auto=format&fit=crop';

export const DEFAULT_UNSPLASH_CLIENT_ID = '15MDKvUVv4HMJ3DzyeRIwxCFvEB70QeNcKzOCX_Puf0';

/**
 * Formats a Date object to YYYY-MM-DD in local time.
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
 * React Hook: useWallpaper
 *
 * Retrieves a daily high-definition space wallpaper from Unsplash with:
 * - Local storage caching (refetched once per day).
 * - Route/page-derived cache key.
 * - Raw URL desktop optimization (&w=2560&q=85&auto=format&fit=crop).
 * - Graceful fallback on network failure or rate limit.
 *
 * @param {object} [options]
 * @param {string} [options.clientId] - Unsplash API Access Key
 * @param {string} [options.query] - Search query (default: 'space wallpaper')
 * @param {string} [options.orientation] - Image orientation (default: 'landscape')
 * @param {string} [options.pageKey] - Custom cache key suffix based on route/page
 * @param {string} [options.defaultFallbackUrl] - Fallback URL if cache & network fail
 * @returns {{ wallpaperUrl: string, isLoading: boolean, isFallback: boolean, error: Error | null, refetch: () => void }}
 */
export function useWallpaper({
  clientId = DEFAULT_UNSPLASH_CLIENT_ID,
  query = 'space wallpaper',
  orientation = 'landscape',
  pageKey,
  defaultFallbackUrl = DEFAULT_SPACE_WALLPAPER
} = {}) {
  const resolvedKey = `lancam_wallpaper_${pageKey || (typeof window !== 'undefined' ? window.location?.pathname?.replace(/[^a-zA-Z0-9]/g, '_') || 'global' : 'global')}`;

  const [wallpaperUrl, setWallpaperUrl] = useState(() => {
    const cached = getStoredWallpaper(resolvedKey);
    const today = getTodayDateString();
    if (cached && cached.date === today && cached.url) {
      return cached.url;
    }
    const lastValid = getLastValidWallpaper();
    return lastValid || defaultFallbackUrl;
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isFallback, setIsFallback] = useState(false);
  const [error, setError] = useState(null);

  const fetchDailyWallpaper = useCallback(async () => {
    const today = getTodayDateString();
    const cached = getStoredWallpaper(resolvedKey);

    // Reuse cache if already fetched today to prevent UI flicker and rate limit hits
    if (cached && cached.date === today && cached.url) {
      setWallpaperUrl(cached.url);
      setIsLoading(false);
      setIsFallback(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    try {
      const endpoint = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=${encodeURIComponent(orientation)}&client_id=${encodeURIComponent(clientId)}`;
      const response = await fetch(endpoint, { signal: controller.signal });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Unsplash API responded with HTTP status ${response.status}`);
      }

      const photo = await response.json();
      const optimizedUrl = optimizeUnsplashUrl(photo.urls);

      if (!optimizedUrl) {
        throw new Error('Unsplash API response did not contain usable image URLs');
      }

      // Preload image to ensure seamless display transition
      if (typeof Image !== 'undefined') {
        const img = new Image();
        img.src = optimizedUrl;
        img.onload = () => {
          setStoredWallpaper(resolvedKey, optimizedUrl, {
            id: photo.id,
            author: photo.user?.name,
            authorUsername: photo.user?.username
          });
          setWallpaperUrl(optimizedUrl);
          setIsLoading(false);
          setIsFallback(false);
        };
        img.onerror = () => {
          // If preloading fails, still store and set
          setStoredWallpaper(resolvedKey, optimizedUrl);
          setWallpaperUrl(optimizedUrl);
          setIsLoading(false);
          setIsFallback(false);
        };
      } else {
        setStoredWallpaper(resolvedKey, optimizedUrl);
        setWallpaperUrl(optimizedUrl);
        setIsLoading(false);
        setIsFallback(false);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      setError(err);
      setIsFallback(true);
      setIsLoading(false);

      // Gracefully fall back to most recent cached URL or curated default
      const lastCached = getLastValidWallpaper();
      const fallback = lastCached || defaultFallbackUrl;
      setWallpaperUrl(fallback);
    }
  }, [clientId, query, orientation, resolvedKey, defaultFallbackUrl]);

  useEffect(() => {
    fetchDailyWallpaper();
  }, [fetchDailyWallpaper]);

  return {
    wallpaperUrl,
    isLoading,
    isFallback,
    error,
    refetch: fetchDailyWallpaper
  };
}

export default useWallpaper;
