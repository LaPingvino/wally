import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { useMatrixClient } from './useMatrixClient';
import { allRoomsAtom } from '../state/room-list/roomList';
import { allInvitesAtom } from '../state/room-list/inviteList';

/**
 * Leave a room — or decline an invite, which is the same request — and drop it
 * from the lists right away.
 *
 * The mirror image of useJoinRoom, and for the same reason: both room lists are
 * bound to RoomEvent.MyMembership, which only fires when sync DELIVERS the
 * leave, so a declined invite otherwise sits in the inbox (badge and all) for a
 * whole round trip after the server has already dropped it.
 *
 * DELETE from both lists rather than guessing which one the room is in: leaving
 * is the one operation that is correct for a joined room and an invite alike,
 * and DELETE on a list that never held the room is a no-op.
 *
 * As with joining, the worst case is that the next INITIALIZE re-reads the
 * store and briefly reinstates the room until the real membership lands — the
 * old behaviour, never something wrong.
 */
export const useLeaveRoom = (): ((roomId: string) => Promise<void>) => {
  const mx = useMatrixClient();
  const setAllRooms = useSetAtom(allRoomsAtom);
  const setAllInvites = useSetAtom(allInvitesAtom);

  return useCallback(
    async (roomId: string) => {
      await mx.leave(roomId);
      setAllRooms({ type: 'DELETE', roomId });
      setAllInvites({ type: 'DELETE', roomId });
    },
    [mx, setAllRooms, setAllInvites]
  );
};
