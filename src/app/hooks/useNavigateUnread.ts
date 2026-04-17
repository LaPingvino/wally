import { useCallback, useMemo } from 'react';
import { useAtomValue, useAtom } from 'jotai';
import { atom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { MatrixClient } from 'matrix-js-sdk';
import { roomToUnreadAtom } from '../state/room/roomToUnread';
import { mDirectAtom } from '../state/mDirectList';
import { roomToParentsAtom } from '../state/room/roomToParents';
import { useMatrixClient } from './useMatrixClient';
import { getCanonicalAliasOrRoomId } from '../utils/matrix';
import {
  getDirectRoomPath,
  getHomeRoomPath,
  getSpaceRoomPath,
} from '../pages/pathUtils';
import { AccountDataEvent } from '../../types/matrix/accountData';
import {
  factoryRoomIdByActivity,
  factoryRoomIdByAtoZ,
  factoryRoomIdByUnreadFirst,
} from '../utils/sort';
import { settingsAtom } from '../state/settings';
import { useSelectedRoom } from './router/useSelectedRoom';

/**
 * Track the last navigated room by ID + its position in the list at the time.
 * Using room ID (not just index) means we can correctly position ourselves
 * even when the list shrinks as rooms are read.
 */
const lastNavigatedAtom = atom<{ roomId: string; index: number } | null>(null);

/**
 * Within-room mention navigation state.
 * Set by "Jump to Last Mention" in the room header menu.
 * Prev @/Next @ chips in RoomTimeline read and update this.
 */
export const mentionNavAtom = atom<{ roomId: string; eventIds: string[]; index: number } | null>(
  null
);

type SidebarItem = string | { id: string; content: string[] };

/** Flat ordered list of space IDs from the user's sidebar config. */
function getSidebarSpaceIds(mx: MatrixClient): string[] {
  const content = mx
    .getAccountData(AccountDataEvent.CinnySpaces)
    ?.getContent<{ sidebar?: SidebarItem[] }>();
  const sidebar = content?.sidebar ?? [];
  const ids: string[] = [];
  sidebar.forEach((item) => {
    if (typeof item === 'string') ids.push(item);
    else if (typeof item === 'object' && Array.isArray(item.content))
      item.content.forEach((id) => ids.push(id));
  });
  return ids;
}

/**
 * Walk up the parent chain (via roomToParents) until we find a space that is
 * in the sidebar. Returns the sidebar index, or Infinity if none found.
 */
function getSidebarIndex(
  roomId: string,
  roomToParents: Map<string, Set<string>>,
  sidebarIndex: Map<string, number>
): number {
  const visited = new Set<string>();
  let frontier = new Set([roomId]);
  while (frontier.size > 0) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const parent of roomToParents.get(id) ?? []) {
        const idx = sidebarIndex.get(parent);
        if (idx !== undefined) return idx;
        if (!visited.has(parent)) {
          visited.add(parent);
          next.add(parent);
        }
      }
    }
    frontier = next;
  }
  return Infinity;
}

