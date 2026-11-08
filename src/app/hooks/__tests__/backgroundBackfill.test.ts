import { describe, it, expect } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import { scoreRoom } from '../useBackgroundBackfill';

function room(events: number, backToken: string | null, opts: { id?: string } = {}): Room {
  return {
    roomId: opts.id ?? '!r:x',
    client: { getUserId: () => '@me:x' },
    getLiveTimeline: () => ({
      getEvents: () => new Array(events).fill({ getId: () => '$e' }),
      getPaginationToken: () => backToken,
    }),
    getUnreadNotificationCount: () => 1,
    getEventReadUpTo: () => null,
    getLastActiveTimestamp: () => Date.now(),
  } as unknown as Room;
}

const ctx = { currentRoomId: '!r:x', threadsRoomId: null };

describe('backfill scheduler scoring', () => {
  it('wants a shallow room that has history left', () => {
    expect(scoreRoom(room(5, 'tok'), ctx, 50)).toBeGreaterThan(0);
  });

  it("drops a short room that reached its start (it hogged a slot every tick)", () => {
    expect(scoreRoom(room(5, null), ctx, 50)).toBe(-1);
  });

  it('drops a room at the target depth', () => {
    expect(scoreRoom(room(50, 'tok'), ctx, 50)).toBe(-1);
  });
});
