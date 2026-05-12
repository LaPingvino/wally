import { useEffect, useMemo } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import { RoomEvent } from 'matrix-js-sdk';
import { useMatrixClient } from './useMatrixClient';

/**
 * Global set of room IDs that have the m.favourite tag. Recomputed
 * once per RoomEvent.Tags fire by the driver below. Consumers read
 * this shared atom and do an O(roomIds) Set lookup rather than each
 * walking the full room list and probing tags themselves.
 *
 * History: the original implementation ran a 594-room
 * mx.getRoom(id).tags lookup .filter() on every render of every
 * caller (5 call sites — FavoritesTab is always mounted, plus a
 * page-level consumer each in Home/Direct/Space/Favorites). On a
 * 594-room account this dominated steady-state CPU (~13% of total
 * profile time in the function alone).
 */
const favoriteRoomIdsAtom = atom<ReadonlySet<string>>(new Set<string>());

/**
 * Mount once near the app shell. Subscribes to RoomEvent.Tags exactly
 * once and rebuilds the favorites set on each fire. Renders consumers
 * via the atom rather than 5 separate Tags subscriptions.
 */
export function useFavoriteRoomsDriver(): void {
  const mx = useMatrixClient();
  const setFavorites = useSetAtom(favoriteRoomIdsAtom);

  useEffect(() => {
    const recompute = () => {
      const next = new Set<string>();
      for (const room of mx.getRooms()) {
        if (room.tags['m.favourite']) next.add(room.roomId);
      }
      setFavorites(next);
    };
    recompute();
    mx.on(RoomEvent.Tags, recompute);
    return () => {
      mx.off(RoomEvent.Tags, recompute);
    };
  }, [mx, setFavorites]);
}

/**
 * Pure helper exported for tests. Kept separate so we can assert
 * referential stability and behavior without spinning up React.
 */
export function filterFavoriteRoomIds(
  roomIds: string[],
  favorites: ReadonlySet<string>
): string[] {
  return roomIds.filter((id) => favorites.has(id));
}

/**
 * Returns the subset of the given room IDs that have m.favourite.
 *
 * MUST stay memoized. The first version of this hook did
 * `roomIds.filter(id => mx.getRoom(id)?.tags['m.favourite'])` directly
 * in the render path with no useMemo. On a 594-room account that
 * O(N) walk on every render of every caller cost ~13% of total CPU
 * profile time, and the per-hook `mx.on(RoomEvent.Tags)` subscription
 * forced a re-render on every tag change.
 */
export function useFavoriteRooms(roomIds: string[]): string[] {
  const favorites = useAtomValue(favoriteRoomIdsAtom);
  return useMemo(
    () => filterFavoriteRoomIds(roomIds, favorites),
    [roomIds, favorites]
  );
}
