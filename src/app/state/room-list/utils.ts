import { useSetAtom, WritableAtom } from 'jotai';
import { ClientEvent, ClientEventHandlerMap, MatrixClient, Room, RoomEvent, SyncState } from 'matrix-js-sdk';
import { useEffect, useRef } from 'react';
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
  const schedulerRef = useRef<SyncBatchScheduler | null>(null);

  useEffect(() => {
    const scheduler = new SyncBatchScheduler();
    schedulerRef.current = scheduler;

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
      !!memberships.find((membership) => membership === room.getMyMembership());
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
