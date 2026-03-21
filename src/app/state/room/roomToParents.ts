import { atom, useSetAtom } from 'jotai';
import {
  ClientEvent,
  MatrixClient,
  MatrixEvent,
  Room,
  RoomEvent,
  RoomStateEvent,
} from 'matrix-js-sdk';
import { useEffect } from 'react';
import { Membership, RoomToParents, StateEvent } from '../../../types/matrix/room';
import {
  getRoomToParents,
  getSpaceChildren,
  isSpace,
  isValidChild,
  mapParentWithChildren,
} from '../../utils/room';
import { SyncBatchScheduler } from '../syncBatchScheduler';

export type RoomToParentsAction =
  | {
      type: 'INITIALIZE';
      roomToParents: RoomToParents;
    }
  | {
      type: 'PUT';
      parent: string;
      children: string[];
    }
  | {
      type: 'PUT_BATCH';
      puts: Array<{ parent: string; children: string[] }>;
      deletes: string[];
    }
  | {
      type: 'DELETE';
      roomId: string;
    };

const baseRoomToParents = atom<RoomToParents>(new Map());

const cloneRoomToParents = (current: RoomToParents): RoomToParents => {
  const next = new Map(current);
  next.forEach((parents, child) => {
    next.set(child, new Set(parents));
  });
  return next;
};

const removeParent = (map: RoomToParents, roomId: string) => {
  map.delete(roomId);
  const noParentRooms: string[] = [];
  map.forEach((parents, child) => {
    parents.delete(roomId);
    if (parents.size === 0) noParentRooms.push(child);
  });
  noParentRooms.forEach((room) => map.delete(room));
};

export const roomToParentsAtom = atom<RoomToParents, [RoomToParentsAction], undefined>(
  (get) => get(baseRoomToParents),
  (get, set, action) => {
    if (action.type === 'INITIALIZE') {
      set(baseRoomToParents, action.roomToParents);
      return;
    }
    if (action.type === 'PUT') {
      const next = cloneRoomToParents(get(baseRoomToParents));
      mapParentWithChildren(next, action.parent, action.children);
      set(baseRoomToParents, next);
      return;
    }
    if (action.type === 'PUT_BATCH') {
      const next = cloneRoomToParents(get(baseRoomToParents));
      for (const roomId of action.deletes) removeParent(next, roomId);
      for (const { parent, children } of action.puts) mapParentWithChildren(next, parent, children);
      set(baseRoomToParents, next);
      return;
    }
    if (action.type === 'DELETE') {
      const next = cloneRoomToParents(get(baseRoomToParents));
      removeParent(next, action.roomId);
      set(baseRoomToParents, next);
    }
  }
);

export const useBindRoomToParentsAtom = (
  mx: MatrixClient,
  roomToParents: typeof roomToParentsAtom
) => {
  const setRoomToParents = useSetAtom(roomToParents);

  useEffect(() => {
    const scheduler = new SyncBatchScheduler();

    // Pending changes accumulated between rAF flushes
    const pendingPuts: Array<{ parent: string; children: string[] }> = [];
    const pendingDeletes = new Set<string>();

    const scheduleFlush = () => {
      scheduler.enqueue('parents', () => {
        if (pendingPuts.length === 0 && pendingDeletes.size === 0) return;
        setRoomToParents({
          type: 'PUT_BATCH',
          puts: [...pendingPuts],
          deletes: Array.from(pendingDeletes),
        });
        pendingPuts.length = 0;
        pendingDeletes.clear();
      });
    };

    setRoomToParents({ type: 'INITIALIZE', roomToParents: getRoomToParents(mx) });

    const handleAddRoom = (room: Room) => {
      if (isSpace(room) && room.getMyMembership() !== Membership.Invite) {
        pendingPuts.push({ parent: room.roomId, children: getSpaceChildren(room) });
        scheduleFlush();
      }
    };

    const handleMembershipChange = (room: Room, membership: string) => {
      if (isSpace(room) && room.getMyMembership() === Membership.Leave) {
        pendingDeletes.add(room.roomId);
        scheduleFlush();
        return;
      }
      if (isSpace(room) && membership === Membership.Join) {
        pendingPuts.push({ parent: room.roomId, children: getSpaceChildren(room) });
        scheduleFlush();
      }
    };

    const handleStateChange = (mEvent: MatrixEvent) => {
      if (mEvent.getType() === StateEvent.SpaceChild) {
        const childId = mEvent.getStateKey();
        const roomId = mEvent.getRoomId();
        if (childId && roomId) {
          if (isValidChild(mEvent)) {
            pendingPuts.push({ parent: roomId, children: [childId] });
          } else {
            pendingDeletes.add(childId);
          }
          scheduleFlush();
        }
      }
    };

    const handleDeleteRoom = (roomId: string) => {
      pendingDeletes.add(roomId);
      scheduleFlush();
    };

    mx.on(ClientEvent.Room, handleAddRoom);
    mx.on(RoomEvent.MyMembership, handleMembershipChange);
    mx.on(RoomStateEvent.Events, handleStateChange);
    mx.on(ClientEvent.DeleteRoom, handleDeleteRoom);
    return () => {
      mx.removeListener(ClientEvent.Room, handleAddRoom);
      mx.removeListener(RoomEvent.MyMembership, handleMembershipChange);
      mx.removeListener(RoomStateEvent.Events, handleStateChange);
      mx.removeListener(ClientEvent.DeleteRoom, handleDeleteRoom);
      scheduler.dispose();
    };
  }, [mx, setRoomToParents]);
};
