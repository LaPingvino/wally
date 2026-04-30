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
import { bottomBarDismissedAtom } from '../state/bottomBarDismiss';

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
  const setBottomBarDismissed = useAtom(bottomBarDismissedAtom)[1];
  const selectedRoomId = useSelectedRoom();

  // Sorted list of rooms matching a predicate (unread or mention) plus the
  // shared comparator used to virtually position the currently-selected
  // room within that list.
  //
  // Ordering rules (the user-visible behaviour):
  //   1. Rooms whose containing space matches the *currently open* space
  //      come first, in the room-list's normal sort order. This keeps
  //      "next unread" walking through the active space before jumping
  //      anywhere else.
  //   2. Then every other room grouped by sidebar space index. Within a
  //      space, rooms use the room-list's normal sort.
  const buildSortedRooms = useCallback(
    (matches: (id: string) => boolean) => {
      const getUnread = (id: string) => roomToUnread.get(id) ?? { highlight: 0, total: 0 };

      const sidebarSpaceIds = getSidebarSpaceIds(mx);
      const sidebarIndex = new Map(sidebarSpaceIds.map((id, i) => [id, i]));

      // Active space = the space containing the currently-selected room
      // (Infinity if none — Home/DM views, or the user just landed).
      const activeSidebarIdx = selectedRoomId
        ? getSidebarIndex(selectedRoomId, roomToParents, sidebarIndex)
        : Infinity;

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

      // 0 = in active space, 1 = elsewhere — sorted ascending so active
      // space wins. Beyond that, group by sidebar space index, then
      // fall back to the user's room-sort preference.
      const compare = (a: string, b: string): number => {
        const ai = getSidebarIndex(a, roomToParents, sidebarIndex);
        const bi = getSidebarIndex(b, roomToParents, sidebarIndex);
        const aBucket = ai === activeSidebarIdx ? 0 : 1;
        const bBucket = bi === activeSidebarIdx ? 0 : 1;
        if (aBucket !== bBucket) return aBucket - bBucket;
        if (ai !== bi) return ai - bi;
        return sortFallback(a, b);
      };

      rooms.sort(compare);

      return {
        entries: rooms.map((id) => [id, roomToUnread.get(id)!] as const),
        compare,
      };
    },
    [mx, roomToUnread, roomToParents, roomSortOrder, selectedRoomId]
  );

  const unread = useMemo(
    () => buildSortedRooms((id) => (roomToUnread.get(id)?.total ?? 0) > 0),
    [buildSortedRooms, roomToUnread]
  );

  const mention = useMemo(
    () => buildSortedRooms((id) => (roomToUnread.get(id)?.highlight ?? 0) > 0),
    [buildSortedRooms, roomToUnread]
  );

  const unreadEntries = unread.entries;
  const mentionEntries = mention.entries;

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
   * Step prev/next through `entries`. The "anchor" we step from is the
   * currently-selected room — if it's already in the unread list, we use
   * its index directly; otherwise we use `compare` to find the slot
   * where it would virtually sort and step from there.
   *
   * This lets prev/next behave correctly when the current room has no
   * unreads: next picks the first unread that sorts after the current
   * room, prev picks the last unread that sorts before it. Wrapping at
   * either end falls through to the global list (other spaces).
   */
  const stepTo = useCallback(
    (
      entries: ReadonlyArray<readonly [string, unknown]>,
      compare: (a: string, b: string) => number,
      direction: 1 | -1
    ) => {
      if (entries.length === 0) return;

      let baseIndex: number;

      // Anchor: prefer lastNavigated when its room is still in the list.
      if (lastNavigated) {
        const found = entries.findIndex(([id]) => id === lastNavigated.roomId);
        if (found >= 0) {
          baseIndex = found;
        } else {
          baseIndex = direction === 1 ? -1 : entries.length;
        }
      } else if (selectedRoomId) {
        const found = entries.findIndex(([id]) => id === selectedRoomId);
        if (found >= 0) {
          baseIndex = found;
        } else {
          // selectedRoom is not unread — find its virtual position.
          // insertAt = first index whose entry sorts AFTER selected.
          let insertAt = entries.length;
          for (let i = 0; i < entries.length; i += 1) {
            if (compare(entries[i][0], selectedRoomId) >= 0) {
              insertAt = i;
              break;
            }
          }
          // For next: virtual base is insertAt - 1, so target = insertAt
          //           = first unread sorting after selected.
          // For prev: virtual base is insertAt, so target = insertAt - 1
          //           = last unread sorting before selected.
          baseIndex = direction === 1 ? insertAt - 1 : insertAt;
        }
      } else {
        baseIndex = direction === 1 ? -1 : entries.length;
      }

      const target = ((baseIndex + direction) % entries.length + entries.length) % entries.length;
      const roomId = entries[target][0];
      setLastNavigated({ roomId, index: target });
      setBottomBarDismissed(false);
      navigateToRoom(roomId);
    },
    [lastNavigated, selectedRoomId, setLastNavigated, setBottomBarDismissed, navigateToRoom]
  );

  const navigateNext = useCallback(
    () => stepTo(unread.entries, unread.compare, 1),
    [stepTo, unread]
  );
  const navigatePrev = useCallback(
    () => stepTo(unread.entries, unread.compare, -1),
    [stepTo, unread]
  );
  const navigateNextMention = useCallback(
    () => stepTo(mention.entries, mention.compare, 1),
    [stepTo, mention]
  );
  const navigatePrevMention = useCallback(
    () => stepTo(mention.entries, mention.compare, -1),
    [stepTo, mention]
  );

  const navigateFirst = useCallback(() => {
    if (unreadEntries.length === 0) return;
    const roomId = unreadEntries[0][0];
    setLastNavigated({ roomId, index: 0 });
    setBottomBarDismissed(false);
    navigateToRoom(roomId);
  }, [unreadEntries, setLastNavigated, setBottomBarDismissed, navigateToRoom]);

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

