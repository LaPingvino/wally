import { IconName, IconSrc } from 'folds';

import {
  AccountDataEvents,
  EventTimeline,
  EventTimelineSet,
  EventType,
  IMentions,
  IPowerLevelsContent,
  IPushRule,
  IPushRules,
  JoinRule,
  MatrixClient,
  MatrixEvent,
  MsgType,
  ReceiptType,
  RelationType,
  Room,
  RoomMember,
} from 'matrix-js-sdk';
import { CryptoBackend } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { AccountDataEvent } from '../../types/matrix/accountData';
import { readSettingsSync } from '../state/settings';
import {
  IRoomCreateContent,
  Membership,
  MessageEvent,
  NotificationType,
  RoomToParents,
  RoomType,
  StateEvent,
  UnreadInfo,
} from '../../types/matrix/room';

export const getStateEvent = (
  room: Room,
  eventType: StateEvent,
  stateKey = ''
): MatrixEvent | undefined =>
  room.getLiveTimeline().getState(EventTimeline.FORWARDS)?.getStateEvents(eventType, stateKey) ??
  undefined;

export const getStateEvents = (room: Room, eventType: StateEvent): MatrixEvent[] =>
  room.getLiveTimeline().getState(EventTimeline.FORWARDS)?.getStateEvents(eventType) ?? [];

export const getAccountData = (
  mx: MatrixClient,
  eventType: AccountDataEvent
): MatrixEvent | undefined => mx.getAccountData(eventType as keyof AccountDataEvents);

export const getMDirects = (mDirectEvent: MatrixEvent): Set<string> => {
  const roomIds = new Set<string>();
  const userIdToDirects = mDirectEvent?.getContent();

  if (userIdToDirects === undefined) return roomIds;

  Object.keys(userIdToDirects).forEach((userId) => {
    const directs = userIdToDirects[userId];
    if (Array.isArray(directs)) {
      directs.forEach((id) => {
        if (typeof id === 'string') roomIds.add(id);
      });
    }
  });

  return roomIds;
};

export const isDirectInvite = (room: Room | null, myUserId: string | null): boolean => {
  if (!room || !myUserId) return false;
  const me = room.getMember(myUserId);
  const memberEvent = me?.events?.member;
  const content = memberEvent?.getContent();
  return content?.is_direct === true;
};

export const isSpace = (room: Room | null): boolean => {
  if (!room) return false;
  const event = getStateEvent(room, StateEvent.RoomCreate);
  if (!event) return false;
  return event.getContent().type === RoomType.Space;
};

export const isRoom = (room: Room | null): boolean => {
  if (!room) return false;
  const event = getStateEvent(room, StateEvent.RoomCreate);
  if (!event) return true;
  return event.getContent().type !== RoomType.Space;
};

export const isUnsupportedRoom = (room: Room | null): boolean => {
  if (!room) return false;
  const event = getStateEvent(room, StateEvent.RoomCreate);
  if (!event) return true; // Consider room unsupported if m.room.create event doesn't exist
  return event.getContent().type !== undefined && event.getContent().type !== RoomType.Space;
};

export function isValidChild(mEvent: MatrixEvent): boolean {
  return (
    mEvent.getType() === StateEvent.SpaceChild &&
    Array.isArray(mEvent.getContent<{ via: string[] }>().via)
  );
}

export const getAllParents = (roomToParents: RoomToParents, roomId: string): Set<string> => {
  const allParents = new Set<string>();

  const addAllParentIds = (rId: string) => {
    if (allParents.has(rId)) return;
    allParents.add(rId);

    const parents = roomToParents.get(rId);
    parents?.forEach((id) => addAllParentIds(id));
  };
  addAllParentIds(roomId);
  allParents.delete(roomId);
  return allParents;
};

export const getSpaceChildren = (room: Room) =>
  getStateEvents(room, StateEvent.SpaceChild).reduce<string[]>((filtered, mEvent) => {
    const stateKey = mEvent.getStateKey();
    if (isValidChild(mEvent) && stateKey) {
      filtered.push(stateKey);
    }
    return filtered;
  }, []);

