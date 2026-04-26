import { useEffect, useRef } from 'react';
import {
  ClientEvent,
  type MatrixClient,
  NotificationCountType,
  Room,
  RoomEvent,
} from 'matrix-js-sdk';
import { useMatrixClient } from './useMatrixClient';
import { useSelectedRoom } from './router/useSelectedRoom';

// Target depth measured against `room.getLiveTimeline().getEvents().length`.
// 50 is enough that the timeline "feels populated" for the user — relations
// aggregate, room ordering by recency works, and the first scroll back doesn't
// need a network round trip.
const TARGET_DEPTH = 50;

// How many rooms can be backfilling at once. Concurrent fetches are bounded so
// we don't blast the homeserver, and so the scheduler can react quickly when
// priority changes (currently-running rooms get aborted to free a slot).
const MAX_CONCURRENT = 3;

// How often to recompute priorities even if no event triggered a tick. Defends
// against missed signals — a room becoming "stale" (not currently viewed) and
// then becoming hot again should resume backfill within this window.
const TICK_INTERVAL_MS = 30_000;

type Score = { room: Room; score: number };

function scoreRoom(room: Room, currentRoomId: string | undefined): number {
  const eventCount = room.getLiveTimeline().getEvents().length;
  if (eventCount >= TARGET_DEPTH) return -1;

  let score = 0;
  if (room.roomId === currentRoomId) score += 100;

  const highlight = room.getUnreadNotificationCount(NotificationCountType.Highlight);
  const total = room.getUnreadNotificationCount(NotificationCountType.Total);
  if (highlight > 0) score += 30;
  else if (total > 0) score += 20;

  // Recent activity → user more likely to navigate here.
  const lastActivity = room.getLastActiveTimestamp();
  if (lastActivity) {
    const hoursSince = (Date.now() - lastActivity) / 3_600_000;
    if (hoursSince < 1) score += 10;
    else if (hoursSince < 24) score += 5;
  }

  return score;
}

class BackfillScheduler {
  private inFlight = new Map<string, AbortController>();

  constructor(private mx: MatrixClient) {}

  tick(currentRoomId: string | undefined): void {
    const scored: Score[] = this.mx
      .getRooms()
      .map((room) => ({ room, score: scoreRoom(room, currentRoomId) }))
      .filter((s) => s.score > 0);

    scored.sort((a, b) => b.score - a.score);
    const winners = scored.slice(0, MAX_CONCURRENT);
    const winnerIds = new Set(winners.map((s) => s.room.roomId));

    // Abort any in-flight backfill that fell out of the top-N. This lets the
    // newly hot rooms grab the slot immediately rather than queueing.
    for (const [roomId, controller] of this.inFlight) {
      if (!winnerIds.has(roomId)) {
        controller.abort();
        this.inFlight.delete(roomId);
      }
    }

    for (const { room } of winners) {
      if (this.inFlight.has(room.roomId)) continue;
      const controller = new AbortController();
      this.inFlight.set(room.roomId, controller);
      const sdkRoom = room as unknown as {
        backgroundBackfill?: (opts: {
          targetDepth: number;
          abortSignal?: AbortSignal;
          chunkSize?: number;
        }) => Promise<void>;
      };
      const promise = sdkRoom.backgroundBackfill?.({
        targetDepth: TARGET_DEPTH,
        abortSignal: controller.signal,
        chunkSize: 8,
      });
      if (!promise) {
        // SDK predates the primitive (e.g. running against upstream
        // matrix-js-sdk without our fork). Backfill simply doesn't happen,
        // which is the same behaviour we had before — no regression.
        this.inFlight.delete(room.roomId);
        continue;
      }
      promise
        .catch((err) => {
          // Aborts are expected; anything else is worth logging.
          if (controller.signal.aborted) return;
          // eslint-disable-next-line no-console
          console.warn(`[backfill] ${room.roomId} backfill failed:`, err);
        })
        .finally(() => {
          if (this.inFlight.get(room.roomId) === controller) {
            this.inFlight.delete(room.roomId);
          }
        });
    }
  }

  stop(): void {
    for (const controller of this.inFlight.values()) controller.abort();
    this.inFlight.clear();
  }
}

/**
 * Drive a {@link BackfillScheduler} that incrementally hydrates each room's
 * timeline in the background, prioritised by user-facing signals (current
 * room, unread/highlight counts, recent activity).
 *
 * Runs once at the top of the client UI. The scheduler picks a few rooms per
 * tick, calls `room.backgroundBackfill` on them, and aborts any that drop
 * out of priority. Aim is that by the time the user navigates somewhere, the
 * SDK is already returning a populated timeline, so consumers like
 * RoomTimeline and ThreadsDrawer don't have to compensate for an empty cache.
 */
export const useBackgroundBackfill = (): void => {
  const mx = useMatrixClient();
  const selectedRoomId = useSelectedRoom();

  const schedulerRef = useRef<BackfillScheduler | undefined>(undefined);
  const selectedRoomIdRef = useRef<string | undefined>(selectedRoomId);
  selectedRoomIdRef.current = selectedRoomId;

  useEffect(() => {
    const scheduler = new BackfillScheduler(mx);
    schedulerRef.current = scheduler;

    const tick = () => scheduler.tick(selectedRoomIdRef.current);

    tick();
    const onSync = () => tick();
    const onTimeline = () => tick();
    mx.on(ClientEvent.Sync, onSync);
    mx.on(RoomEvent.Timeline, onTimeline);
    const intervalId = window.setInterval(tick, TICK_INTERVAL_MS);

    return () => {
      mx.off(ClientEvent.Sync, onSync);
      mx.off(RoomEvent.Timeline, onTimeline);
      window.clearInterval(intervalId);
      scheduler.stop();
      schedulerRef.current = undefined;
    };
  }, [mx]);

  // Selected-room changes don't need to tear down the scheduler — just nudge
  // it so the new "currently viewed" room gets max priority immediately.
  useEffect(() => {
    schedulerRef.current?.tick(selectedRoomId);
  }, [selectedRoomId]);
};