export function useNavigateUnread() {
  const navigate = useNavigate();
  const mx = useMatrixClient();
  const roomToUnread = useAtomValue(roomToUnreadAtom);
  const mDirects = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const settings = useAtomValue(settingsAtom);
  const roomSortOrder: string =
    (settings as unknown as { roomSortOrder?: string }).roomSortOrder ?? 'activity';
  const [lastNavigated, setLastNavigated] = useAtom(lastNavigatedAtom);
  const selectedRoomId = useSelectedRoom();

  // Sorted list of rooms matching a predicate (unread or mention).
  // Callers use this to step through rooms in sidebar order; sort fallback
  // mirrors the room list's current activity/az/unread-first setting.
  const buildSortedRooms = useCallback(
    (matches: (id: string) => boolean) => {
      const getUnread = (id: string) => roomToUnread.get(id) ?? { highlight: 0, total: 0 };

      const sidebarSpaceIds = getSidebarSpaceIds(mx);
      const sidebarIndex = new Map(sidebarSpaceIds.map((id, i) => [id, i]));

      const rooms = Array.from(roomToUnread.keys()).filter(
        (id) => matches(id) && !mx.getRoom(id)?.isSpaceRoom()
      );

      const sortFallback =
        roomSortOrder === 'az'
          ? factoryRoomIdByAtoZ(mx)
          : roomSortOrder === 'unread'
          ? factoryRoomIdByUnreadFirst(
              (id) => getUnread(id).highlight,
              (id) => getUnread(id).total,
              factoryRoomIdByActivity(mx)
            )
          : factoryRoomIdByActivity(mx);

      rooms.sort((a, b) => {
        const ai = getSidebarIndex(a, roomToParents, sidebarIndex);
        const bi = getSidebarIndex(b, roomToParents, sidebarIndex);
        if (ai !== bi) return ai - bi;
        return sortFallback(a, b);
      });

      return rooms.map((id) => [id, roomToUnread.get(id)!] as const);
    },
    [mx, roomToUnread, roomToParents, roomSortOrder]
  );

  const unreadEntries = useMemo(
    () => buildSortedRooms((id) => (roomToUnread.get(id)?.total ?? 0) > 0),
    [buildSortedRooms, roomToUnread]
  );

  const mentionEntries = useMemo(
    () => buildSortedRooms((id) => (roomToUnread.get(id)?.highlight ?? 0) > 0),
    [buildSortedRooms, roomToUnread]
  );

  const navigateToRoom = useCallback(
    (roomId: string) => {
      const roomIdOrAlias = getCanonicalAliasOrRoomId(mx, roomId);
      const isDirect = mDirects.has(roomId);
      if (isDirect) {
        navigate(getDirectRoomPath(roomIdOrAlias));
      } else {
        const parents = roomToParents.get(roomId);
        if (parents && parents.size > 0) {
          const spaceId = Array.from(parents)[0];
          navigate(getSpaceRoomPath(getCanonicalAliasOrRoomId(mx, spaceId), roomIdOrAlias));
        } else {
          navigate(getHomeRoomPath(roomIdOrAlias));
        }
      }
    },
    [mx, mDirects, roomToParents, navigate]
  );

  /**
   * Resolve the base index to navigate relative to within `entries`.
   * Priority: lastNavigated room ID > selectedRoomId > fallback.
   * fallback = -1 (for next → first room) or length (for prev → last room).
   */
  const resolveBaseIndex = useCallback(
    (entries: ReadonlyArray<readonly [string, unknown]>, fallback: number): number => {
      if (lastNavigated) {
        const found = entries.findIndex(([id]) => id === lastNavigated.roomId);
        if (found >= 0) return found;
        const clamped = Math.min(lastNavigated.index, entries.length);
        return fallback < 0 ? clamped - 1 : Math.max(1, clamped);
      }
      if (selectedRoomId) {
        const found = entries.findIndex(([id]) => id === selectedRoomId);
        if (found >= 0) return found;
      }
      return fallback;
    },
    [lastNavigated, selectedRoomId]
  );

  const stepTo = useCallback(
    (entries: ReadonlyArray<readonly [string, unknown]>, direction: 1 | -1) => {
      if (entries.length === 0) return;
      const baseIndex = resolveBaseIndex(entries, direction === 1 ? -1 : entries.length);
      const target = ((baseIndex + direction) % entries.length + entries.length) % entries.length;
      const roomId = entries[target][0];
      setLastNavigated({ roomId, index: target });
      navigateToRoom(roomId);
    },
    [resolveBaseIndex, setLastNavigated, navigateToRoom]
  );

  const navigateNext = useCallback(() => stepTo(unreadEntries, 1), [stepTo, unreadEntries]);
  const navigatePrev = useCallback(() => stepTo(unreadEntries, -1), [stepTo, unreadEntries]);
  const navigateNextMention = useCallback(() => stepTo(mentionEntries, 1), [stepTo, mentionEntries]);
  const navigatePrevMention = useCallback(() => stepTo(mentionEntries, -1), [stepTo, mentionEntries]);

  const navigateFirst = useCallback(() => {
    if (unreadEntries.length === 0) return;
    const roomId = unreadEntries[0][0];
    setLastNavigated({ roomId, index: 0 });
    navigateToRoom(roomId);
  }, [unreadEntries, setLastNavigated, navigateToRoom]);

  return {
    navigateNext,
    navigatePrev,
    navigateNextMention,
    navigatePrevMention,
    navigateFirst,
    unreadCount: unreadEntries.length,
    mentionCount: mentionEntries.length,
  };
}

