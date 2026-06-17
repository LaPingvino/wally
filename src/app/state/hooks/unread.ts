import { useCallback } from 'react';
import { useAtomValue } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { RoomToUnread, Unread } from '../../../types/matrix/room';
import { roomToUnreadAtom, unreadEqual } from '../room/roomToUnread';
import { roomsLoadedAtom } from '../roomsLoaded';

const compareUnreadEqual = (u1?: Unread, u2?: Unread): boolean => {
  if (!u1 || !u2) return false;
  return unreadEqual(u1, u2);
};

const getRoomsUnread = (rooms: string[], roomToUnread: RoomToUnread): Unread | undefined => {
  const unread = rooms.reduce<Unread | undefined>((u, roomId) => {
    const roomUnread = roomToUnread.get(roomId);
    if (!roomUnread) return u;
    const newUnread: Unread = u ?? {
      total: 0,
      highlight: 0,
      from: new Set(),
    };
    newUnread.total += roomUnread.total;
    newUnread.highlight += roomUnread.highlight;
    // Aggregate stays pending (a dot, not a number) while ANY contributing room is still
    // unconfirmed — never show a precise sum that's really only partial.
    if (roomUnread.pending) newUnread.pending = true;
    newUnread.from?.add(roomId);
    return newUnread;
  }, undefined);
  return unread;
};

export const useRoomsUnread = (
  rooms: string[],
  roomToUnreadAtm: typeof roomToUnreadAtom
): Unread | undefined => {
  const selector = useCallback(
    (roomToUnread: RoomToUnread) => getRoomsUnread(rooms, roomToUnread),
    [rooms]
  );
  const unread = useAtomValue(selectAtom(roomToUnreadAtm, selector, compareUnreadEqual));
  // Aggregates are untrustworthy until the room load settles: mid-load we don't yet know about
  // every unread child, so any sum is premature. Show NOTHING until settled (and nothing while
  // any contributing child is still uncertain), then the real total — never a wrong intermediate.
  const loaded = useAtomValue(roomsLoadedAtom);
  if (!unread || !loaded || unread.pending) return undefined;
  return unread;
};

export const useRoomUnread = (
  roomId: string,
  roomToUnreadAtm: typeof roomToUnreadAtom
): Unread | undefined => {
  const selector = useCallback((roomToUnread: RoomToUnread) => roomToUnread.get(roomId), [roomId]);
  const unread = useAtomValue(selectAtom(roomToUnreadAtm, selector, compareUnreadEqual));
  // Uncertain (sliding-sync room not loaded this session) → show NOTHING, not a number or a dot.
  // Resolves to a real value once the room goes live. (Dots remain for the genuine count===0 case.)
  if (unread?.pending) return undefined;
  return unread;
};
