import { MatrixClient, Room } from 'matrix-js-sdk';
import { getViaServers } from '../plugins/via-servers';
import { bumpSync, subscribeRoom } from '../../client/slidingSyncRooms';
import { isRoomId } from './matrix';

/**
 * Servers worth telling the homeserver about when joining.
 *
 * Joining by ROOM ID is not self-describing the way an alias is: the server has
 * to be told where the room lives. Synapse often resolves it from an invite it
 * already holds, so a bare join appears to work — other servers return
 * M_NOT_FOUND instead, which is most of why joins "work on one server and not
 * the other". So always send via.
 *
 * Sources, in order: whatever the permalink carried (the most authoritative —
 * it came from someone who was actually there), then the room's own state if we
 * know the room at all, then the room id's origin server as the floor.
 */
export const getJoinViaServers = (
  mx: MatrixClient,
  roomIdOrAlias: string,
  viaServers?: string[]
): string[] => {
  const via: string[] = [];
  const push = (server?: string) => {
    if (server && !via.includes(server)) via.push(server);
  };

  viaServers?.forEach(push);

  const room = mx.getRoom(roomIdOrAlias);
  if (room) {
    // getViaServers already falls back to the room id's origin server, so a
    // room we barely know (thin stripped invite state) still yields one via.
    getViaServers(room).forEach(push);
  } else if (isRoomId(roomIdOrAlias) && roomIdOrAlias.includes(':')) {
    push(roomIdOrAlias.split(':').slice(1).join(':'));
  }

  return via.slice(0, 4);
};

/**
 * Join a room and make it usable IMMEDIATELY.
 *
 * Beyond the bare `mx.joinRoom`, three things:
 *
 * 1. via servers (see above);
 * 2. one retry after a beat — a join issued the instant an invite lands can
 *    beat the inviting server's own membership settling, which comes back as
 *    "not invited". A second failure is real and propagates;
 * 3. subscribe + bump the sliding-sync connection, so the room is streamed to
 *    us on a request we just triggered rather than whenever the long poll
 *    happens to return. Without this the SDK's joinRoom leaves us holding a
 *    room with NO membership state (it is built by syncApi.createRoom), so the
 *    UI has nothing to show until the next poll lands.
 *
 * Callers that render from the room list should also record the join
 * optimistically — see useJoinRoom, which is what UI code wants.
 */
export const joinRoom = async (
  mx: MatrixClient,
  roomIdOrAlias: string,
  viaServers?: string[]
): Promise<Room> => {
  const via = getJoinViaServers(mx, roomIdOrAlias, viaServers);
  const attempt = (): Promise<Room> =>
    mx.joinRoom(roomIdOrAlias, via.length > 0 ? { viaServers: via } : undefined);

  let room: Room;
  try {
    room = await attempt();
  } catch {
    await new Promise((resolve) => {
      setTimeout(resolve, 1500);
    });
    room = await attempt();
  }

  // subscribeRoom resends the request itself when it changed the subscription
  // set; bump only when it didn't, so we don't abort the request we just caused.
  if (!subscribeRoom(mx, room.roomId)) bumpSync(mx);
  return room;
};
