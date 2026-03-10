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
 * The roomId last navigated to via unread nav (keyboard shortcuts or inbox buttons).
 * Used to show the ↑↓ nav bar in the timeline only when in "unread browsing mode".
 */
export const unreadNavRoomAtom = atom<string | null>(null);

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
  const setUnreadNavRoom = useAtom(unreadNavRoomAtom)[1];
  const selectedRoomId = useSelectedRoom();

  const unreadEntries = useMemo(() => {
    const getUnread = (id: string) => roomToUnread.get(id) ?? { highlight: 0, total: 0 };
    const hasUnread = (id: string) => (roomToUnread.get(id)?.total ?? 0) > 0;

    // Build sidebar position lookup (space ID → index)
    const sidebarSpaceIds = getSidebarSpaceIds(mx);
    const sidebarIndex = new Map(sidebarSpaceIds.map((id, i) => [id, i]));

    // All rooms with unread, sorted by:
    //   1. sidebar position of their nearest ancestor space
    //   2. within same space: current roomSortOrder
    const allUnread = Array.from(roomToUnread.keys()).filter(
      (id) => hasUnread(id) && !mx.getRoom(id)?.isSpaceRoom()
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

    allUnread.sort((a, b) => {
      const ai = getSidebarIndex(a, roomToParents, sidebarIndex);
      const bi = getSidebarIndex(b, roomToParents, sidebarIndex);
      if (ai !== bi) return ai - bi;
      return sortFallback(a, b);
    });

    return allUnread.map((id) => [id, roomToUnread.get(id)!] as const);
  }, [mx, roomToUnread, roomToParents, roomSortOrder]);

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
   * Resolve the base index to navigate relative to.
   * Priority: lastNavigated room ID > selectedRoomId > fallback.
   * fallback = -1 (for next → first room) or length (for prev → last room).
   *
   * When the last-navigated room has been read (not in list):
   *   next: stay at the same position in the shrunk list (clamped - 1 → next = clamped)
   *   prev: go to the room before the original position (clamped → prev = clamped - 1)
   *         but avoid wrapping index 0 to end by using max(1, clamped).
   */
  const resolveBaseIndex = useCallback(
    (fallback: number): number => {
      if (lastNavigated) {
        const found = unreadEntries.findIndex(([id]) => id === lastNavigated.roomId);
        if (found >= 0) return found;
        const clamped = Math.min(lastNavigated.index, unreadEntries.length);
        return fallback < 0 ? clamped - 1 : Math.max(1, clamped);
      }
      if (selectedRoomId) {
        const found = unreadEntries.findIndex(([id]) => id === selectedRoomId);
        if (found >= 0) return found;
      }
      return fallback;
    },
    [unreadEntries, lastNavigated, selectedRoomId]
  );

  const navigateNext = useCallback(() => {
    if (unreadEntries.length === 0) return;
    const baseIndex = resolveBaseIndex(-1);
    const next = (baseIndex + 1) % unreadEntries.length;
    const roomId = unreadEntries[next][0];
    setLastNavigated({ roomId, index: next });
    setUnreadNavRoom(roomId);
    navigateToRoom(roomId);
  }, [unreadEntries, resolveBaseIndex, setLastNavigated, setUnreadNavRoom, navigateToRoom]);

  const navigatePrev = useCallback(() => {
    if (unreadEntries.length === 0) return;
    const baseIndex = resolveBaseIndex(unreadEntries.length);
    const prev = (baseIndex - 1 + unreadEntries.length) % unreadEntries.length;
    const roomId = unreadEntries[prev][0];
    setLastNavigated({ roomId, index: prev });
    setUnreadNavRoom(roomId);
    navigateToRoom(roomId);
  }, [unreadEntries, resolveBaseIndex, setLastNavigated, setUnreadNavRoom, navigateToRoom]);

  const navigateFirst = useCallback(() => {
    if (unreadEntries.length === 0) return;
    const roomId = unreadEntries[0][0];
    setLastNavigated({ roomId, index: 0 });
    setUnreadNavRoom(roomId);
    navigateToRoom(roomId);
  }, [unreadEntries, setLastNavigated, setUnreadNavRoom, navigateToRoom]);

  return { navigateNext, navigatePrev, navigateFirst, unreadCount: unreadEntries.length };
}
