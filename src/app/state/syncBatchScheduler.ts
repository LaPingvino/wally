/**
 * SyncBatchScheduler — coalesces jotai atom writes from Matrix SDK events.
 *
 * Problem: The Matrix SDK fires events synchronously during sync processing.
 * Each event handler calls setAtom() immediately, triggering jotai's full
 * dependency graph traversal + React re-renders. During initial sync or on
 * busy servers, hundreds of events fire per second → hundreds of graph walks.
 *
 * Solution: Instead of calling setAtom() directly, handlers enqueue their
 * writes here. The scheduler requests a single rAF and flushes all pending
 * writes in one batch. This means:
 *
 *   Before: 50 sync events → 50 atom writes → 50 dependency walks → 50 renders
 *   After:  50 sync events → 50 enqueues → 1 rAF → 1-5 atom writes → 1 render
 *
 * Two enqueue modes:
 *   - enqueue(key, fn): Replace any pending write for `key`. Last write wins.
 *     Good for "set entire state" operations like INITIALIZE.
 *   - enqueueAccumulate(key, item): Collect items into a Set, flush handler
 *     receives all accumulated items. Good for "add room X" operations.
 */

export type FlushHandler = (items: string[]) => void;

/**
 * Performance statistics collected by sync batch schedulers.
 * Exposed via syncBatchStats for the Performance settings page.
 */
export interface SyncBatchStats {
  /** Total events enqueued across all schedulers since last reset. */
  eventsEnqueued: number;
  /** Total rAF flushes executed. */
  flushesExecuted: number;
  /** Events per key since last reset. */
  eventsByKey: Map<string, number>;
  /** Timestamp of last reset. */
  resetAt: number;
}

/** Global stats shared across all SyncBatchScheduler instances. */
export const syncBatchStats: SyncBatchStats = {
  eventsEnqueued: 0,
  flushesExecuted: 0,
  eventsByKey: new Map(),
  resetAt: Date.now(),
};

/** Reset stats (called from Performance settings page). */
export function resetSyncBatchStats(): void {
  syncBatchStats.eventsEnqueued = 0;
  syncBatchStats.flushesExecuted = 0;
  syncBatchStats.eventsByKey.clear();
  syncBatchStats.resetAt = Date.now();
}

export class SyncBatchScheduler {
  /** Pending one-shot writes (last-write-wins per key). */
  private pending = new Map<string, () => void>();

  /** Accumulated items per key (for enqueueAccumulate). */
  private accumulated = new Map<string, Set<string>>();

  /** Flush handlers for accumulated keys. */
  private flushHandlers = new Map<string, FlushHandler>();

  /** The rAF handle, or null if no flush is scheduled. */
  private rafId: number | null = null;

  /** Whether dispose() has been called. */
  private disposed = false;

  /**
   * Enqueue a one-shot write. If a write for the same key is already pending,
   * it is replaced (last-write-wins). The callback runs during the next rAF.
   */
  enqueue(key: string, fn: () => void): void {
    if (this.disposed) return;
    syncBatchStats.eventsEnqueued++;
    syncBatchStats.eventsByKey.set(key, (syncBatchStats.eventsByKey.get(key) ?? 0) + 1);
    this.pending.set(key, fn);
    this.scheduleFlush();
  }

  /**
   * Accumulate an item under a key. All items are collected into a Set and
   * flushed together via the registered flush handler.
   */
  enqueueAccumulate(key: string, item: string): void {
    if (this.disposed) return;
    syncBatchStats.eventsEnqueued++;
    syncBatchStats.eventsByKey.set(key, (syncBatchStats.eventsByKey.get(key) ?? 0) + 1);
    let set = this.accumulated.get(key);
    if (!set) {
      set = new Set();
      this.accumulated.set(key, set);
    }
    set.add(item);
    this.scheduleFlush();
  }

  /**
   * Register a handler that receives accumulated items on flush.
   * Can be called at any time — handlers are retained across flushes.
   */
  setFlushHandler(key: string, handler: FlushHandler): void {
    this.flushHandlers.set(key, handler);
  }

  /**
   * Cancel pending flush and prevent future enqueues.
   */
  dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pending.clear();
    this.accumulated.clear();
  }

  private scheduleFlush(): void {
    if (this.rafId !== null) return; // already scheduled
    this.rafId = requestAnimationFrame(() => this.flush());
  }

  private flush(): void {
    this.rafId = null;
    if (this.disposed) return;
    syncBatchStats.flushesExecuted++;

    // Execute one-shot writes
    const pendingEntries = Array.from(this.pending.entries());
    this.pending.clear();
    for (const [, fn] of pendingEntries) {
      fn();
    }

    // Execute accumulated flushes
    const accEntries = Array.from(this.accumulated.entries());
    this.accumulated.clear();
    for (const [key, items] of accEntries) {
      const handler = this.flushHandlers.get(key);
      if (handler) {
        handler(Array.from(items));
      }
    }
  }
}
