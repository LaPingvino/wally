import produce from 'immer';
import { atom, useSetAtom } from 'jotai';
import {
  IRoomTimelineData,
  MatrixClient,
  MatrixEvent,
  Room,
  RoomEvent,
  SyncState,
} from 'matrix-js-sdk';
import { ReceiptContent, ReceiptType } from 'matrix-js-sdk/lib/@types/read_receipts';
import { useCallback, useEffect, useRef } from 'react';
import {
  Membership,
  NotificationType,
  RoomToUnread,
  UnreadInfo,
  Unread,
  StateEvent,
} from '../../../types/matrix/room';
import {
  getAllParents,
  getNotificationType,
  getUnreadInfo,
  getUnreadInfos,
  isNotificationEvent,
} from '../../utils/room';
import { roomToParentsAtom } from './roomToParents';
import { useStateEventCallback } from '../../hooks/useStateEventCallback';
import { useSyncState } from '../../hooks/useSyncState';
import { useRoomsNotificationPreferencesContext } from '../../hooks/useRoomsNotificationPreferences';

export type RoomToUnreadAction =
  | {
      type: 'RESET';
      unreadInfos: UnreadInfo[];
    }
  | {
      type: 'PUT';
      unreadInfo: UnreadInfo;
    }
  | {
      type: 'PUT_BATCH';
      unreadInfos: UnreadInfo[];
    }
  | {
      type: 'DELETE';
      roomId: string;
    };

export const unreadInfoToUnread = (unreadInfo: UnreadInfo): Unread => ({
  highlight: unreadInfo.highlight,
  total: unreadInfo.total,
  from: null,
  pending: unreadInfo.pending,
});

const putUnreadInfo = (
  roomToUnread: RoomToUnread,
  allParents: Set<string>,
  unreadInfo: UnreadInfo
) => {
  const oldUnread = roomToUnread.get(unreadInfo.roomId) ?? { highlight: 0, total: 0, from: null };
  roomToUnread.set(unreadInfo.roomId, unreadInfoToUnread(unreadInfo));

  const newH = unreadInfo.highlight - oldUnread.highlight;
  const newT = unreadInfo.total - oldUnread.total;

  allParents.forEach((parentId) => {
    const oldParentUnread = roomToUnread.get(parentId) ?? { highlight: 0, total: 0, from: null };
    roomToUnread.set(parentId, {
      highlight: (oldParentUnread.highlight += newH),
      total: (oldParentUnread.total += newT),
      from: new Set([...(oldParentUnread.from ?? []), unreadInfo.roomId]),
    });
  });
};

const deleteUnreadInfo = (roomToUnread: RoomToUnread, allParents: Set<string>, roomId: string) => {
  const oldUnread = roomToUnread.get(roomId);
  if (!oldUnread) return;
  roomToUnread.delete(roomId);

  allParents.forEach((parentId) => {
    const oldParentUnread = roomToUnread.get(parentId);
    if (!oldParentUnread) return;
    const newFrom = new Set([...(oldParentUnread.from ?? roomId)]);
    newFrom.delete(roomId);
    if (newFrom.size === 0) {
      roomToUnread.delete(parentId);
      return;
    }
    roomToUnread.set(parentId, {
      highlight: oldParentUnread.highlight - oldUnread.highlight,
      total: oldParentUnread.total - oldUnread.total,
      from: newFrom,
    });
  });
};

export const unreadEqual = (u1: Unread, u2: Unread): boolean => {
  // Compare `pending` too: a room flipping pending→confirmed with the SAME numbers must
  // still re-render (dot → number), so it can't be treated as "no change".
  const countEqual =
    u1.highlight === u2.highlight && u1.total === u2.total && !!u1.pending === !!u2.pending;

  if (!countEqual) return false;

  const f1 = u1.from;
  const f2 = u2.from;
  if (f1 === null && f2 === null) return true;
  if (f1 === null || f2 === null) return false;

  if (f1.size !== f2.size) return false;

  let fromEqual = true;
  f1?.forEach((item) => {
    if (!f2?.has(item)) {
      fromEqual = false;
    }
  });

  return fromEqual;
};

