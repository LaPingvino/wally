import { ReactElement, useDeferredValue } from 'react';
import { Unread } from '../../types/matrix/room';
import { useRoomUnread, useRoomsUnread } from '../state/hooks/unread';
import { roomToUnreadAtom } from '../state/room/roomToUnread';

type RoomUnreadProviderProps = {
  roomId: string;
  children: (unread?: Unread) => ReactElement;
};
export function RoomUnreadProvider({ roomId, children }: RoomUnreadProviderProps) {
  const raw = useRoomUnread(roomId, roomToUnreadAtom);
  const unread = useDeferredValue(raw);

  return children(unread);
}

type RoomsUnreadProviderProps = {
  rooms: string[];
  children: (unread?: Unread) => ReactElement;
};
export function RoomsUnreadProvider({ rooms, children }: RoomsUnreadProviderProps) {
  const raw = useRoomsUnread(rooms, roomToUnreadAtom);
  const unread = useDeferredValue(raw);

  return children(unread);
}
