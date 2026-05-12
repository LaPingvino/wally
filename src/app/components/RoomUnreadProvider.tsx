import { ReactElement } from 'react';
import { Unread } from '../../types/matrix/room';
import { useRoomUnread, useRoomsUnread } from '../state/hooks/unread';
import { roomToUnreadThrottled } from '../state/room/roomToUnread';

type RoomUnreadProviderProps = {
  roomId: string;
  children: (unread?: Unread) => ReactElement;
};
export function RoomUnreadProvider({ roomId, children }: RoomUnreadProviderProps) {
  const unread = useRoomUnread(roomId, roomToUnreadThrottled.out);
  return children(unread);
}

type RoomsUnreadProviderProps = {
  rooms: string[];
  children: (unread?: Unread) => ReactElement;
};
export function RoomsUnreadProvider({ rooms, children }: RoomsUnreadProviderProps) {
  const unread = useRoomsUnread(rooms, roomToUnreadThrottled.out);
  return children(unread);
}