const baseRoomToUnread = atom<RoomToUnread>(new Map());
export const roomToUnreadAtom = atom<RoomToUnread, [RoomToUnreadAction], undefined>(
  (get) => get(baseRoomToUnread),
  (get, set, action) => {
    if (action.type === 'RESET') {
      const draftRoomToUnread: RoomToUnread = new Map();
      action.unreadInfos.forEach((unreadInfo) => {
        putUnreadInfo(
          draftRoomToUnread,
          getAllParents(get(roomToParentsAtom), unreadInfo.roomId),
          unreadInfo
        );
      });
      set(baseRoomToUnread, draftRoomToUnread);
      return;
    }
    if (action.type === 'PUT') {
      const { unreadInfo } = action;
      const currentUnread = get(baseRoomToUnread).get(unreadInfo.roomId);
      if (currentUnread && unreadEqual(currentUnread, unreadInfoToUnread(unreadInfo))) {
        // Do not update if unread data has not changes
        // like total & highlight
        return;
      }
      set(
        baseRoomToUnread,
        produce(get(baseRoomToUnread), (draftRoomToUnread) =>
          putUnreadInfo(
            draftRoomToUnread,
            getAllParents(get(roomToParentsAtom), unreadInfo.roomId),
            unreadInfo
          )
        )
      );
      return;
    }
    if (action.type === 'PUT_BATCH') {
      // Single produce() for all rooms — avoids N separate Map clones.
      set(
        baseRoomToUnread,
        produce(get(baseRoomToUnread), (draftRoomToUnread) => {
          const roomToParents = get(roomToParentsAtom);
          for (const unreadInfo of action.unreadInfos) {
            const currentUnread = draftRoomToUnread.get(unreadInfo.roomId);
            if (currentUnread && unreadEqual(currentUnread, unreadInfoToUnread(unreadInfo))) {
              continue;
            }
            putUnreadInfo(draftRoomToUnread, getAllParents(roomToParents, unreadInfo.roomId), unreadInfo);
          }
        })
      );
      return;
    }
    if (action.type === 'DELETE' && get(baseRoomToUnread).has(action.roomId)) {
      set(
        baseRoomToUnread,
        produce(get(baseRoomToUnread), (draftRoomToUnread) =>
          deleteUnreadInfo(
            draftRoomToUnread,
            getAllParents(get(roomToParentsAtom), action.roomId),
            action.roomId
          )
        )
      );
    }
  }
);

