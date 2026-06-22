import { useEffect, useState } from 'react';
import { RoomEvent } from 'matrix-js-sdk';
import { useMatrixClient } from './useMatrixClient';

const HYDRATION_TIMEOUT_MS = 12000;

export type RoomHydration = 'live' | 'loading' | 'unknown';

/**
 * Whether a room's data has live-synced this session.
 *
 * Under sliding sync a room that's out of the window hasn't been hydrated yet — its
 * name/avatar/unread may be a stale cache paint or absent. `isRoomLiveSynced` (SDK
 * fork) reports when it has. Returns 'loading' until then, 'live' once it syncs, and
 * 'unknown' if it STILL hasn't after HYDRATION_TIMEOUT_MS — at which point the UI
 * settles a "?" instead of pulsing forever. Self-heals: if an 'unknown' room later
 * syncs, it flips back to 'live'. Classic /sync (no isRoomLiveSynced) ⇒ always 'live'.
 */
export const useRoomHydration = (roomId: string): RoomHydration => {
  const mx = useMatrixClient();
  const isLive = (): boolean =>
    (mx as unknown as { isRoomLiveSynced?: (id: string) => boolean }).isRoomLiveSynced?.(roomId) ?? true;

  const live = isLive();
  const [, force] = useState(0);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    setTimedOut(false);
    if (live) return undefined;
    const room = mx.getRoom(roomId);
    // Re-render the instant this room gets data (so it can flip to 'live'); the room
    // emits Timeline / membership events as it hydrates.
    const recheck = (): void => {
      if (isLive()) force((n) => n + 1);
    };
    room?.on(RoomEvent.Timeline, recheck);
    room?.on(RoomEvent.MyMembership, recheck);
    const timer = window.setTimeout(() => setTimedOut(true), HYDRATION_TIMEOUT_MS);
    return () => {
      room?.removeListener(RoomEvent.Timeline, recheck);
      room?.removeListener(RoomEvent.MyMembership, recheck);
      window.clearTimeout(timer);
    };
    // isLive() reads live SDK state; `live` (its snapshot) drives re-subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, mx, live]);

  if (live) return 'live';
  return timedOut ? 'unknown' : 'loading';
};
