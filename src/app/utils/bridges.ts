// Generic bridge-bot discovery for mautrix-style bridges.
// We don't keep a per-bridge registry: most mautrix bridges (bridgev2) ship
// ghosts with mxids like @<protocol>_<id>:<server> and a bridgebot whose
// localpart is <protocol>bot (or whose displayname mentions the protocol).
// All bridgev2 bots accept `start-chat <ghost-mxid>` in their management DM.

import { MatrixClient, Preset, Room, Visibility } from 'matrix-js-sdk';
import { Membership } from '../../types/matrix/room';
import { addRoomIdToMDirect, getMxIdLocalPart, getMxIdServer } from './matrix';

const GHOST_LOCALPART_RE = /^([a-z][a-z0-9]+)_/;
const BRIDGE_KEYWORDS = ['bridge', 'bot', 'relay'];

const PROTOCOL_DISPLAY_NAMES: Record<string, string> = {
  wa: 'WhatsApp',
  whatsapp: 'WhatsApp',
  signal: 'Signal',
  telegram: 'Telegram',
  tg: 'Telegram',
  irc: 'IRC',
  meta: 'Meta',
  messenger: 'Messenger',
  discord: 'Discord',
  slack: 'Slack',
  gmessages: 'Google Messages',
  twitter: 'Twitter',
  bluesky: 'Bluesky',
  gvoice: 'Google Voice',
  linkedin: 'LinkedIn',
};

const titleCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const protocolDisplay = (id: string): string =>
  PROTOCOL_DISPLAY_NAMES[id.toLowerCase()] ?? titleCase(id);

export type BridgeMatch = {
  botUserId: string;
  protocolName: string;
  ghostUserId: string;
};

export const findBridgeBotInRoom = (
  room: Room,
  ghostUserId: string
): BridgeMatch | null => {
  const ghostLocal = getMxIdLocalPart(ghostUserId);
  const ghostServer = getMxIdServer(ghostUserId);
  if (!ghostLocal || !ghostServer) return null;

  const prefixMatch = ghostLocal.match(GHOST_LOCALPART_RE);
  if (!prefixMatch) return null;
  const prefix = prefixMatch[1].toLowerCase();

  const candidates = room
    .getMembersWithMembership(Membership.Join)
    .filter((m) => m.userId !== ghostUserId && getMxIdServer(m.userId) === ghostServer);

  const localpartHits = new Set([
    `${prefix}bot`,
    prefix,
    `${prefix}bridge`,
    `${prefix}bridgebot`,
    `${prefix}-bot`,
    `${prefix}-bridge`,
  ]);

  for (const m of candidates) {
    const local = getMxIdLocalPart(m.userId)?.toLowerCase();
    if (local && localpartHits.has(local)) {
      return { botUserId: m.userId, protocolName: protocolDisplay(prefix), ghostUserId };
    }
  }

  for (const m of candidates) {
    const name = (m.rawDisplayName ?? m.name ?? '').toLowerCase();
    if (!name) continue;
    if (name.includes(prefix) && BRIDGE_KEYWORDS.some((k) => name.includes(k))) {
      return { botUserId: m.userId, protocolName: protocolDisplay(prefix), ghostUserId };
    }
  }

  return null;
};

export const findBotDmRoom = (
  mx: MatrixClient,
  mDirects: Set<string>,
  botUserId: string
): Room | undefined => {
  for (const roomId of mDirects) {
    const room = mx.getRoom(roomId);
    if (!room) continue;
    if (room.getMyMembership() !== Membership.Join) continue;
    if (room.getMember(botUserId)) return room;
  }
  return mx
    .getRooms()
    .find(
      (r) =>
        r.getMyMembership() === Membership.Join &&
        r.getMembers().length <= 2 &&
        r.getMember(botUserId)
    );
};

export const ensureBotDmRoom = async (
  mx: MatrixClient,
  mDirects: Set<string>,
  botUserId: string
): Promise<string> => {
  const existing = findBotDmRoom(mx, mDirects, botUserId);
  if (existing) return existing.roomId;

  const result = await mx.createRoom({
    is_direct: true,
    invite: [botUserId],
    visibility: Visibility.Private,
    preset: Preset.TrustedPrivateChat,
  });
  await addRoomIdToMDirect(mx, result.room_id, botUserId);
  return result.room_id;
};

export const sendStartChatCommand = async (
  mx: MatrixClient,
  botRoomId: string,
  ghostUserId: string
): Promise<void> => {
  const body = `start-chat ${ghostUserId}`;
  await mx.sendMessage(botRoomId, { msgtype: 'm.text', body } as never);
};