export const mapParentWithChildren = (
  roomToParents: RoomToParents,
  roomId: string,
  children: string[]
) => {
  const allParents = getAllParents(roomToParents, roomId);
  children.forEach((childId) => {
    if (allParents.has(childId)) {
      // Space cycle detected.
      return;
    }
    const parents = roomToParents.get(childId) ?? new Set<string>();
    parents.add(roomId);
    roomToParents.set(childId, parents);
  });
};

export const getRoomToParents = (mx: MatrixClient): RoomToParents => {
  const map: RoomToParents = new Map();
  mx.getRooms()
    .filter((room) => isSpace(room))
    .forEach((room) => mapParentWithChildren(map, room.roomId, getSpaceChildren(room)));

  return map;
};

export const getOrphanParents = (roomToParents: RoomToParents, roomId: string): string[] => {
  const parents = getAllParents(roomToParents, roomId);
  const orphanParents = Array.from(parents).filter(
    (parentRoomId) => !roomToParents.has(parentRoomId)
  );

  return orphanParents;
};

export const isMutedRule = (rule: IPushRule) =>
  // Check for empty actions (new spec) or dont_notify (deprecated)
  (rule.actions.length === 0 || rule.actions[0] === 'dont_notify') &&
  rule.conditions?.[0]?.kind === 'event_match';

export const findMutedRule = (overrideRules: IPushRule[], roomId: string) =>
  overrideRules.find((rule) => rule.rule_id === roomId && isMutedRule(rule));

export const getNotificationType = (mx: MatrixClient, roomId: string): NotificationType => {
  let roomPushRule: IPushRule | undefined;
  try {
    roomPushRule = mx.getRoomPushRule('global', roomId);
  } catch {
    roomPushRule = undefined;
  }

  if (!roomPushRule) {
    const overrideRules = mx.getAccountData(EventType.PushRules)?.getContent<IPushRules>()
      ?.global?.override;
    if (!overrideRules) return NotificationType.Default;

    return findMutedRule(overrideRules, roomId) ? NotificationType.Mute : NotificationType.Default;
  }

  if (roomPushRule.actions[0] === 'notify') return NotificationType.AllMessages;
  return NotificationType.MentionsAndKeywords;
};

const NOTIFICATION_EVENT_TYPES = [
  'm.room.create',
  'm.room.message',
  'm.room.encrypted',
  'm.room.member',
  'm.sticker',
];
export const isNotificationEvent = (mEvent: MatrixEvent) => {
  const eType = mEvent.getType();
  if (!NOTIFICATION_EVENT_TYPES.includes(eType)) {
    return false;
  }
  if (eType === 'm.room.member') return false;

  if (mEvent.isRedacted()) return false;
  if (mEvent.getRelation()?.rel_type === 'm.replace') return false;

  // m.notice is for automated/bot output (heisenbridge IRC logs, wallops,
  // issue-tracker status events). The spec says clients should not notify
  // on them. By default we also keep them out of unread counts so chatty
  // bots don't light up the room list — flip `noticesMarkUnread` in
  // Notifications settings to opt back into the spec-default behavior.
  if (
    eType === 'm.room.message' &&
    mEvent.getContent().msgtype === MsgType.Notice &&
    !readSettingsSync().noticesMarkUnread
  ) {
    return false;
  }

  return true;
};

/**
 * Timestamp of the last CONVERSATIONAL event in a room — the newest event that
 * passes isNotificationEvent (real message / encrypted / sticker / create),
 * ignoring state events like member changes and eu.kiefte.issue edits. This is
 * what activity sorting should use: getLastActiveTimestamp() returns the ts of
 * the last timeline event of ANY type, so a room floats to the top just because
 * an issue was edited or an avatar changed (e.g. ganza, whose last real message
 * was months before its latest issue-state edit). Falls back to
 * getLastActiveTimestamp() when no conversational event is loaded (e.g. sliding
 * sync only loaded a tiny timeline) so ordering still has something to go on.
 */
export const getLastMeaningfulTimestamp = (room: Room): number => {
  const events = room.getLiveTimeline().getEvents();
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (isNotificationEvent(events[i])) return events[i].getTs();
  }
  return room.getLastActiveTimestamp();
};

