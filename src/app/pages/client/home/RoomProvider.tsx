import React, { ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { useSelectedRoom } from '../../../hooks/router/useSelectedRoom';
import { IsDirectRoomProvider, RoomProvider } from '../../../hooks/useRoom';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { JoinBeforeNavigate } from '../../../features/join-before-navigate';
import { useHomeRooms } from './useHomeRooms';
import { useSearchParamsViaServers } from '../../../hooks/router/useSearchParamsViaServers';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { getHomePath } from '../../pathUtils';

export function HomeRouteRoomProvider({ children }: { children: ReactNode }) {
  const mx = useMatrixClient();
  const rooms = useHomeRooms();
  const allRooms = useAtomValue(allRoomsAtom);

  const { roomIdOrAlias, eventId } = useParams();
  const viaServers = useSearchParamsViaServers();
  const roomId = useSelectedRoom();
  const room = mx.getRoom(roomId);

  if (!room || !rooms.includes(room.roomId)) {
    // Room exists but moved to another section (DM, space, etc.) — avoid
    // JoinBeforeNavigate's auto-redirect away from home; go to home index instead.
    // This prevents the stale navToActivePath from bouncing the user out of home.
    if (room && allRooms.includes(room.roomId)) {
      return <Navigate to={getHomePath()} replace />;
    }
    return (
      <JoinBeforeNavigate
        roomIdOrAlias={roomIdOrAlias!}
        eventId={eventId}
        viaServers={viaServers}
      />
    );
  }

  return (
    <RoomProvider key={room.roomId} value={room}>
      <IsDirectRoomProvider value={false}>{children}</IsDirectRoomProvider>
    </RoomProvider>
  );
}
