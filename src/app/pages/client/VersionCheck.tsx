import React, { useCallback, useEffect, useState } from 'react';
import { Box, config, Text } from 'folds';
import { ContainerColor } from '../../styles/ContainerColor.css';

/**
 * Extracts JS bundle hashes from an HTML string.
 * Vite produces filenames like `index-D_rwMSSw.js` — the hash changes on every build.
 */
function extractBundleHashes(html: string): string[] {
  const matches = html.matchAll(/\/assets\/((?:index|main)-[A-Za-z0-9_-]+\.js)/g);
  return Array.from(matches, (m) => m[1]).sort();
}

// Snapshot the hashes that were in index.html when THIS page loaded.
// These are baked into the <script> tags the browser executed.
const CURRENT_SCRIPTS = Array.from(
  document.querySelectorAll<HTMLScriptElement>('script[src*="/assets/"]'),
  (s) => {
    const m = s.src.match(/\/assets\/((?:index|main)-[A-Za-z0-9_-]+\.js)/);
    return m ? m[1] : '';
  }
)
  .filter(Boolean)
  .sort();

const CHECK_INTERVAL_MS = 2 * 60 * 1000; // every 2 minutes

export function VersionCheck() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  const checkForUpdate = useCallback(async () => {
    try {
      // Fetch index.html bypassing all caches
      const resp = await fetch(`${window.location.origin}${window.location.pathname}`, {
        cache: 'no-store',
        headers: { Accept: 'text/html' },
      });
      if (!resp.ok) return;
      const html = await resp.text();
      const serverHashes = extractBundleHashes(html);

      if (
        CURRENT_SCRIPTS.length > 0 &&
        serverHashes.length > 0 &&
        JSON.stringify(serverHashes) !== JSON.stringify(CURRENT_SCRIPTS)
      ) {
        setUpdateAvailable(true);
      }
    } catch {
      // Network error — skip silently
    }
  }, []);

  useEffect(() => {
    // First check after 30 seconds (let the app stabilize)
    const initial = setTimeout(checkForUpdate, 30_000);
    const interval = setInterval(checkForUpdate, CHECK_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [checkForUpdate]);

  // Also check on tab wake (visibility change)
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) checkForUpdate();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [checkForUpdate]);

  if (!updateAvailable) return null;

  // Navigate with a cache-busting query param so CDNs (Cloudflare) can't
  // serve the old cached index.html. A plain reload() uses default cache
  // behavior and Cloudflare returns the stale page.
  const hardReload = () => {
    const base = window.location.pathname + window.location.hash;
    window.location.replace(`${base}?_cb=${Date.now()}`);
  };

  return (
    <Box direction="Column" shrink="No">
      <Box
        className={ContainerColor({ variant: 'Success' })}
        style={{ padding: `${config.space.S100} ${config.space.S200}`, cursor: 'pointer' }}
        alignItems="Center"
        justifyContent="Center"
        gap="200"
        onClick={hardReload}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') hardReload();
        }}
      >
        <Text size="L400">
          A new version is available — click here to reload
        </Text>
      </Box>
    </Box>
  );
}