/**
 * Compute a room's unread count — FULLY client-side.
 *
 * We compute it client-side by walking the loaded timeline back to the read marker, counting real
 * notifying messages from others (member/notice/state noise and our own messages are skipped — those
 * belong to the Activities inbox). We NEVER use the server's `getUnreadNotificationCount`: it counts
 * member/state/bridge noise the walk skips and doesn't clear reliably under sliding sync, so feeding it
 * into the count inflated the space/folder aggregates with phantom unreads that crept up over time.
 *
 * Read state is placed by RECEIPT POSITION, never by timestamp — timestamps are unreliable across
 * federated servers, and a ts heuristic produced STUCK phantom unreads (read events that looked "newer
 * than the marker" by clock skew got counted, and no future receipt would clear them — "old unreads
 * coming back").
 *
 *  - Marker event is in the loaded timeline → count notifying events after its position. EXACT.
 *  - Marker not loaded → ask the SDK by POSITION whether we've read the room's HEAD event
 *    (hasUserReadEvent). Read → 0 (reliable: receipt-at-or-after head, no ts, no server count).
 *    Not read → the head (and maybe more) are unread → count the loaded window's real notifications as
 *    a noise-filtered LOWER BOUND that resolves to the exact number once the marker/timeline loads.
 *
 * Plus one more "uncertain → pending" guard: under sliding sync, until a room is live-synced this
 * session (a rehydrated cache marker / timeline may be stale).
 */
export const getUnreadInfo = (room: Room, mx: MatrixClient): UnreadInfo => {
  const userId = mx.getUserId();
  if (!userId) return { roomId: room.roomId, total: 0, highlight: 0 };

  // Under sliding sync only trust a room once it's live-synced this session — until then its read
  // marker / timeline may be a stale cache paint, which would show a count that then corrects.
  const slidingSync = !!(mx as unknown as { getSlidingSync?: () => unknown }).getSlidingSync?.();
  if (slidingSync) {
    const liveSynced =
      (mx as unknown as { isRoomLiveSynced?: (roomId: string) => boolean }).isRoomLiveSynced?.(
        room.roomId
      ) ?? true;
    if (!liveSynced) {
      return { roomId: room.roomId, total: 0, highlight: 0, pending: true };
    }
  }

  const events = room.getLiveTimeline().getEvents();
  if (events.length === 0) {
    return { roomId: room.roomId, total: 0, highlight: 0, pending: true };
  }

  const countAfter = (startExclusive: number): UnreadInfo => {
    let total = 0;
    let highlight = 0;
    for (let i = events.length - 1; i > startExclusive; i -= 1) {
      const e = events[i];
      if (isNotificationEvent(e) && e.getSender() !== userId) {
        total += 1;
        const actions = mx.getPushActionsForEvent(e);
        if (actions?.tweaks?.highlight === true) highlight += 1;
      }
    }
    return { roomId: room.roomId, total, highlight };
  };

  // Count notifying events strictly NEWER than the read-receipt timestamp. Used only when the
  // marker event itself isn't loaded so we can't count by position. Unlike countAfter(-1) it
  // does NOT assume the loaded window is entirely after the marker — that assumption is false
  // for broadcast channels (mautrix newsletters / WhatsApp channels, whose posts ARE notifying
  // events) and for the fat non-head-anchored timeline a cache rehydrate paints: in both, posts
  // you already READ stay loaded, and an unbounded count recounts them → inflated room-list and
  // space/folder aggregates (the "counts merged/wrong" regression). Bounding by ts skips the
  // already-read tail. This is a count bound ONLY — the read/unread DECISION above stays id-based
  // (head match → 0), so a fully-read room is never resurrected by clock skew.
  const countAfterTs = (afterTs: number): UnreadInfo => {
    let total = 0;
    let highlight = 0;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const e = events[i];
      if (e.getTs() <= afterTs) continue; // at/older than the marker → already read
      if (isNotificationEvent(e) && e.getSender() !== userId) {
        total += 1;
        const actions = mx.getPushActionsForEvent(e);
        if (actions?.tweaks?.highlight === true) highlight += 1;
      }
    }
    return { roomId: room.roomId, total, highlight };
  };

  // Reliable path: the SDK resolves the latest receipt across public/private/synthetic AND only
  // returns it if the event is loaded (null otherwise). When we have it, count exactly by position.
  const loadedMarkerId = room.getEventReadUpTo(userId, false);
  if (loadedMarkerId) {
    const idx = events.findIndex((e) => e.getId() === loadedMarkerId);
    if (idx >= 0) return countAfter(idx);
  }

  // Marker not in the loaded timeline. Decide read-state by comparing our REAL read-receipt event-id
  // to the head event-id DIRECTLY — never a timestamp (skew resurrected read rooms), never the server
  // count (noise), and NOT hasUserReadEvent/position lookup: once a room is read its receipt event
  // usually scrolls out of the lean window, so the position lookup can't resolve it and would wrongly
  // report the room unread again on the next recompute (the "unread counters revert" bug). The raw
  // receipt always carries its event-id, so an id match is reliable regardless of what's loaded.
  //   receipt at head → read (0);
  //   else → the head (and maybe more) are unread → count notifications NEWER than the receipt ts
  //   (a noise-filtered lower bound). We do NOT assume "everything loaded is after the marker": that
  //   over-counts read posts in broadcast channels and rehydrated timelines (see countAfterTs).
  const readReceiptRead = room.getReadReceiptForUserId(userId, true, ReceiptType.Read);
  const readReceiptPriv = room.getReadReceiptForUserId(userId, true, ReceiptType.ReadPrivate);
  const headId = events[events.length - 1].getId();
  if (readReceiptRead?.eventId === headId || readReceiptPriv?.eventId === headId) {
    return { roomId: room.roomId, total: 0, highlight: 0 };
  }
  // Bound the count by the receipt timestamp when we have one; without a ts (e.g. no receipt at
  // all) fall back to counting the whole loaded window as the lower bound.
  const receiptTs = Math.max(readReceiptRead?.data?.ts ?? 0, readReceiptPriv?.data?.ts ?? 0);
  return receiptTs > 0 ? countAfterTs(receiptTs) : countAfter(-1);
};

