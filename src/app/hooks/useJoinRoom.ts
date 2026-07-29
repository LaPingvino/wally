import { useCallback } from 'react';
import { Room } from 'matrix-js-sdk';
import { useSetAtom } from 'jotai';
import { useMatrixClient } from './useMatrixClient';
import { allRoomsAtom } from '../state/room-list/roomList';
import { joinRoom } from '../utils/join';

/**
 * Join a room and show it right away.
 *
 * The room list is bound to RoomEvent.MyMembership, which only fires when sync
 * DELIVERS the join — so a successful join otherwise leaves the UI sitting on a
 * "Joining…" spinner for a whole round trip, and every route provider keeps
 * rendering JoinBeforeNavigate because allRooms doesn't contain the room yet.
 *
 * The server has told us the join succeeded, so record it locally instead of
 * asking again: one PUT into allRoomsAtom and the room becomes visible
 * everywhere at once — the card flips to "View", the route provider swaps in
 * the timeline, JoinBeforeNavigate's auto-nav effect fires for spaces/DMs. The
 * room's own contents fill in from the sync that joinRoom just poked.
 *
 * Worst case the optimistic entry is dropped by the next INITIALIZE (a Prepared
 * / Catchup resync re-reads memberships from the store) and reinstated a moment
 * later when the membership actually lands — i.e. it degrades to today's
 * behaviour, never to something wrong.
 */
export const useJoinRoom = (): ((roomIdOrAlias: string, viaServers?: string[]) => Promise<Room>) => {
  const mx = useMatrixClient();
  const setAllRooms = useSetAtom(allRoomsAtom);

  return useCallback(
    async (roomIdOrAlias: string, viaServers?: string[]) => {
      const room = await joinRoom(mx, roomIdOrAlias, viaServers);
      setAllRooms({ type: 'PUT', roomId: room.roomId });
      return room;
    },
    [mx, setAllRooms]
  );
};
