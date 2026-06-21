/**
 * Regression tests for getUnreadInfo (src/app/utils/room.ts).
 *
 * Two regressions are pinned here:
 *
 *  1. NEVER trust the server's notification count. getUnreadNotificationCount returns the
 *     HOMESERVER's count, which includes member/state/bridge noise the client walk skips and does
 *     not clear reliably under sliding sync. A previous fix fed it into the displayed total, which
 *     inflated space/folder aggregates with phantom unreads that crept up over time. These tests use
 *     a spy that POISONS the server count and assert getUnreadInfo never calls it.
 *
 *  2. NEVER place the read marker by timestamp. Cross-server clock skew resurrected read rooms.
 *     Read state is placed by receipt POSITION (getEventReadUpTo / hasUserReadEvent) only.
 */

import { describe, it, expect, vi } from 'vitest';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { getUnreadInfo } from '../room';

const ME = '@me:server';
const OTHER = '@other:server';

type EvOpts = { id: string; sender: string; type?: string };
const ev = ({ id, sender, type = 'm.room.message' }: EvOpts): MatrixEvent =>
  ({
    getId: () => id,
    getSender: () => sender,
    getTs: () => 0,
    getType: () => type,
    isRedacted: () => false,
    getRelation: () => undefined,
    getContent: () => ({ msgtype: 'm.text' }),
  }) as unknown as MatrixEvent;

type RoomOpts = {
  events: MatrixEvent[];
  readUpTo?: string | null; // getEventReadUpTo result (null = marker not loaded)
  hasReadHead?: boolean; // hasUserReadEvent(head)
};

// getUnreadNotificationCount is wired to a poison value; the assertion that matters is that the
// fixed getUnreadInfo never CALLS it.
const makeRoom = (opts: RoomOpts) => {
  const serverCountSpy = vi.fn(() => 9999);
  const room = {
    roomId: '!r:server',
    getLiveTimeline: () => ({ getEvents: () => opts.events }),
    getEventReadUpTo: () => opts.readUpTo ?? null,
    hasUserReadEvent: () => opts.hasReadHead ?? false,
    getUnreadNotificationCount: serverCountSpy,
  } as unknown as Room;
  return { room, serverCountSpy };
};

const makeMx = (highlightIds: string[] = []): MatrixClient =>
  ({
    getUserId: () => ME,
    // no getSlidingSync → classic path, no live-sync gating (gating is tested separately)
    getPushActionsForEvent: (e: MatrixEvent) =>
      highlightIds.includes(e.getId() as string) ? { tweaks: { highlight: true } } : { tweaks: {} },
  }) as unknown as MatrixClient;

describe('getUnreadInfo', () => {
  it('marker loaded mid-timeline → exact count of later notifying events from others', () => {
    const events = [
      ev({ id: 'e0', sender: ME }),
      ev({ id: 'e1', sender: OTHER }),
      ev({ id: 'e2', sender: OTHER }),
    ];
    const { room, serverCountSpy } = makeRoom({ events, readUpTo: 'e0' });
    const info = getUnreadInfo(room, makeMx());
    expect(info.total).toBe(2);
    expect(info.highlight).toBe(0);
    expect(serverCountSpy).not.toHaveBeenCalled();
  });

  it('marker loaded at head → read → 0', () => {
    const events = [ev({ id: 'e0', sender: OTHER }), ev({ id: 'e1', sender: OTHER })];
    const { room, serverCountSpy } = makeRoom({ events, readUpTo: 'e1' });
    const info = getUnreadInfo(room, makeMx());
    expect(info.total).toBe(0);
    expect(serverCountSpy).not.toHaveBeenCalled();
  });

  it('marker NOT loaded but head is read → 0 (and ignores a poisoned server count)', () => {
    // This is the exact regression: previously this returned the server count (9999).
    const events = [ev({ id: 'e9', sender: OTHER })];
    const { room, serverCountSpy } = makeRoom({ events, readUpTo: null, hasReadHead: true });
    const info = getUnreadInfo(room, makeMx());
    expect(info.total).toBe(0);
    expect(info.highlight).toBe(0);
    expect(serverCountSpy).not.toHaveBeenCalled();
  });

  it('marker NOT loaded and head unread → noise-filtered lower bound, NOT the server count', () => {
    const events = [
      ev({ id: 'e0', sender: OTHER }),
      ev({ id: 'e1', sender: ME }), // own → skipped
      ev({ id: 'e2', sender: OTHER }),
      ev({ id: 'm0', sender: OTHER, type: 'm.room.member' }), // member noise → skipped
    ];
    const { room, serverCountSpy } = makeRoom({ events, readUpTo: null, hasReadHead: false });
    const info = getUnreadInfo(room, makeMx());
    expect(info.total).toBe(2); // e0 + e2; never 9999
    expect(serverCountSpy).not.toHaveBeenCalled();
  });

  it('counts highlights via push actions', () => {
    const events = [
      ev({ id: 'e0', sender: ME }),
      ev({ id: 'e1', sender: OTHER }),
      ev({ id: 'e2', sender: OTHER }),
    ];
    const { room } = makeRoom({ events, readUpTo: 'e0' });
    const info = getUnreadInfo(room, makeMx(['e2']));
    expect(info.total).toBe(2);
    expect(info.highlight).toBe(1);
  });

  it('empty timeline → no count', () => {
    const { room } = makeRoom({ events: [], readUpTo: null });
    const info = getUnreadInfo(room, makeMx());
    expect(info.total).toBe(0);
    expect(info.highlight).toBe(0);
  });
});