export const getUnreadInfos = (mx: MatrixClient): UnreadInfo[] => {
  const unreadInfos = mx.getRooms().reduce<UnreadInfo[]>((unread, room) => {
    if (room.isSpaceRoom()) return unread;
    if (room.getMyMembership() !== 'join') return unread;
    if (getNotificationType(mx, room.roomId) === NotificationType.Mute) return unread;

    const info = getUnreadInfo(room, mx);
    if (info.total > 0 || info.highlight > 0) {
      unread.push(info);
    }

    return unread;
  }, []);
  return unreadInfos;
};

export const getRoomIconSrc = (
  icons: Record<IconName, IconSrc>,
  roomType?: string,
  joinRule?: JoinRule,
  locked?: boolean
): IconSrc => {
  type RoomIcons = {
    base: IconSrc;
    locked: IconSrc;
    public: IconSrc;
  };

  const roomTypeIcons: Record<string, RoomIcons> = {
    [RoomType.Call]: {
      base: icons.VolumeHigh,
      locked: icons.Lock,
      public: icons.VolumeHigh,
    },
    [RoomType.Space]: {
      base: icons.Space,
      locked: icons.SpaceLock,
      public: icons.SpaceGlobe,
    },
    default: {
      base: icons.Hash,
      locked: icons.HashLock,
      public: icons.HashGlobe,
    },
  };

  const roomIcons = roomTypeIcons[roomType ?? 'default'] ?? roomTypeIcons.default;

  let roomIcon = roomIcons.base;

  if (locked) {
    roomIcon = roomIcons.locked;
  } else {
    switch (joinRule) {
      case JoinRule.Invite:
      case JoinRule.Knock:
        roomIcon = roomIcons.locked;
        break;
      case JoinRule.Restricted:
        roomIcon = roomIcons.base;
        break;
      case JoinRule.Public:
        roomIcon = roomIcons.public;
        break;
      default:
        break;
    }
  }

  return roomIcon;
};

export const getRoomAvatarUrl = (
  mx: MatrixClient,
  room: Room,
  size: 32 | 96 = 32,
  useAuthentication = false
): string | undefined => {
  const mxcUrl = room.getMxcAvatarUrl();
  return mxcUrl
    ? mx.mxcUrlToHttp(mxcUrl, size, size, 'crop', undefined, false, useAuthentication) ?? undefined
    : undefined;
};

