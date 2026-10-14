import React from 'react';
import { useWallpaper } from './useWallpaper.js';

/**
 * WallpaperBackground Component
 *
 * Implements a 4-layer visual background system:
 * - Layer 1 (Deepest): Dynamic high-res daily space wallpaper with smooth 1000ms fade-in.
 * - Layer 2 (Readability): Dark semi-transparent obsidian backdrop (bg-slate-950/90) + 4px blur.
 * - Layer 3 (Texture): Subtle 5% opacity SVG noise overlay.
 * - Layer 4 (Content): Relative z-10 container ensuring all child routes/components remain 100% interactive and legible.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children - Main app content or route views
 * @param {string} [props.clientId] - Optional Unsplash client ID override
 * @param {string} [props.pageKey] - Optional route/page identifier for cache separation
 * @param {string} [props.className] - Additional CSS classes on the content wrapper
 */
export function WallpaperBackground({
  children,
  clientId,
  pageKey,
  className = ''
}) {
  const { wallpaperUrl, isLoading } = useWallpaper({ clientId, pageKey });

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-slate-950 text-slate-100">
      {/* Layer 1 (Deepest - Wallpaper): Fixed inset-0 with bg-cover, bg-center & smooth transition */}
      <div
        className="fixed inset-0 bg-cover bg-center transition-opacity duration-1000 ease-in-out pointer-events-none"
        style={{
          backgroundImage: wallpaperUrl ? `url("${wallpaperUrl}")` : undefined,
          opacity: isLoading ? 0 : 1,
          zIndex: 0,
          transform: 'scale(1.02)' // Prevents white seam edges during smooth zoom or resize
        }}
        aria-hidden="true"
      />

      {/* Layer 2 (Readability Overlay): Obsidian dark semi-transparent veil with 4px backdrop blur */}
      <div
        className="fixed inset-0 bg-slate-950/90 backdrop-blur-[4px] pointer-events-none"
        style={{
          zIndex: 1,
          background: 'radial-gradient(circle at center, rgba(3, 7, 18, 0.85) 0%, rgba(2, 6, 23, 0.94) 100%)'
        }}
        aria-hidden="true"
      />

      {/* Layer 3 (Texture): Subtle SVG noise overlay (~5% opacity) for a frosted modern aesthetic */}
      <div
        className="fixed inset-0 opacity-[0.05] pointer-events-none"
        style={{
          zIndex: 2,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`
        }}
        aria-hidden="true"
      />

      {/* Layer 4 (Content): Content wrapped in z-10 relative so all controls remain interactive */}
      <div className={`relative z-10 w-full min-h-screen ${className}`}>
        {children}
      </div>
    </div>
  );
}

export default WallpaperBackground;
