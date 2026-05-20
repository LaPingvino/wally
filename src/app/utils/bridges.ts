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

// Finding the bridge **management** DM by membership shape alone is fragile:
// m.direct is set on portals too, and "the only other member is the bot" also
// matches abandoned portals where the ghost has left. The strongest signal is
// behavioural: in a management DM the user has *talked to the bot*, so the
// bot has authored many timeline messages. In portals the bot is silent
// except for error notices, so its message count there is ~0.
//
// We score every joined room that has the bot as a joined member by the
// number of bot-authored m.room.message events in its recent live timeline,
// and pick the highest. Ties / all-zero falls back to a strict me+bot shape
// check so a brand-new management DM (no messages yet) still resolves.

const BOT_MESSAGE_SCAN_LIMIT = 200;

const countBotMessages = (room: Room, botUserId: string): number => {
  const events = room.getLiveTimeline().getEvents();
  let count = 0;
  const start = Math.max(0, events.length - BOT_MESSAGE_SCAN_LIMIT);
  for (let i = events.length - 1; i >= start; i -= 1) {
    const ev = events[i];
    if (ev.getType() !== 'm.room.message') continue;
    if (ev.getSender() === botUserId) count += 1;
  }
  return count;
};

const isJustMeAndBot = (room: Room, myUserId: string | null, botUserId: string): boolean => {
  const others = room
    .getMembersWithMembership(Membership.Join)
    .filter((m) => m.userId !== myUserId);
  return others.length === 1 && others[0].userId === botUserId;
};

export const findBotDmRoom = (mx: MatrixClient, botUserId: string): Room | undefined => {
  const myUserId = mx.getUserId();
  const candidates = mx.getRooms().filter(
    (r) =>
      r.getMyMembership() === Membership.Join &&
      r.getMember(botUserId)?.membership === Membership.Join
  );

  let best: Room | undefined;
  let bestScore = 0;
  for (const r of candidates) {
    const score = countBotMessages(r, botUserId);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  if (best) return best;

  return candidates.find((r) => isJustMeAndBot(r, myUserId, botUserId));
};

export const ensureBotDmRoom = async (
  mx: MatrixClient,
  botUserId: string
): Promise<string> => {
  const existing = findBotDmRoom(mx, botUserId);
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
