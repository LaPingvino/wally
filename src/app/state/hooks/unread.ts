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
  // every unread child, so a precise sum would be premature and flip back to a dot when a late
  // unread room appears. Force `pending` (a dot) until settled, then reveal the real total — one
  // clean dot→number transition instead of dot↔number churn.
  const loaded = useAtomValue(roomsLoadedAtom);
  if (!unread) return undefined;
  if (loaded || unread.pending) return unread;
  return { ...unread, pending: true };
};

export const useRoomUnread = (
  roomId: string,
  roomToUnreadAtm: typeof roomToUnreadAtom
): Unread | undefined => {
  const selector = useCallback((roomToUnread: RoomToUnread) => roomToUnread.get(roomId), [roomId]);
  return useAtomValue(selectAtom(roomToUnreadAtm, selector, compareUnreadEqual));
};
