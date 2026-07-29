import { useCallback } from 'react';
import { Room } from 'matrix-js-sdk';
import { useSetAtom } from 'jotai';
import { useMatrixClient } from './useMatrixClient';
import { allRoomsAtom } from '../state/room-list/roomList';
import { allInvitesAtom } from '../state/room-list/inviteList';
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
 * asking again: the room joins allRoomsAtom and LEAVES allInvitesAtom, and it
 * becomes visible everywhere at once — the card flips to "View", the route
 * provider swaps in the timeline, JoinBeforeNavigate's auto-nav effect fires for
 * spaces/DMs, and the invite row + inbox badge clear. The room's own contents
 * fill in from the sync that joinRoom just poked.
 *
 * Both halves are needed and for the same reason. An accepted invite is one room
 * in two lists, each bound to the same MyMembership event: PUT alone opens the
 * chat but leaves the invite sitting in the inbox, still offering to join a room
 * you're already in. (mx.getRoom() still says 'invite' here either way — the SDK
 * builds joinRoom's return value with syncApi.createRoom and never puts it in
 * the store, so nothing about local membership changes until sync lands.)
 *
 * Worst case the optimistic state is dropped by the next INITIALIZE (a Prepared
 * / Catchup resync re-reads memberships from the store) and reinstated a moment
 * later when the membership actually lands — i.e. it degrades to the old
 * behaviour, never to something wrong. Nothing re-adds the invite behind our
 * back in the meantime: the broken-invite binder ignores rooms whose membership
 * is 'invite'.
 */
export const useJoinRoom = (): ((roomIdOrAlias: string, viaServers?: string[]) => Promise<Room>) => {
  const mx = useMatrixClient();
  const setAllRooms = useSetAtom(allRoomsAtom);
  const setAllInvites = useSetAtom(allInvitesAtom);

  return useCallback(
    async (roomIdOrAlias: string, viaServers?: string[]) => {
      const room = await joinRoom(mx, roomIdOrAlias, viaServers);
      setAllRooms({ type: 'PUT', roomId: room.roomId });
      setAllInvites({ type: 'DELETE', roomId: room.roomId });
      return room;
    },
    [mx, setAllRooms, setAllInvites]
  );
};
