import { useCallback } from 'react';
import { useAtomValue } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { RoomToUnread, Unread } from '../../../types/matrix/room';
import { roomToUnreadAtom, unreadEqual } from '../room/roomToUnread';

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
  // Sum of the KNOWN per-room unreads. Each per-room count is itself a lower bound that only grows
  // as the room's timeline streams in (no overcount that corrects downward), so the aggregate is a
  // monotonically-growing lower bound too. We therefore show it as soon as any unread child is
  // known, rather than waiting for the whole room list to finish loading — that wait fully hid
  // space / folder / Home / Direct badges for a long time on large accounts (the over-hiding bug).
  if (!unread || unread.pending) return undefined;
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