export const useBindRoomToUnreadAtom = (mx: MatrixClient, unreadAtom: typeof roomToUnreadAtom) => {
  const setUnreadAtom = useSetAtom(unreadAtom);
  const roomsNotificationPreferences = useRoomsNotificationPreferencesContext();
  // Shared between timeline and receipt effects so receipts can cancel pending unread updates.
  const dirtyRoomsRef = useRef(new Set<string>());

  useEffect(() => {
    setUnreadAtom({
      type: 'RESET',
      unreadInfos: getUnreadInfos(mx),
    });
  }, [mx, setUnreadAtom]);

  useSyncState(
    mx,
    useCallback(
      (state, prevState) => {
        if (
          (state === SyncState.Prepared && prevState === null) ||
          (state === SyncState.Syncing && prevState !== SyncState.Syncing)
        ) {
          setUnreadAtom({
            type: 'RESET',
            unreadInfos: getUnreadInfos(mx),
          });
        }
      },
      [mx, setUnreadAtom]
    )
  );

  useEffect(() => {
    // Throttled unread updates: collect dirty room IDs and flush at most
    // every 2 seconds. Without throttling, every incoming event across all
    // rooms triggers getUnreadInfo + atom comparison + potential re-render
    // of every sidebar badge — pinning the CPU on busy servers.
    const dirtyRooms = dirtyRoomsRef.current;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      flushTimer = null;
      const puts: UnreadInfo[] = [];
      dirtyRooms.forEach((roomId) => {
        const room = mx.getRoom(roomId);
        if (!room) return;
        const info = getUnreadInfo(room, mx);
        if (info.total > 0 || info.highlight > 0) {
          puts.push(info);
        } else {
          // Computed to read / activity-only / not-yet-countable → REMOVE any existing badge.
          // Storing a total-0 entry here is what produced "dots that never go away": the badge
          // renders an empty (count-0) dot, and every later notification-count change re-marked
          // the room dirty and re-stored the zero. DELETE is a no-op if it isn't currently shown.
          setUnreadAtom({ type: 'DELETE', roomId });
        }
      });
      dirtyRooms.clear();
      if (puts.length > 0) {
        setUnreadAtom({ type: 'PUT_BATCH', unreadInfos: puts });
      }
    };

    const handleTimelineEvent = (
      mEvent: MatrixEvent,
      room: Room | undefined,
      toStartOfTimeline: boolean | undefined,
      removed: boolean,
      data: IRoomTimelineData
    ) => {
      if (!room || !data.liveEvent || room.isSpaceRoom() || !isNotificationEvent(mEvent)) return;
      if (getNotificationType(mx, room.roomId) === NotificationType.Mute) {
        setUnreadAtom({
          type: 'DELETE',
          roomId: room.roomId,
        });
        return;
      }

      if (mEvent.getSender() === mx.getUserId()) {
        // Own messages mark the room as read — remove from dirty set
        // so a pending flush doesn't re-add the unread badge.
        dirtyRooms.delete(room.roomId);
        return;
      }
      dirtyRooms.add(room.roomId);
      if (!flushTimer) {
        flushTimer = setTimeout(flush, 2000);
      }
    };
    // Upgrade a "pending" (dot) room to a real number once it goes live-synced. A live
    // sliding-sync response sets the room's notification count (processRoomData →
    // setUnreadNotificationCount, which emits unconditionally), so this fires as the window
    // sweeps each room into live state — at which point getUnreadInfo sees isRoomLiveSynced
    // === true and returns a confident count. Reuses the same throttled flush.
    const handleUnreadNotifications = (...args: unknown[]) => {
      // Re-emitted from the Room via the client's ReEmitter, which appends the source room
      // as the LAST argument (the event has several emit arities, so the room's position
      // varies — read it from the end).
      const room = args[args.length - 1];
      if (!(room instanceof Room) || room.isSpaceRoom() || room.getMyMembership() !== 'join') return;
      if (getNotificationType(mx, room.roomId) === NotificationType.Mute) return;
      dirtyRooms.add(room.roomId);
      if (!flushTimer) {
        flushTimer = setTimeout(flush, 2000);
      }
    };

    mx.on(RoomEvent.Timeline, handleTimelineEvent);
    // The client re-emits this once the SDK is rebuilt+repinned; cast so this file
    // typechecks against either SDK version in node_modules (runtime is gated on the
    // deployed SDK actually re-emitting it — see the reEmit lists in the SDK fork).
    const mxEmitter = mx as unknown as {
      on: (event: RoomEvent, cb: (...args: unknown[]) => void) => void;
      removeListener: (event: RoomEvent, cb: (...args: unknown[]) => void) => void;
    };
    mxEmitter.on(RoomEvent.UnreadNotifications, handleUnreadNotifications);
    return () => {
      mx.removeListener(RoomEvent.Timeline, handleTimelineEvent);
      mxEmitter.removeListener(RoomEvent.UnreadNotifications, handleUnreadNotifications);
      if (flushTimer) clearTimeout(flushTimer);
      // Flush remaining dirty rooms on cleanup
      if (dirtyRooms.size > 0) flush();
    };
  }, [mx, setUnreadAtom]);

  useEffect(() => {
    const handleReceipt = (mEvent: MatrixEvent, room: Room) => {
      const myUserId = mx.getUserId();
      if (!myUserId) return;
      if (room.isSpaceRoom()) return;
      const content = mEvent.getContent<ReceiptContent>();

      const isMyReceipt = Object.keys(content).find((eventId) =>
        (Object.keys(content[eventId]) as ReceiptType[]).find(
          (receiptType) => content[eventId][receiptType][myUserId]
        )
      );
      if (isMyReceipt) {
        // Clear from pending throttled updates so the flush doesn't re-add
        // the unread badge after the receipt already cleared it.
        dirtyRoomsRef.current.delete(room.roomId);
        setUnreadAtom({ type: 'DELETE', roomId: room.roomId });
      }
    };
    mx.on(RoomEvent.Receipt, handleReceipt);
    return () => {
      mx.removeListener(RoomEvent.Receipt, handleReceipt);
    };
  }, [mx, setUnreadAtom]);

  useEffect(() => {
    setUnreadAtom({
      type: 'RESET',
      unreadInfos: getUnreadInfos(mx),
    });
  }, [mx, setUnreadAtom, roomsNotificationPreferences]);

  useEffect(() => {
    const handleMembershipChange = (room: Room, membership: string) => {
      if (membership !== Membership.Join) {
        setUnreadAtom({
          type: 'DELETE',
          roomId: room.roomId,
        });
      }
    };
    mx.on(RoomEvent.MyMembership, handleMembershipChange);
    return () => {
      mx.removeListener(RoomEvent.MyMembership, handleMembershipChange);
    };
  }, [mx, setUnreadAtom]);

  useStateEventCallback(
    mx,
    useCallback(
      (mEvent) => {
        if (mEvent.getType() === StateEvent.SpaceChild) {
          setUnreadAtom({
            type: 'RESET',
            unreadInfos: getUnreadInfos(mx),
          });
        }
      },
      [mx, setUnreadAtom]
    )
  );
};
