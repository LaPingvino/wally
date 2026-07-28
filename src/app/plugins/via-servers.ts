import { Room } from 'matrix-js-sdk';
import { IPowerLevels } from '../hooks/usePowerLevels';
import { creatorsSupported, getMxIdServer } from '../utils/matrix';
import { IRoomCreateContent, StateEvent } from '../../types/matrix/room';
import { getStateEvent } from '../utils/room';

export const getViaServers = (room: Room): string[] => {
  const getHighestPowerUserId = (): string | undefined => {
    const creatorEvent = getStateEvent(room, StateEvent.RoomCreate);
    if (
      creatorEvent &&
      creatorsSupported(creatorEvent.getContent<IRoomCreateContent>().room_version)
    ) {
      return creatorEvent.getSender();
    }

    const powerLevels = getStateEvent(room, StateEvent.RoomPowerLevels)?.getContent<IPowerLevels>();

    if (!powerLevels) return undefined;
    const userIdToPower = powerLevels.users;
    if (!userIdToPower) return undefined;
    let powerUserId: string | undefined;

    Object.keys(userIdToPower).forEach((userId) => {
      if (userIdToPower[userId] <= (powerLevels.users_default ?? 0)) return;

      if (!powerUserId) {
        powerUserId = userId;
        return;
      }
      if (userIdToPower[userId] > userIdToPower[powerUserId]) {
        powerUserId = userId;
      }
    });
    return powerUserId;
  };

  const getServerToPopulation = (): Record<string, number> => {
    const members = room.getMembers();
    const serverToPop: Record<string, number> = {};

    members?.forEach((member) => {
      const { userId } = member;
      const server = getMxIdServer(userId);
      if (!server) return;
      const serverPop = serverToPop[server];
      if (serverPop === undefined) {
        serverToPop[server] = 1;
        return;
      }
      serverToPop[server] = serverPop + 1;
    });

    return serverToPop;
  };

  // The room id's own domain: the room's origin server. Every other signal here
  // comes from room STATE, so on a room we barely know — an invite whose stripped
  // state carries no power_levels, no create event and almost no members — they
  // all come back empty and we'd return NO via at all. Joining a room by id with
  // no via is a coin flip: the server has to already know where the room lives.
  // This is the one via we can always derive, so it's the floor.
  const originServer = room.roomId.includes(':') ? room.roomId.split(':').slice(1).join(':') : undefined;

  const via: string[] = [];
  const userId = getHighestPowerUserId();
  if (userId) {
    const server = getMxIdServer(userId);
    if (server) via.push(server);
  }
  const serverToPop = getServerToPopulation();
  const sortedServers = Object.keys(serverToPop).sort(
    (svrA, svrB) => serverToPop[svrB] - serverToPop[svrA]
  );
  const mostPop3 = sortedServers.slice(0, 3);
  const withOrigin = (servers: string[]): string[] =>
    originServer && !servers.includes(originServer) ? servers.concat(originServer) : servers;

  if (via.length === 0) return withOrigin(mostPop3);
  if (mostPop3.includes(via[0])) {
    mostPop3.splice(mostPop3.indexOf(via[0]), 1);
  }
  return withOrigin(via.concat(mostPop3.slice(0, 2)));
};
