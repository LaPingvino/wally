import { ReactEventHandler, useCallback, useEffect, useRef, useState } from 'react';

const MAX_RETRIES = 4;

/**
 * Retry an avatar/image load a few times before giving up to the fallback.
 *
 * Authenticated media (MSC3916) is served from /_matrix/client/v1/media/..., which a
 * plain <img> can only load once the service worker is active to attach the auth
 * header. The SW registers on `load` (after first paint), so on a REFRESH an avatar
 * can fire before the SW controls the page → 401 → onError. Cinny's avatars then set a
 * permanent fallback, so the picture stays missing until the next reload — the
 * long-standing "pictures randomly don't load on refresh" bug.
 *
 * Here we instead retry with backoff (0.5s, 1s, 2s, 4s); by then the SW / access token
 * is virtually always ready, and remounting the <img> (via the returned `retryKey`)
 * re-fetches the same URL so the SW can auth it. Only after MAX_RETRIES do we fall back.
 * Resets when `src` changes.
 */
export const useImageRetry = (
  src?: string
): { retryKey: number; failed: boolean; onError: ReactEventHandler<HTMLImageElement> } => {
  const attemptRef = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);
  const [, force] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    attemptRef.current = 0;
    setFailed(false);
    force((n) => n + 1);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [src]);

  const onError = useCallback<ReactEventHandler<HTMLImageElement>>(() => {
    if (attemptRef.current >= MAX_RETRIES) {
      setFailed(true);
      return;
    }
    const delay = 500 * 2 ** attemptRef.current;
    attemptRef.current += 1;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    // Re-render after the backoff so the <img> remounts (new retryKey) and re-fetches.
    timerRef.current = window.setTimeout(() => force((n) => n + 1), delay);
  }, []);

  return { retryKey: attemptRef.current, failed, onError };
};