export const getDirectRoomAvatarUrl = (
  mx: MatrixClient,
  room: Room,
  size: 32 | 96 = 32,
  useAuthentication = false
): string | undefined => {
  const mxcUrl = room.getAvatarFallbackMember()?.getMxcAvatarUrl();

  if (!mxcUrl) {
    return getRoomAvatarUrl(mx, room, size, useAuthentication);
  }

  return (
    mx.mxcUrlToHttp(mxcUrl, size, size, 'crop', undefined, false, useAuthentication) ?? undefined
  );
};

export const trimReplyFromBody = (body: string): string => {
  const match = body.match(/^> <.+?> .+\n(>.*\n)*?\n/m);
  if (!match) return body;
  return body.slice(match[0].length);
};

export const trimReplyFromFormattedBody = (formattedBody: string): string => {
  const suffix = '</mx-reply>';
  const i = formattedBody.lastIndexOf(suffix);
  if (i < 0) {
    return formattedBody;
  }
  return formattedBody.slice(i + suffix.length);
};

export const parseReplyBody = (userId: string, body: string) =>
  `> <${userId}> ${body.replace(/\n/g, '\n> ')}\n\n`;

export const parseReplyFormattedBody = (
  roomId: string,
  userId: string,
  eventId: string,
  formattedBody: string
): string => {
  const replyToLink = `<a href="https://matrix.to/#/${encodeURIComponent(
    roomId
  )}/${encodeURIComponent(eventId)}">In reply to</a>`;
  const userLink = `<a href="https://matrix.to/#/${encodeURIComponent(userId)}">${userId}</a>`;

  return `<mx-reply><blockquote>${replyToLink}${userLink}<br />${formattedBody}</blockquote></mx-reply>`;
};

export const getMemberDisplayName = (room: Room, userId: string): string | undefined => {
  const member = room.getMember(userId);
  const name = member?.rawDisplayName;
  if (name === userId) return undefined;
  return name;
};

export const getMemberSearchStr = (
  member: RoomMember,
  query: string,
  mxIdToName: (mxId: string) => string
): string[] => [
  member.rawDisplayName === member.userId ? mxIdToName(member.userId) : member.rawDisplayName,
  query.startsWith('@') || query.indexOf(':') > -1 ? member.userId : mxIdToName(member.userId),
];

export const getMemberAvatarMxc = (room: Room, userId: string): string | undefined => {
  const member = room.getMember(userId);
  return member?.getMxcAvatarUrl();
};

export const isMembershipChanged = (mEvent: MatrixEvent): boolean =>
  mEvent.getContent().membership !== mEvent.getPrevContent().membership ||
  mEvent.getContent().reason !== mEvent.getPrevContent().reason;

export const decryptAllTimelineEvent = async (mx: MatrixClient, timeline: EventTimeline) => {
  const crypto = mx.getCrypto();
  if (!crypto) return;
  const decryptionPromises = timeline
    .getEvents()
    .filter((event) => event.isEncrypted())
    .reverse()
    .map((event) => event.attemptDecryption(crypto as CryptoBackend, { isRetry: true }));
  await Promise.allSettled(decryptionPromises);
};

export const getReactionContent = (eventId: string, key: string, shortcode?: string) => ({
  'm.relates_to': {
    event_id: eventId,
    key,
    rel_type: 'm.annotation',
  },
  shortcode,
});

export const getEventReactions = (timelineSet: EventTimelineSet, eventId: string) =>
  timelineSet.relations.getChildEventsForEvent(
    eventId,
    RelationType.Annotation,
    EventType.Reaction
  );

export const getEventEdits = (timelineSet: EventTimelineSet, eventId: string, eventType: string) =>
  timelineSet.relations.getChildEventsForEvent(eventId, RelationType.Replace, eventType);

export const getLatestEdit = (
  targetEvent: MatrixEvent,
  editEvents: MatrixEvent[]
): MatrixEvent | undefined => {
  const eventByTargetSender = (rEvent: MatrixEvent) =>
    rEvent.getSender() === targetEvent.getSender();
  return editEvents.sort((m1, m2) => m2.getTs() - m1.getTs()).find(eventByTargetSender);
};

export const getEditedEvent = (
  mEventId: string,
  mEvent: MatrixEvent,
  timelineSet: EventTimelineSet
): MatrixEvent | undefined => {
  const edits = getEventEdits(timelineSet, mEventId, mEvent.getType());
  return edits && getLatestEdit(mEvent, edits.getRelations());
};

