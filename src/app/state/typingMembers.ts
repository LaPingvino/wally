import { atom, useSetAtom } from 'jotai';
import { MatrixClient, RoomMemberEvent, RoomMemberEventHandlerMap } from 'matrix-js-sdk';
import { useEffect } from 'react';
import { useSetting } from './hooks/settings';
import { settingsAtom } from './settings';
import { SyncBatchScheduler } from './syncBatchScheduler';
import { makeThrottledAtom } from './throttledAtom';

export const TYPING_TIMEOUT_MS = 5000; // 5 seconds
const CLEANUP_INTERVAL_MS = 3000; // Single interval to sweep expired entries

export type TypingReceipt = {
  userId: string;
  ts: number;
};
export type IRoomIdToTypingMembers = Map<string, TypingReceipt[]>;

type TypingMemberPutAction = {
  type: 'PUT';
  roomId: string;
  userId: string;
  ts: number;
};
type TypingMemberDeleteAction = {
  type: 'DELETE';
  roomId: string;
  userId: string;
};
type TypingMemberCleanupAction = {
  type: 'CLEANUP';
};
export type IRoomIdToTypingMembersAction =
  | TypingMemberPutAction
  | TypingMemberDeleteAction
  | TypingMemberCleanupAction;

const baseRoomIdToTypingMembersAtom = atom<IRoomIdToTypingMembers>(new Map());

// Forward declaration so we can attach the throttled view below.

export const roomIdToTypingMembersAtom = atom<
  IRoomIdToTypingMembers,
  [IRoomIdToTypingMembersAction],
  undefined
>(
  (get) => get(baseRoomIdToTypingMembersAtom),
  (get, set, action) => {
    const current = get(baseRoomIdToTypingMembersAtom);

    if (action.type === 'PUT') {
      // Mutate in place to avoid Map cloning (the old produce() cloned the
      // entire Map on every typing event — major GC pressure on busy servers).
      let members = current.get(action.roomId) ?? [];
      members = members.filter((r) => r.userId !== action.userId);
      members.push({ userId: action.userId, ts: action.ts });
      current.set(action.roomId, members);
      // Trigger subscribers with the same Map reference — jotai detects the
      // set() call as an update regardless of reference equality.
      set(baseRoomIdToTypingMembersAtom, new Map(current));
      return;
    }

    if (action.type === 'DELETE') {
      let members = current.get(action.roomId);
      if (!members) return;
      members = members.filter((r) => r.userId !== action.userId);
      if (members.length === 0) {
        current.delete(action.roomId);
      } else {
        current.set(action.roomId, members);
      }
      set(baseRoomIdToTypingMembersAtom, new Map(current));
      return;
    }

    if (action.type === 'CLEANUP') {
      // Sweep all rooms for expired typing receipts — runs every few seconds
      // instead of one setTimeout per typing event.
      const now = Date.now();
      let changed = false;
      for (const [roomId, members] of current) {
        const alive = members.filter((r) => now - r.ts < TYPING_TIMEOUT_MS);
        if (alive.length !== members.length) {
          changed = true;
          if (alive.length === 0) {
            current.delete(roomId);
          } else {
            current.set(roomId, alive);
          }
        }
      }
      if (changed) {
        set(baseRoomIdToTypingMembersAtom, new Map(current));
      }
    }
  }
);

/**
 * Throttled read-only view of roomIdToTypingMembersAtom.
 *
 * Every typing event from any of the user's rooms triggers a write
 * here, and every visible RoomNavItem has a selectAtom that re-runs
 * its selector on each write. On a busy server with hundreds of joined
 * rooms, that's a lot of selector calls per second. The throttle caps
 * the firing rate so the per-room components only re-check at most
 * 10× per second.
 *
 * Note this doesn't fix the *shape* (each RoomNavItem still wakes up
 * for typing in any room). The proper fix is an atomFamily per-room;
 * this throttle is the cheap step we can ship and measure first.
 */
export const typingMembersThrottled = makeThrottledAtom(
  roomIdToTypingMembersAtom,
  'typingMembers',
  100
);

export const useBindRoomIdToTypingMembersAtom = (
  mx: MatrixClient,
  typingMembersAtom: typeof roomIdToTypingMembersAtom
) => {
  const setTypingMembers = useSetAtom(typingMembersAtom);
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  useEffect(() => {
    const scheduler = new SyncBatchScheduler();

    // Batch typing events: collect all changes and flush once per rAF.
    // On busy servers, dozens of typing events can fire per sync batch.
    const pendingActions: IRoomIdToTypingMembersAction[] = [];

    const scheduleFlush = () => {
      scheduler.enqueue('typing', () => {
        if (pendingActions.length === 0) return;
        const actions = [...pendingActions];
        pendingActions.length = 0;
        for (const action of actions) {
          setTypingMembers(action);
        }
      });
    };

    const handleTypingEvent: RoomMemberEventHandlerMap[RoomMemberEvent.Typing] = (
      event,
      member
    ) => {
      if (hideActivity) {
        return;
      }
      pendingActions.push({
        type: member.typing ? 'PUT' : 'DELETE',
        roomId: member.roomId,
        userId: member.userId,
        ts: Date.now(),
      });
      scheduleFlush();
    };

    mx.on(RoomMemberEvent.Typing, handleTypingEvent);

    // Single cleanup interval replaces per-event setTimeout.
    const cleanupInterval = setInterval(() => {
      setTypingMembers({ type: 'CLEANUP' });
    }, CLEANUP_INTERVAL_MS);

    return () => {
      mx.removeListener(RoomMemberEvent.Typing, handleTypingEvent);
      clearInterval(cleanupInterval);
      scheduler.dispose();
    };
  }, [mx, setTypingMembers, hideActivity]);
};
