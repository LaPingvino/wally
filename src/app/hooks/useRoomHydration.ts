import { useEffect, useState } from 'react';
import { RoomEvent } from 'matrix-js-sdk';
import { useMatrixClient } from './useMatrixClient';

const HYDRATION_TIMEOUT_MS = 12000;

export type RoomHydration = 'live' | 'loading' | 'unknown';

/**
 * Whether a room actually has content to show.
 *
 * A room is "loaded" if EITHER it has live-synced this session (isRoomLiveSynced,
 * SDK fork) OR it already has real timeline content. The OR matters: a room
 * rehydrated from the persistent cache has a full timeline but was NOT live-synced
 * this session, so keying purely off isRoomLiveSynced wrongly decays a fully-loaded
 * (from cache) room to "?". We only want the indicator for rooms with genuinely no
 * content yet.
 *
 * Returns 'loading' while there's no content (and not yet live), 'live' once content
 * is present or it syncs, and 'unknown' if STILL nothing after HYDRATION_TIMEOUT_MS
 * — at which point the UI settles a "?" instead of pulsing forever. Self-heals: if an
 * 'unknown' room later gets content, it flips back to 'live'. Classic /sync ⇒ 'live'.
 */
export const useRoomHydration = (roomId: string): RoomHydration => {
  const mx = useMatrixClient();
  const isLive = (): boolean =>
    (mx as unknown as { isRoomLiveSynced?: (id: string) => boolean }).isRoomLiveSynced?.(roomId) ?? true;
  const hasContent = (): boolean => {
    const room = mx.getRoom(roomId);
    return !!room && room.getLiveTimeline().getEvents().length > 0;
  };

  const loaded = isLive() || hasContent();
  const [, force] = useState(0);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    setTimedOut(false);
    if (loaded) return undefined;
    const room = mx.getRoom(roomId);
    // Re-render the instant this room gets content / live-syncs.
    const recheck = (): void => {
      if (isLive() || hasContent()) force((n) => n + 1);
    };
    room?.on(RoomEvent.Timeline, recheck);
    room?.on(RoomEvent.MyMembership, recheck);
    const timer = window.setTimeout(() => setTimedOut(true), HYDRATION_TIMEOUT_MS);
    return () => {
      room?.removeListener(RoomEvent.Timeline, recheck);
      room?.removeListener(RoomEvent.MyMembership, recheck);
      window.clearTimeout(timer);
    };
    // isLive()/hasContent() read live SDK state; `loaded` (their snapshot) drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, mx, loaded]);

  if (loaded) return 'live';
  return timedOut ? 'unknown' : 'loading';
};
