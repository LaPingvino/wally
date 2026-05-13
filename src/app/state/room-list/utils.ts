import { useSetAtom, WritableAtom } from 'jotai';
import { ClientEvent, ClientEventHandlerMap, MatrixClient, Room, RoomEvent, SyncState } from 'matrix-js-sdk';
import { useEffect } from 'react';
import { Membership } from '../../../types/matrix/room';
import { SyncBatchScheduler } from '../syncBatchScheduler';

export type RoomsAction =
  | {
      type: 'INITIALIZE';
      rooms: string[];
    }
  | {
      type: 'PUT' | 'DELETE';
      roomId: string;
    }
  | {
      type: 'PUT_BATCH';
      puts: string[];
      deletes: string[];
    };

export const useBindRoomsWithMembershipsAtom = (
  mx: MatrixClient,
  roomsAtom: WritableAtom<string[], [RoomsAction], undefined>,
  memberships: Membership[]
) => {
  const setRoomsAtom = useSetAtom(roomsAtom);

  useEffect(() => {
    const scheduler = new SyncBatchScheduler();

    // Pending changes accumulated between rAF flushes
    const pendingPuts = new Set<string>();
    const pendingDeletes = new Set<string>();

    const scheduleFlush = () => {
      scheduler.enqueue(`rooms-${memberships.join(',')}`, () => {
        if (pendingPuts.size === 0 && pendingDeletes.size === 0) return;
        setRoomsAtom({
          type: 'PUT_BATCH',
          puts: Array.from(pendingPuts),
          deletes: Array.from(pendingDeletes),
        });
        pendingPuts.clear();
        pendingDeletes.clear();
      });
    };

    const satisfyMembership = (room: Room): boolean =>
      memberships.includes(room.getMyMembership() as Membership);
    const initRooms = () =>
      setRoomsAtom({
        type: 'INITIALIZE',
        rooms: mx
          .getRooms()
          .filter(satisfyMembership)
          .map((room) => room.roomId),
      });
    initRooms();

    // Re-read rooms on initial sync completion and reconnect, not on every sync batch.
    // Ongoing membership changes are handled by handleAddRoom / handleMembershipChange.
    const handleSync: ClientEventHandlerMap[ClientEvent.Sync] = (state) => {
      if (state === SyncState.Prepared || state === SyncState.Catchup) initRooms();
    };

    const handleAddRoom = (room: Room) => {
      if (satisfyMembership(room)) {
        pendingDeletes.delete(room.roomId);
        pendingPuts.add(room.roomId);
        scheduleFlush();
      }
    };

    const handleMembershipChange = (room: Room) => {
      if (satisfyMembership(room)) {
        pendingDeletes.delete(room.roomId);
        pendingPuts.add(room.roomId);
      } else {
        pendingPuts.delete(room.roomId);
        pendingDeletes.add(room.roomId);
      }
      scheduleFlush();
    };

    const handleDeleteRoom = (roomId: string) => {
      pendingPuts.delete(roomId);
      pendingDeletes.add(roomId);
      scheduleFlush();
    };

    mx.on(ClientEvent.Sync, handleSync);
    mx.on(ClientEvent.Room, handleAddRoom);
    mx.on(RoomEvent.MyMembership, handleMembershipChange);
    mx.on(ClientEvent.DeleteRoom, handleDeleteRoom);
    return () => {
      mx.removeListener(ClientEvent.Sync, handleSync);
      mx.removeListener(ClientEvent.Room, handleAddRoom);
      mx.removeListener(RoomEvent.MyMembership, handleMembershipChange);
      mx.removeListener(ClientEvent.DeleteRoom, handleDeleteRoom);
      scheduler.dispose();
    };
  }, [mx, memberships, setRoomsAtom]);
};

export const compareRoomsEqual = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  return a.every((roomId, roomIdIndex) => roomId === b[roomIdIndex]);
};

// A room counts as a "probable broken invite" when the SDK has it in the
// store but cannot determine our membership from invite_state — typically
// because the inviting server delivered a malformed m.room.member event
// (e.g., Continuwuity Apr 13–May 1 regression stripped type/state_key from
// federated invites). Such rooms have getMyMembership() === 'leave' and no
// m.room.member state event for our user. We surface them as invites so
// the user can act on them even when the SDK can't reconstruct state.
export const isProbableBrokenInvite = (mx: MatrixClient, room: Room): boolean => {
  const myUserId = mx.getUserId();
  if (!myUserId) return false;
  const myMembership = room.getMyMembership() as Membership;
  if (
    myMembership === Membership.Join ||
    myMembership === Membership.Invite ||
    myMembership === Membership.Ban ||
    myMembership === Membership.Knock
  ) {
    return false;
  }
  const memberEvent = room.currentState.getStateEvents('m.room.member', myUserId);
  return !memberEvent;
};

// Augments a rooms atom with rooms that pass isProbableBrokenInvite.
// PUT-only: removal from the atom is left to the regular membership-based
// binder, which fires on MyMembership transitions to join/leave/ban.
export const useBindBrokenInvitesAtom = (
  mx: MatrixClient,
  roomsAtom: WritableAtom<string[], [RoomsAction], undefined>
) => {
  const setRoomsAtom = useSetAtom(roomsAtom);

  useEffect(() => {
    const scheduler = new SyncBatchScheduler();
    const pendingPuts = new Set<string>();

    const scheduleFlush = () => {
      scheduler.enqueue('broken-invites', () => {
        if (pendingPuts.size === 0) return;
        setRoomsAtom({
          type: 'PUT_BATCH',
          puts: Array.from(pendingPuts),
          deletes: [],
        });
        pendingPuts.clear();
      });
    };

    const checkRoom = (room: Room) => {
      if (isProbableBrokenInvite(mx, room)) {
        pendingPuts.add(room.roomId);
        scheduleFlush();
      }
    };

    const rescanAll = () => {
      mx.getRooms().forEach(checkRoom);
    };

    const handleSync: ClientEventHandlerMap[ClientEvent.Sync] = (state) => {
      if (state === SyncState.Prepared || state === SyncState.Catchup) rescanAll();
    };

    const handleAddRoom = (room: Room) => checkRoom(room);

    rescanAll();

    mx.on(ClientEvent.Sync, handleSync);
    mx.on(ClientEvent.Room, handleAddRoom);
    return () => {
      mx.removeListener(ClientEvent.Sync, handleSync);
      mx.removeListener(ClientEvent.Room, handleAddRoom);
      scheduler.dispose();
    };
  }, [mx, setRoomsAtom]);
};
