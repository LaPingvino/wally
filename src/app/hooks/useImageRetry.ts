import { ReactEventHandler, useCallback, useEffect, useRef, useState } from 'react';

const MAX_RETRIES = 4;
/** Never wait on the worker forever — fall back to the blind ladder after this. */
const SW_CONTROL_TIMEOUT = 15000;

const swSupported = (): boolean => 'serviceWorker' in navigator;
const swControlling = (): boolean => !swSupported() || !!navigator.serviceWorker.controller;

/**
 * Run `cb` once the service worker controls this page — immediately if it already
 * does, or if there is no worker to wait for. Returns a cleanup function.
 */
const whenSwControls = (cb: () => void): (() => void) => {
  if (swControlling()) {
    cb();
    return () => undefined;
  }
  let done = false;
  let timer: number | undefined;
  const fire = () => {
    if (done) return;
    done = true;
    if (timer) window.clearTimeout(timer);
    navigator.serviceWorker.removeEventListener('controllerchange', fire);
    cb();
  };
  timer = window.setTimeout(fire, SW_CONTROL_TIMEOUT);
  navigator.serviceWorker.addEventListener('controllerchange', fire);
  return () => {
    done = true;
    if (timer) window.clearTimeout(timer);
    navigator.serviceWorker.removeEventListener('controllerchange', fire);
  };
};

export type RetryDecision =
  /** Not our image's fault yet — wait for the worker instead of spending an attempt. */
  { type: 'wait-for-sw' } | { type: 'retry'; delayMs: number } | { type: 'fail' };

/**
 * What to do about a failed image load. Pure; exported for tests.
 *
 * `rand` is injected so the jitter is testable — see the hook's docs below for why
 * each branch is the way it is.
 */
export const decideImageRetry = (
  swControls: boolean,
  attempts: number,
  rand: number = Math.random()
): RetryDecision => {
  if (!swControls) return { type: 'wait-for-sw' };
  if (attempts >= MAX_RETRIES) return { type: 'fail' };
  const base = 500 * 2 ** attempts;
  return { type: 'retry', delayMs: base * (0.75 + rand * 0.5) };
};

/**
 * Retry an avatar/image load a few times before giving up to the fallback.
 *
 * Authenticated media (MSC3916) is served from /_matrix/client/v1/media/..., which a
 * plain <img> can only load once the service worker is active to attach the auth
 * header. On a refresh an avatar can fire before the worker controls the page → 401 →
 * onError. Upstream's avatars then set a permanent fallback, so the picture stays
 * missing until the next reload — the long-standing "pictures randomly don't load on
 * refresh" bug.
 *
 * Two things matter beyond simply retrying:
 *
 * 1. WAIT FOR THE SIGNAL, DON'T GUESS THE DURATION. While the page is uncontrolled a
 *    failure says nothing about the image, so it must not spend one of the four
 *    attempts — on a slow start the ladder can burn all four before the worker is
 *    even in charge, which is precisely how an icon ends up permanently letter-only.
 *    `controllerchange` tells us exactly when authentication becomes possible; the
 *    timeout keeps a page that will never be controlled from hanging on it.
 *
 * 2. JITTER. Every avatar on screen fails at the same instant for the same reason, so
 *    a fixed ladder retries all of them at the same four instants. With hundreds of
 *    rooms that is a self-inflicted thundering herd against a six-connections-per-host
 *    limit, and the requests that lose the race burn attempts on congestion we caused.
 *    ±25% spread breaks up the convoy.
 *
 * `retryKey` counts REMOUNTS, not attempts: remounting the <img> is what re-fetches,
 * and the worker-wait path retries without spending an attempt, so tying the key to
 * the attempt counter would leave that retry invisible to React and never re-request.
 * Only MAX_RETRIES genuine, controlled failures fall back. Resets when `src` changes.
 */
export const useImageRetry = (
  src?: string
): { retryKey: number; failed: boolean; onError: ReactEventHandler<HTMLImageElement> } => {
  const attemptRef = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);
  const swWaitRef = useRef<(() => void) | undefined>(undefined);
  const [retryKey, setRetryKey] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    attemptRef.current = 0;
    setFailed(false);
    setRetryKey((n) => n + 1);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      swWaitRef.current?.();
      swWaitRef.current = undefined;
    };
  }, [src]);

  const onError = useCallback<ReactEventHandler<HTMLImageElement>>(() => {
    const decision = decideImageRetry(swControlling(), attemptRef.current);

    if (decision.type === 'wait-for-sw') {
      // The worker that attaches the auth header isn't in charge yet: this
      // failure is about our startup, not the image. Retry when it takes over.
      swWaitRef.current?.();
      swWaitRef.current = whenSwControls(() => setRetryKey((n) => n + 1));
      return;
    }

    if (decision.type === 'fail') {
      setFailed(true);
      return;
    }

    attemptRef.current += 1;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    // Re-render after the backoff so the <img> remounts (new retryKey) and re-fetches.
    timerRef.current = window.setTimeout(() => setRetryKey((n) => n + 1), decision.delayMs);
  }, []);

  return { retryKey, failed, onError };
};
