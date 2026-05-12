import { atom, Atom, PrimitiveAtom, useStore } from 'jotai';
import { useEffect } from 'react';

/**
 * Read-only throttled view of a source atom. Consumers subscribed to
 * `out` see updates at most once every `waitMs` (trailing edge), even
 * if the source atom is being written to many times per frame.
 *
 * Why this exists: the RED-tier atoms in the audit (roomToUnread,
 * roomToParents, allRooms) propagate every Matrix SDK event into a
 * dependency-graph walk and React re-render. Upstream Cinny tolerates
 * this because it has fewer always-mounted subscribers; our fork has
 * more, and the same atoms can drive a render storm. This wrapper caps
 * downstream re-render rate without changing the writer side.
 *
 * Important: this does NOT throttle writes. Writers still see immediate
 * updates via the source atom. The throttle applies only to reads via
 * `out`.
 */
export interface ThrottledAtom<T> {
  /** The original writable atom. Writers keep using this. */
  source: Atom<T>;
  /** Internal cache, updated on the trailing edge by the driver. */
  cache: PrimitiveAtom<{ v: T } | null>;
  /** The throttled view to expose to consumers. Falls back to source
   *  until the driver populates the cache (covers SSR / before-mount). */
  out: Atom<T>;
  /** Stable name for stats display. */
  name: string;
  /** Minimum ms between cache flushes. */
  waitMs: number;
}

export function makeThrottledAtom<T>(
  source: Atom<T>,
  name: string,
  waitMs: number
): ThrottledAtom<T> {
  const cache = atom<{ v: T } | null>(null);
  const out = atom((get) => {
    const c = get(cache);
    return c === null ? get(source) : c.v;
  });
  return { source, cache, out, name, waitMs };
}

/**
 * Per-throttled-atom flush counters. Surfaced on the Performance
 * settings page so we can confirm the throttle is engaging — if these
 * climb at the wait-rate (or slower) while CPU stays high, the storm
 * is being driven by something else and we need to look elsewhere.
 */
export const throttledFlushStats = {
  flushes: new Map<string, number>(),
  lastFlushMs: new Map<string, number>(),
  resetAt: Date.now(),
};

export function resetThrottledFlushStats(): void {
  throttledFlushStats.flushes.clear();
  throttledFlushStats.lastFlushMs.clear();
  throttledFlushStats.resetAt = Date.now();
}

/**
 * Mount once near the app shell for each throttled atom. Subscribes to
 * the source and trailing-edge-flushes new values into the cache no
 * more than once per `waitMs`. Initial flush on mount populates the
 * cache so consumers immediately read from it rather than the source.
 */
export function useThrottledAtomDriver<T>(t: ThrottledAtom<T>): void {
  const store = useStore();
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastFlushMs = 0;
    let dirty = false;

    const flush = () => {
      if (cancelled) return;
      timer = undefined;
      // When the tab is in the background, defer the flush: don't burn
      // CPU re-rendering an invisible UI. We record that work is
      // pending; on visibilitychange we'll flush immediately so the
      // user sees fresh state the moment they look at the tab.
      if (document.hidden) {
        dirty = true;
        return;
      }
      dirty = false;
      lastFlushMs = performance.now();
      const v = store.get(t.source);
      store.set(t.cache, { v });
      throttledFlushStats.flushes.set(
        t.name,
        (throttledFlushStats.flushes.get(t.name) ?? 0) + 1
      );
      throttledFlushStats.lastFlushMs.set(t.name, lastFlushMs);
    };

    const onChange = () => {
      if (cancelled) return;
      // Always remember a change happened so a deferred-while-hidden
      // run will catch up when the tab is shown again.
      dirty = true;
      if (timer !== undefined) return; // already scheduled
      if (document.hidden) return; // no point scheduling now
      const elapsed = performance.now() - lastFlushMs;
      const delay = Math.max(0, t.waitMs - elapsed);
      timer = setTimeout(flush, delay);
    };

    const onVisibility = () => {
      if (document.hidden) return;
      if (!dirty) return;
      // Flush immediately on return-to-foreground so the UI snaps to
      // current state, then resume normal throttled cadence.
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      flush();
    };

    // Prime cache so subscribers stop reading source.
    flush();
    const unsub = store.sub(t.source, onChange);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      unsub();
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer !== undefined) clearTimeout(timer);
    };
    // t is a stable object built at module scope; safe to include.
  }, [store, t]);
}
