import {
  EncryptedAttachmentInfo,
  decryptAttachment,
  encryptAttachment,
} from 'browser-encrypt-attachment';
import {
  ClientEvent,
  EventTimeline,
  MatrixClient,
  MatrixError,
  MatrixEvent,
  Room,
  RoomMember,
  UploadProgress,
  UploadResponse,
} from 'matrix-js-sdk';
import to from 'await-to-js';
import { IImageInfo, IThumbnailContent, IVideoInfo } from '../../types/matrix/common';
import { AccountDataEvent } from '../../types/matrix/accountData';
import { getStateEvent } from './room';
import { Membership, StateEvent } from '../../types/matrix/room';

const DOMAIN_REGEX = /\b(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b/;

export const isServerName = (serverName: string): boolean => DOMAIN_REGEX.test(serverName);

const matchMxId = (id: string): RegExpMatchArray | null => id.match(/^([@$+#])([^\s:]+):(\S+)$/);

const validMxId = (id: string): boolean => !!matchMxId(id);

export const getMxIdServer = (userId: string): string | undefined => matchMxId(userId)?.[3];

export const getMxIdLocalPart = (userId: string): string | undefined => matchMxId(userId)?.[2];

export const isUserId = (id: string): boolean => validMxId(id) && id.startsWith('@');

export const isRoomId = (id: string): boolean => id.startsWith('!');

export const isRoomAlias = (id: string): boolean => validMxId(id) && id.startsWith('#');

export const getCanonicalAliasRoomId = (mx: MatrixClient, alias: string): string | undefined =>
  mx
    .getRooms()
    ?.find(
      (room) =>
        room.getCanonicalAlias() === alias &&
        getStateEvent(room, StateEvent.RoomTombstone) === undefined
    )?.roomId;

export const getCanonicalAliasOrRoomId = (mx: MatrixClient, roomId: string): string => {
  const room = mx.getRoom(roomId);
  if (!room) return roomId;
  if (getStateEvent(room, StateEvent.RoomTombstone) !== undefined) return roomId;
  const alias = room.getCanonicalAlias();
  if (alias && getCanonicalAliasRoomId(mx, alias) === roomId) {
    return alias;
  }
  return roomId;
};

export const getImageInfo = (img: HTMLImageElement, fileOrBlob: File | Blob): IImageInfo => {
  const info: IImageInfo = {};
  info.w = img.width;
  info.h = img.height;
  info.mimetype = fileOrBlob.type;
  info.size = fileOrBlob.size;
  return info;
};

export const getVideoInfo = (video: HTMLVideoElement, fileOrBlob: File | Blob): IVideoInfo => {
  const info: IVideoInfo = {};
  info.duration = Number.isNaN(video.duration) ? undefined : Math.floor(video.duration * 1000);
  info.w = video.videoWidth;
  info.h = video.videoHeight;
  info.mimetype = fileOrBlob.type;
  info.size = fileOrBlob.size;
  return info;
};

export const getThumbnailContent = (thumbnailInfo: {
  thumbnail: File | Blob;
  encInfo: EncryptedAttachmentInfo | undefined;
  mxc: string;
  width: number;
  height: number;
}): IThumbnailContent => {
  const { thumbnail, encInfo, mxc, width, height } = thumbnailInfo;

  const content: IThumbnailContent = {
    thumbnail_info: {
      mimetype: thumbnail.type,
      size: thumbnail.size,
      w: width,
      h: height,
    },
  };
  if (encInfo) {
    content.thumbnail_file = {
      ...encInfo,
      url: mxc,
    };
  } else {
    content.thumbnail_url = mxc;
  }
  return content;
};

export const encryptFile = async (
  file: File | Blob
): Promise<{
  encInfo: EncryptedAttachmentInfo;
  file: File;
  originalFile: File | Blob;
}> => {
  const dataBuffer = await file.arrayBuffer();
  const encryptedAttachment = await encryptAttachment(dataBuffer);
  const encFile = new File([encryptedAttachment.data], file.name, {
    type: file.type,
  });
  return {
    encInfo: encryptedAttachment.info,
    file: encFile,
    originalFile: file,
  };
};

export const decryptFile = async (
  dataBuffer: ArrayBuffer,
  type: string,
  encInfo: EncryptedAttachmentInfo
): Promise<Blob> => {
  const dataArray = await decryptAttachment(dataBuffer, encInfo);
  const blob = new Blob([dataArray], { type });
  return blob;
};

export type TUploadContent = File | Blob;

export type ContentUploadOptions = {
  name?: string;
  fileType?: string;
  hideFilename?: boolean;
  onPromise?: (promise: Promise<UploadResponse>) => void;
  onProgress?: (progress: UploadProgress) => void;
  onSuccess: (mxc: string) => void;
  onError: (error: MatrixError) => void;
};

export const uploadContent = async (
  mx: MatrixClient,
  file: TUploadContent,
  options: ContentUploadOptions
) => {
  const { name, fileType, hideFilename, onProgress, onPromise, onSuccess, onError } = options;

  const uploadPromise = mx.uploadContent(file, {
    name,
    type: fileType,
    includeFilename: !hideFilename,
    progressHandler: onProgress,
  });
  onPromise?.(uploadPromise);
  try {
    const data = await uploadPromise;
    const mxc = data.content_uri;
    if (mxc) onSuccess(mxc);
    else onError(new MatrixError(data));
  } catch (e: any) {
    const error = typeof e?.message === 'string' ? e.message : undefined;
    const errcode = typeof e?.name === 'string' ? e.message : undefined;
    onError(new MatrixError({ error, errcode }));
  }
};

export const matrixEventByRecency = (m1: MatrixEvent, m2: MatrixEvent) => m2.getTs() - m1.getTs();

export const factoryEventSentBy = (senderId: string) => (ev: MatrixEvent) =>
  ev.getSender() === senderId;

export const eventWithShortcode = (ev: MatrixEvent) =>
  typeof ev.getContent().shortcode === 'string';

export const getDMRoomFor = (mx: MatrixClient, userId: string): Room | undefined => {
  const dmLikeRooms = mx
    .getRooms()
    .filter(
      (room) =>
        room.getMyMembership() === Membership.Join &&
        room.hasEncryptionStateEvent() &&
        room.getMembers().length <= 2
    );

  return dmLikeRooms.find((room) => room.getMember(userId));
};

export const guessDmRoomUserId = (room: Room, myUserId: string): string => {
  const getOldestMember = (members: RoomMember[]): RoomMember | undefined => {
    let oldestMemberTs: number | undefined;
    let oldestMember: RoomMember | undefined;

    const pickOldestMember = (member: RoomMember) => {
      if (member.userId === myUserId) return;

      if (
        oldestMemberTs === undefined ||
        (member.events.member && member.events.member.getTs() < oldestMemberTs)
      ) {
        oldestMember = member;
        oldestMemberTs = member.events.member?.getTs();
      }
    };

    members.forEach(pickOldestMember);

    return oldestMember;
  };

  // Pick the joined user who's been here longest (and isn't us),
  const member = getOldestMember(room.getJoinedMembers());
  if (member) return member.userId;

  // if there are no joined members other than us, use the oldest member
  const member1 = getOldestMember(
    room.getLiveTimeline().getState(EventTimeline.FORWARDS)?.getMembers() ?? []
  );
  return member1?.userId ?? myUserId;
};

// Read the AUTHORITATIVE m.direct before mutating it. Under sliding sync the
// LOCAL copy is unreliable: Continuwuity only re-pushes account data that changed
// since the persisted pos (none on a restored pos), and setAccountData reflects
// locally only once the server echoes it back a poll later. So merging against the
// local copy means successive tags each read the SAME stale base and CLOBBER each
// other — only the last survives. That is the "DM list went 0→1 and never inflates"
// bug: every /converttodm overwrote the previous instead of accumulating. Fetch
// from the server so the merge is always against current truth.
const readMDirect = async (mx: MatrixClient): Promise<Record<string, string[]>> => {
  try {
    const fromServer = await mx.getAccountDataFromServer(AccountDataEvent.Direct as any);
    if (fromServer && typeof fromServer === 'object')
      return structuredClone(fromServer) as unknown as Record<string, string[]>;
  } catch {
    /* not reachable — fall back to the local copy */
  }
  const local = mx.getAccountData(AccountDataEvent.Direct as any);
  return local ? (structuredClone(local.getContent()) as Record<string, string[]>) : {};
};

// Persist m.direct AND reflect it in the local store immediately, so the DM list
// inflates right now instead of waiting on a sliding-sync account_data echo that
// Continuwuity may delay or (on a restored pos) never send.
const commitMDirect = async (
  mx: MatrixClient,
  content: Record<string, string[]>
): Promise<void> => {
  await mx.setAccountData(AccountDataEvent.Direct as any, content as any);
  const prev = mx.getAccountData(AccountDataEvent.Direct as any);
  const ev = new MatrixEvent({ type: AccountDataEvent.Direct, content });
  mx.store.storeAccountDataEvents([ev]);
  mx.emit(ClientEvent.AccountData, ev, prev ?? undefined);
};

export const addRoomIdToMDirect = async (
  mx: MatrixClient,
  roomId: string,
  userId: string
): Promise<void> => {
  const userIdToRoomIds = await readMDirect(mx);

  // remove it from the lists of any others users
  // (it can only be a DM room for one person)
  Object.keys(userIdToRoomIds).forEach((targetUserId) => {
    const roomIds = userIdToRoomIds[targetUserId];

    if (targetUserId !== userId) {
      const indexOfRoomId = roomIds.indexOf(roomId);
      if (indexOfRoomId > -1) {
        roomIds.splice(indexOfRoomId, 1);
      }
    }
  });

  const roomIds = userIdToRoomIds[userId] || [];
  if (roomIds.indexOf(roomId) === -1) {
    roomIds.push(roomId);
  }
  userIdToRoomIds[userId] = roomIds;

  await commitMDirect(mx, userIdToRoomIds);
};

export const removeRoomIdFromMDirect = async (mx: MatrixClient, roomId: string): Promise<void> => {
  const userIdToRoomIds = await readMDirect(mx);

  Object.keys(userIdToRoomIds).forEach((targetUserId) => {
    const roomIds = userIdToRoomIds[targetUserId];
    const indexOfRoomId = roomIds.indexOf(roomId);
    if (indexOfRoomId > -1) {
      roomIds.splice(indexOfRoomId, 1);
    }
  });

  await commitMDirect(mx, userIdToRoomIds);
};

// Bridge-aware DM detection. Kept local rather than importing from utils/bridges
// because bridges.ts imports from THIS module (a cycle). Mirrors its heuristics.
const DM_BRIDGE_KEYWORDS = ['bridge', 'bot', 'relay'];
const DM_GHOST_LOCALPART_RE = /^([a-z][a-z0-9]+)_/;

// A bridge bot member (the protocol bot in a portal), used both to exclude it
// from the human count AND to GROUP candidates by which bridge they came through.
const isBridgeBotMember = (member: RoomMember): boolean => {
  const local = getMxIdLocalPart(member.userId)?.toLowerCase() ?? '';
  if (DM_BRIDGE_KEYWORDS.some((k) => local === k || local.endsWith(k))) return true;
  const name = (member.rawDisplayName ?? member.name ?? '').toLowerCase();
  return DM_BRIDGE_KEYWORDS.some((k) => name.includes(k));
};

// Your OWN bridge puppet: double-puppeting adds a protocol ghost (localpart like
// `signal_…`) that posts as you (the "bot version of you"). Its display name is
// your display name. Excluded from the human count too.
const isMyPuppet = (member: RoomMember, myDisplayName: string | null): boolean => {
  if (!myDisplayName) return false;
  const local = getMxIdLocalPart(member.userId)?.toLowerCase() ?? '';
  if (!DM_GHOST_LOCALPART_RE.test(local)) return false;
  const name = (member.rawDisplayName ?? member.name ?? '').toLowerCase();
  return name === myDisplayName.toLowerCase();
};

// Another of YOUR OWN accounts (same Matrix localpart, different server) — e.g.
// @joop:poliglota for @joop:chat.kiefte. It isn't a conversation partner, so a
// room whose only other member is your alt is NOT a DM (it's why community rooms
// like "Aligatorejo" got mistagged as DMs named after yourself).
const isMyAccount = (member: RoomMember, selfLocalpart: string | undefined): boolean =>
  !!selfLocalpart && getMxIdLocalPart(member.userId) === selfLocalpart;

export type DmRow = {
  roomId: string;
  roomName: string;
  partnerUserId: string;
  partnerName: string;
  // Grouping: the bridge bot's mxid, or 'native' for an un-bridged 1:1.
  groupKey: string;
  groupLabel: string;
  // true = already tagged in m.direct (uncheck to convert back to a room);
  // false = a candidate (check to convert to a DM).
  currentlyDM: boolean;
  // false = does NOT look like a real 1:1 (a group, a bot, or only your own alt
  // is the "partner"). Mistagged current DMs get this so the dialog can suggest
  // removing them; candidates are only ever added when this is true.
  valid: boolean;
};

// Force a full member fetch for a small room so bot/puppet classification works
// even under the lean sliding-sync roster. No-op-safe; bounded by the caller.
const ensureRoster = async (room: Room): Promise<void> => {
  const forceable = room as unknown as { forceLoadMembers?: () => Promise<unknown> };
  try {
    await (forceable.forceLoadMembers ? forceable.forceLoadMembers() : room.loadMembersIfNeeded());
  } catch {
    /* classify with whatever roster we have */
  }
};

// Find the bridge bot in a room's roster (for grouping), if any.
const roomBridgeBot = (room: Room, self: string | null): RoomMember | undefined =>
  room.getJoinedMembers().find((m) => m.userId !== self && isBridgeBotMember(m));

// Detect the full reshape picture WITHOUT writing: every joined 1:1 that ISN'T
// tagged as direct (candidate, currentlyDM:false) AND every room that IS tagged
// (currentlyDM:true, so the UI can offer to convert it back). Each row carries the
// bridge bot it came through so the dialog can group + toggle a whole bridge.
//
// A candidate DM is any non-space room where, after excluding the bridge bot and
// your own puppet, exactly ONE real person remains — native 1:1s and bridged 1:1s
// both qualify; group chats (2+ real people) don't.
// The real conversation partners in a room: joined members minus yourself, the
// bridge bot, your own puppet, and your other accounts (alts). A clean DM has
// exactly one; more means it's actually a group (and tagging it as a DM is a mistake).
export const dmRealHumans = (mx: MatrixClient, room: Room): RoomMember[] => {
  const self = mx.getUserId();
  const selfLocalpart = self ? getMxIdLocalPart(self) : undefined;
  const myDisplayName = self ? (mx.getUser(self)?.displayName ?? null) : null;
  return room
    .getJoinedMembers()
    .filter(
      (m) =>
        m.userId !== self &&
        !isBridgeBotMember(m) &&
        !isMyPuppet(m, myDisplayName) &&
        !isMyAccount(m, selfLocalpart)
    );
};

export const detectDmReshape = async (mx: MatrixClient): Promise<DmRow[]> => {
  const self = mx.getUserId();
  const merged = await readMDirect(mx);
  const taggedToUser = new Map<string, string>();
  Object.entries(merged).forEach(([userId, ids]) =>
    (ids || []).forEach((id) => taggedToUser.set(id, userId))
  );

  const realHumans = (room: Room): RoomMember[] => dmRealHumans(mx, room);

  const rows: DmRow[] = [];

  // Candidates: joined, non-space, not already tagged, shaped like a 1:1.
  // eslint-disable-next-line no-restricted-syntax
  for (const room of mx.getRooms()) {
    if (room.getMyMembership() !== Membership.Join) continue;
    if (room.isSpaceRoom()) continue;
    if (taggedToUser.has(room.roomId)) continue;
    const count = room.getJoinedMemberCount();
    if (count < 2 || count > 8) continue; // a 1:1 is small; bound the /members cost

    // eslint-disable-next-line no-await-in-loop
    await ensureRoster(room);
    const humans = realHumans(room);
    if (humans.length !== 1) continue;

    const partner = humans[0];
    const bot = roomBridgeBot(room, self);
    rows.push({
      roomId: room.roomId,
      roomName: room.name || room.roomId,
      partnerUserId: partner.userId,
      partnerName: partner.name || partner.userId,
      groupKey: bot ? bot.userId : 'native',
      groupLabel: bot ? bot.rawDisplayName || bot.name || bot.userId : 'Direct chats',
      currentlyDM: false,
      valid: true,
    });
  }

  // Current DMs: everything already in m.direct, so the user can review + untag.
  // Mark whether each STILL looks like a real 1:1 — mistags (a group, a bot, or a
  // room whose only "partner" is your own alt) come back valid:false so the dialog
  // can suggest removing them.
  // eslint-disable-next-line no-restricted-syntax
  for (const [roomId, userId] of taggedToUser) {
    const room = mx.getRoom(roomId);
    if (!room) {
      // Tagged room we're no longer in / don't hold — surface it so it can be cleared.
      rows.push({
        roomId,
        roomName: roomId,
        partnerUserId: userId,
        partnerName: userId,
        groupKey: 'native',
        groupLabel: 'Direct chats',
        currentlyDM: true,
        valid: false,
      });
      continue;
    }
    const count = room.getJoinedMemberCount();
    // eslint-disable-next-line no-await-in-loop
    if (count >= 2 && count <= 8) await ensureRoster(room);
    const humans = realHumans(room);
    const valid = humans.length === 1;
    const partner = valid ? humans[0] : undefined;
    const bot = roomBridgeBot(room, self);
    rows.push({
      roomId,
      roomName: room.name || roomId,
      partnerUserId: partner?.userId ?? userId,
      partnerName: partner?.name ?? room.getMember(userId)?.name ?? userId,
      groupKey: bot ? bot.userId : 'native',
      groupLabel: bot ? bot.rawDisplayName || bot.name || bot.userId : 'Direct chats',
      currentlyDM: true,
      valid,
    });
  }

  return rows;
};

// Apply a reshape in ONE merged, server-authoritative write: tag the rooms in
// `add` under their partner, untag the rooms in `removeRoomIds`. The single write
// means it accumulates correctly and the DM list updates immediately.
export const reshapeDm = async (
  mx: MatrixClient,
  add: { roomId: string; partnerUserId: string }[],
  removeRoomIds: string[]
): Promise<void> => {
  if (add.length === 0 && removeRoomIds.length === 0) return;
  const merged = await readMDirect(mx);
  const removeSet = new Set(removeRoomIds);
  Object.keys(merged).forEach((userId) => {
    merged[userId] = (merged[userId] || []).filter((id) => !removeSet.has(id));
    if (merged[userId].length === 0) delete merged[userId];
  });
  for (const { roomId, partnerUserId } of add) {
    const list = merged[partnerUserId] || [];
    if (!list.includes(roomId)) list.push(roomId);
    merged[partnerUserId] = list;
  }
  await commitMDirect(mx, merged);
};

export const mxcUrlToHttp = (
  mx: MatrixClient,
  mxcUrl: string,
  useAuthentication?: boolean,
  width?: number,
  height?: number,
  resizeMethod?: string,
  allowDirectLinks?: boolean,
  allowRedirects?: boolean
): string | null =>
  mx.mxcUrlToHttp(
    mxcUrl,
    width,
    height,
    resizeMethod,
    allowDirectLinks,
    allowRedirects,
    useAuthentication
  );

export const downloadMedia = async (src: string): Promise<Blob> => {
  // this request is authenticated by service worker
  const res = await fetch(src, { method: 'GET' });
  const blob = await res.blob();
  return blob;
};

export const downloadEncryptedMedia = async (
  src: string,
  decryptContent: (buf: ArrayBuffer) => Promise<Blob>
): Promise<Blob> => {
  const encryptedContent = await downloadMedia(src);
  const decryptedContent = await decryptContent(await encryptedContent.arrayBuffer());

  return decryptedContent;
};

export const rateLimitedActions = async <T, R = void>(
  data: T[],
  callback: (item: T, index: number) => Promise<R>,
  maxRetryCount?: number
) => {
  let retryCount = 0;

  let actionInterval = 0;

  const sleepForMs = (ms: number) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  const performAction = async (dataItem: T, index: number) => {
    const [err] = await to<R, MatrixError>(callback(dataItem, index));

    if (err?.httpStatus === 429) {
      if (retryCount === maxRetryCount) {
        return;
      }

      const waitMS = err.getRetryAfterMs() ?? 3000;
      actionInterval = waitMS * 1.5;
      await sleepForMs(waitMS);
      retryCount += 1;

      await performAction(dataItem, index);
    }
  };

  for (let i = 0; i < data.length; i += 1) {
    const dataItem = data[i];
    retryCount = 0;
    // eslint-disable-next-line no-await-in-loop
    await performAction(dataItem, i);
    if (actionInterval > 0) {
      // eslint-disable-next-line no-await-in-loop
      await sleepForMs(actionInterval);
    }
  }
};

export const knockSupported = (version: string): boolean => {
  const unsupportedVersion = ['1', '2', '3', '4', '5', '6'];
  return !unsupportedVersion.includes(version);
};
export const restrictedSupported = (version: string): boolean => {
  const unsupportedVersion = ['1', '2', '3', '4', '5', '6', '7'];
  return !unsupportedVersion.includes(version);
};
export const knockRestrictedSupported = (version: string): boolean => {
  const unsupportedVersion = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  return !unsupportedVersion.includes(version);
};
export const creatorsSupported = (version: string): boolean => {
  const unsupportedVersion = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
  return !unsupportedVersion.includes(version);
};
