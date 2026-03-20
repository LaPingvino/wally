/**
 * Tests for jotai atom update batching from Matrix SDK events.
 *
 * Problem: The Matrix SDK fires events synchronously during sync processing.
 * Each bind hook independently writes its atom immediately per event. Each
 * write triggers jotai's full dependency graph traversal + React re-renders.
 * During initial sync, this means hundreds of graph walks per second.
 *
 * Fix: SyncBatchScheduler collects writes and flushes once per rAF.
 *
 * These tests verify:
 *  1. The scheduler coalesces N rapid writes into 1 flush.
 *  2. The scheduler handles different keys independently.
 *  3. Accumulated items are deduplicated.
 *  4. Disposal cancels pending work.
 *  5. Write count is O(1) per frame, not O(n) per event.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncBatchScheduler } from '../syncBatchScheduler';

describe('SyncBatchScheduler', () => {
  let scheduler: SyncBatchScheduler;
  let rafCallbacks: Array<() => void>;

  beforeEach(() => {
    rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks[id - 1] = () => {};
    });
    scheduler = new SyncBatchScheduler();
  });

  afterEach(() => {
    scheduler.dispose();
    vi.unstubAllGlobals();
  });

  // ═══════════════════════════════════════════════════════════════════
  // 1. COALESCING: multiple writes → single flush
  // ═══════════════════════════════════════════════════════════════════

  it('coalesces multiple writes into a single rAF flush', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    const fn3 = vi.fn();

    scheduler.enqueue('rooms', fn1);
    scheduler.enqueue('parents', fn2);
    scheduler.enqueue('mDirect', fn3);

    // Nothing called yet
    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).not.toHaveBeenCalled();
    expect(fn3).not.toHaveBeenCalled();

    // Only 1 rAF requested for 3 enqueues
    expect(rafCallbacks.length).toBe(1);

    rafCallbacks[0]();
    expect(fn1).toHaveBeenCalledOnce();
    expect(fn2).toHaveBeenCalledOnce();
    expect(fn3).toHaveBeenCalledOnce();
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. DEDUPLICATION: same key overwrites pending write
  // ═══════════════════════════════════════════════════════════════════

  it('deduplicates writes to the same key — only last one runs', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    scheduler.enqueue('rooms', fn1);
    scheduler.enqueue('rooms', fn2);

    expect(rafCallbacks.length).toBe(1);
    rafCallbacks[0]();

    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).toHaveBeenCalledOnce();
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. ACCUMULATION: enqueueAccumulate merges items
  // ═══════════════════════════════════════════════════════════════════

  it('accumulates and deduplicates items across calls', () => {
    const flush = vi.fn();
    scheduler.setFlushHandler('rooms', (items: string[]) => flush(items));

    scheduler.enqueueAccumulate('rooms', 'room1');
    scheduler.enqueueAccumulate('rooms', 'room2');
    scheduler.enqueueAccumulate('rooms', 'room1'); // duplicate
    scheduler.enqueueAccumulate('rooms', 'room3');

    expect(rafCallbacks.length).toBe(1);
    rafCallbacks[0]();

    expect(flush).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledWith(['room1', 'room2', 'room3']);
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. EMPTY: no rAF when nothing pending
  // ═══════════════════════════════════════════════════════════════════

  it('does not request rAF when queue is empty', () => {
    expect(rafCallbacks.length).toBe(0);
  });

  it('does not request rAF after flush if no new writes', () => {
    scheduler.enqueue('rooms', vi.fn());
    rafCallbacks[0]();
    expect(rafCallbacks.length).toBe(1); // no second rAF
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. CLEANUP: dispose cancels pending work
  // ═══════════════════════════════════════════════════════════════════

  it('dispose cancels pending flush', () => {
    const fn = vi.fn();
    scheduler.enqueue('rooms', fn);
    scheduler.dispose();
    rafCallbacks[0]();
    expect(fn).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════════════════
  // 6. POST-FLUSH: new writes get a new rAF
  // ═══════════════════════════════════════════════════════════════════

  it('schedules new rAF for writes after a flush', () => {
    scheduler.enqueue('rooms', vi.fn());
    rafCallbacks[0]();

    const fn2 = vi.fn();
    scheduler.enqueue('rooms', fn2);
    expect(rafCallbacks.length).toBe(2);
    rafCallbacks[1]();
    expect(fn2).toHaveBeenCalledOnce();
  });

  // ═══════════════════════════════════════════════════════════════════
  // 7. PERFORMANCE: rapid-fire events → O(1) flushes
  //
  // This is the critical test. Without batching, N events = N atom writes.
  // With batching, N events = 1 rAF request = 1 flush.
  // ═══════════════════════════════════════════════════════════════════

  it('100 rapid-fire events produce exactly 1 rAF request', () => {
    for (let i = 0; i < 100; i++) {
      scheduler.enqueueAccumulate('rooms', `!room${i}:example.com`);
    }
    expect(rafCallbacks.length).toBe(1);
  });

  it('500 events across 5 keys produce exactly 1 rAF request', () => {
    const keys = ['rooms', 'invites', 'parents', 'mDirect', 'typing'];
    for (let i = 0; i < 500; i++) {
      scheduler.enqueueAccumulate(keys[i % 5], `item${i}`);
    }
    expect(rafCallbacks.length).toBe(1);
  });

  it('flush callback receives all 100 accumulated items', () => {
    const flush = vi.fn();
    scheduler.setFlushHandler('rooms', flush);

    for (let i = 0; i < 100; i++) {
      scheduler.enqueueAccumulate('rooms', `!room${i}:example.com`);
    }

    rafCallbacks[0]();
    expect(flush).toHaveBeenCalledOnce();
    const items = flush.mock.calls[0][0] as string[];
    expect(items.length).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Simulated sync scenario: measure atom write reduction
// ═══════════════════════════════════════════════════════════════════

describe('Sync event batching simulation', () => {
  let rafCallbacks: Array<() => void>;

  beforeEach(() => {
    rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('WITHOUT batching: 50 room events → 50 atom writes', () => {
    // Simulates the old code path where each event directly calls setAtom
    const setAtom = vi.fn();

    // 50 ClientEvent.Room events fire synchronously during sync
    for (let i = 0; i < 50; i++) {
      setAtom({ type: 'PUT', roomId: `!room${i}:example.com` });
    }

    // Each event triggered a separate atom write
    expect(setAtom).toHaveBeenCalledTimes(50);
  });

  it('WITH batching: 50 room events → 1 atom write', () => {
    const setAtom = vi.fn();
    const scheduler = new SyncBatchScheduler();

    const pendingPuts = new Set<string>();

    const scheduleFlush = () => {
      scheduler.enqueue('rooms', () => {
        setAtom({
          type: 'PUT_BATCH',
          puts: Array.from(pendingPuts),
          deletes: [],
        });
        pendingPuts.clear();
      });
    };

    // 50 ClientEvent.Room events fire synchronously during sync
    for (let i = 0; i < 50; i++) {
      pendingPuts.add(`!room${i}:example.com`);
      scheduleFlush();
    }

    // No atom writes yet — waiting for rAF
    expect(setAtom).not.toHaveBeenCalled();

    // Trigger the rAF flush
    expect(rafCallbacks.length).toBe(1);
    rafCallbacks[0]();

    // Exactly 1 atom write for all 50 events
    expect(setAtom).toHaveBeenCalledOnce();
    const action = setAtom.mock.calls[0][0];
    expect(action.type).toBe('PUT_BATCH');
    expect(action.puts.length).toBe(50);

    scheduler.dispose();
  });

  it('WITH batching: 200 space.child events → 1 atom write', () => {
    const setAtom = vi.fn();
    const scheduler = new SyncBatchScheduler();

    const pendingPuts: Array<{ parent: string; children: string[] }> = [];
    const pendingDeletes = new Set<string>();

    const scheduleFlush = () => {
      scheduler.enqueue('parents', () => {
        setAtom({
          type: 'PUT_BATCH',
          puts: [...pendingPuts],
          deletes: Array.from(pendingDeletes),
        });
        pendingPuts.length = 0;
        pendingDeletes.clear();
      });
    };

    // 200 RoomStateEvent.Events with m.space.child type
    for (let i = 0; i < 200; i++) {
      pendingPuts.push({
        parent: `!space${i % 10}:example.com`,
        children: [`!room${i}:example.com`],
      });
      scheduleFlush();
    }

    expect(setAtom).not.toHaveBeenCalled();
    rafCallbacks[0]();
    expect(setAtom).toHaveBeenCalledOnce();
    expect(setAtom.mock.calls[0][0].puts.length).toBe(200);

    scheduler.dispose();
  });

  it('Mixed puts and deletes coalesce correctly', () => {
    const setAtom = vi.fn();
    const scheduler = new SyncBatchScheduler();

    const pendingPuts = new Set<string>();
    const pendingDeletes = new Set<string>();

    const scheduleFlush = () => {
      scheduler.enqueue('rooms', () => {
        setAtom({
          type: 'PUT_BATCH',
          puts: Array.from(pendingPuts),
          deletes: Array.from(pendingDeletes),
        });
        pendingPuts.clear();
        pendingDeletes.clear();
      });
    };

    // Add rooms
    pendingPuts.add('!room1:example.com');
    pendingPuts.add('!room2:example.com');
    scheduleFlush();

    // Delete one of them
    pendingPuts.delete('!room1:example.com');
    pendingDeletes.add('!room1:example.com');
    scheduleFlush();

    // Add more
    pendingPuts.add('!room3:example.com');
    scheduleFlush();

    rafCallbacks[0]();
    expect(setAtom).toHaveBeenCalledOnce();
    const action = setAtom.mock.calls[0][0];
    expect(action.puts).toEqual(['!room2:example.com', '!room3:example.com']);
    expect(action.deletes).toEqual(['!room1:example.com']);

    scheduler.dispose();
  });
});