export const canEditEvent = (mx: MatrixClient, mEvent: MatrixEvent) => {
  const content = mEvent.getContent();
  const relationType = content['m.relates_to']?.rel_type;
  return (
    mEvent.getSender() === mx.getUserId() &&
    (!relationType || relationType === RelationType.Thread) &&
    mEvent.getType() === MessageEvent.RoomMessage &&
    (content.msgtype === MsgType.Text ||
      content.msgtype === MsgType.Emote ||
      content.msgtype === MsgType.Notice)
  );
};

export const getLatestEditableEvt = (
  timeline: EventTimeline,
  canEdit: (mEvent: MatrixEvent) => boolean
): MatrixEvent | undefined => {
  const events = timeline.getEvents();

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const evt = events[i];
    if (canEdit(evt)) return evt;
  }
  return undefined;
};

export const reactionOrEditEvent = (mEvent: MatrixEvent) =>
  mEvent.getRelation()?.rel_type === RelationType.Annotation ||
  mEvent.getRelation()?.rel_type === RelationType.Replace;

export const getMentionContent = (userIds: string[], room: boolean): IMentions => {
  const mMentions: IMentions = {};
  if (userIds.length > 0) {
    mMentions.user_ids = userIds;
  }
  if (room) {
    mMentions.room = true;
  }

  return mMentions;
};

export const getCommonRooms = (
  mx: MatrixClient,
  rooms: string[],
  otherUserId: string
): string[] => {
  const commonRooms: string[] = [];

  rooms.forEach((roomId) => {
    const room = mx.getRoom(roomId);
    if (!room || room.getMyMembership() !== Membership.Join) return;

    const common = room.hasMembershipState(otherUserId, Membership.Join);
    if (common) {
      commonRooms.push(roomId);
    }
  });

  return commonRooms;
};

export const bannedInRooms = (mx: MatrixClient, rooms: string[], otherUserId: string): boolean =>
  rooms.some((roomId) => {
    const room = mx.getRoom(roomId);
    if (!room || room.getMyMembership() !== Membership.Join) return false;

    const banned = room.hasMembershipState(otherUserId, Membership.Ban);
    return banned;
  });

export const getAllVersionsRoomCreator = (room: Room): Set<string> => {
  const creators = new Set<string>();

  const createEvent = getStateEvent(room, StateEvent.RoomCreate);
  const createContent = createEvent?.getContent<IRoomCreateContent>();
  const creator = createEvent?.getSender();
  if (typeof creator === 'string') creators.add(creator);

  if (createContent && Array.isArray(createContent.additional_creators)) {
    createContent.additional_creators.forEach((c) => {
      if (typeof c === 'string') creators.add(c);
    });
  }

  return creators;
};

export const guessPerfectParent = (
  mx: MatrixClient,
  roomId: string,
  parents: string[]
): string | undefined => {
  if (parents.length === 1) {
    return parents[0];
  }

  const getSpecialUsers = (rId: string): string[] => {
    const specialUsers: Set<string> = new Set();

    const r = mx.getRoom(rId);
    if (!r) return [];

    getAllVersionsRoomCreator(r).forEach((c) => specialUsers.add(c));

    const powerLevels = getStateEvent(
      r,
      StateEvent.RoomPowerLevels
    )?.getContent<IPowerLevelsContent>();

    const { users_default: usersDefault, users } = powerLevels ?? {};
    const defaultPower = typeof usersDefault === 'number' ? usersDefault : 0;

    if (typeof users === 'object')
      Object.keys(users).forEach((userId) => {
        if (users[userId] > defaultPower) {
          specialUsers.add(userId);
        }
      });

    return Array.from(specialUsers);
  };

  let perfectParent: string | undefined;
  let score = 0;

  const roomSpecialUsers = getSpecialUsers(roomId);
  parents.forEach((parentId) => {
    const parentSpecialUsers = getSpecialUsers(parentId);
    const matchedUsersCount = parentSpecialUsers.filter((userId) =>
      roomSpecialUsers.includes(userId)
    ).length;

    if (matchedUsersCount > score) {
      score = matchedUsersCount;
      perfectParent = parentId;
    }
  });

  return perfectParent;
};
