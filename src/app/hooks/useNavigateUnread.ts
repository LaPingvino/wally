import { useCallback, useMemo } from 'react';
import { useAtomValue, useAtom, atom } from 'jotai';
import { useNavigate, useLocation } from 'react-router-dom';
import { MatrixClient } from 'matrix-js-sdk';
import { roomToUnreadAtom } from '../state/room/roomToUnread';
import { mDirectAtom } from '../state/mDirectList';
import { roomToParentsAtom } from '../state/room/roomToParents';
import { allRoomsAtom } from '../state/room-list/roomList';
import {
  useChildRoomScopeFactory,
  useDirects,
  useOrphanRooms,
  useSpaceChildren,
} from '../state/hooks/roomList';
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
import { useSelectedSpace } from './router/useSelectedSpace';
import { bottomBarDismissedAtom } from '../state/bottomBarDismiss';

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
 * in the sidebar. Returns the sidebar id, or undefined if none found.
 */
function findSidebarSpaceForRoom(
  roomId: string,
  roomToParents: Map<string, Set<string>>,
  sidebarSet: Set<string>
): string | undefined {
  const visited = new Set<string>();
  let frontier = new Set([roomId]);
  while (frontier.size > 0) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const parent of roomToParents.get(id) ?? []) {
        if (sidebarSet.has(parent)) return parent;
        if (!visited.has(parent)) {
          visited.add(parent);
          next.add(parent);
        }
      }
    }
    frontier = next;
  }
  return undefined;
}

// View-bucket sentinels used in the sidebar order. The sidebar UI shows
// Home and Direct as their own tabs alongside the spaces, so we treat
// them as pseudo-spaces in the navigation order.
const HOME_BUCKET = '__home__';
const DIRECT_BUCKET = '__direct__';

type View = 'home' | 'direct' | 'space';

export function useNavigateUnread() {
  const navigate = useNavigate();
  const location = useLocation();
  const mx = useMatrixClient();
  const roomToUnread = useAtomValue(roomToUnreadAtom);
  const mDirects = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const settings = useAtomValue(settingsAtom);
  const roomSortOrder: string =
    (settings as unknown as { roomSortOrder?: string }).roomSortOrder ?? 'activity';
  const setBottomBarDismissed = useAtom(bottomBarDismissedAtom)[1];
  const selectedRoomId = useSelectedRoom();
  const selectedSpaceId = useSelectedSpace();

  // Determine current view from the URL.
  const view: View = location.pathname.startsWith('/direct/')
    ? 'direct'
    : location.pathname.startsWith('/home/') || (!selectedSpaceId && !location.pathname.startsWith('/direct/'))
    ? 'home'
    : 'space';
  const currentBucket: string =
    view === 'home' ? HOME_BUCKET : view === 'direct' ? DIRECT_BUCKET : selectedSpaceId ?? HOME_BUCKET;

  // ── Get rooms for each view in display order ──
  const homeRooms = useOrphanRooms(mx, allRoomsAtom, mDirects, roomToParents);
  const directRooms = useDirects(mx, allRoomsAtom, mDirects);
  const spaceChildSelector = useChildRoomScopeFactory(mx, mDirects, roomToParents);
  const spaceRooms = useSpaceChildren(allRoomsAtom, selectedSpaceId ?? '', spaceChildSelector);

  // Pick the appropriate list and apply current sort.
  const currentViewRooms = useMemo(() => {
    const getUnread = (id: string) => roomToUnread.get(id) ?? { highlight: 0, total: 0 };
    const sortFn =
      roomSortOrder === 'az'
        ? factoryRoomIdByAtoZ(mx)
        : roomSortOrder === 'unread'
        ? factoryRoomIdByUnreadFirst(
            (id) => getUnread(id).highlight,
            (id) => getUnread(id).total,
            factoryRoomIdByActivity(mx)
          )
        : factoryRoomIdByActivity(mx);
    const base = view === 'home' ? homeRooms : view === 'direct' ? directRooms : spaceRooms;
    return [...base].sort(sortFn);
  }, [view, homeRooms, directRooms, spaceRooms, mx, roomToUnread, roomSortOrder]);

  // ── Sidebar bucket order: home, direct, then user's sidebar spaces ──
  const sidebarBuckets = useMemo(() => {
    return [HOME_BUCKET, DIRECT_BUCKET, ...getSidebarSpaceIds(mx)];
  }, [mx]);

  // ── Per-bucket unread sets, computed fresh from roomToUnread ──
  // For home/direct: orphan rooms / direct rooms with unreads.
  // For each space: unread rooms whose sidebar-space resolves to that space.
  const unreadByBucket = useMemo((): Map<string, Set<string>> => {
    const sidebarSet = new Set(getSidebarSpaceIds(mx));
    const buckets = new Map<string, Set<string>>();
    for (const b of sidebarBuckets) buckets.set(b, new Set<string>());

    const homeOrphanSet = new Set(homeRooms);
    const directSet = new Set(directRooms);

    for (const id of roomToUnread.keys()) {
      const room = mx.getRoom(id);
      if (!room || room.isSpaceRoom()) continue;

      let bucket: string | undefined;
      if (directSet.has(id)) bucket = DIRECT_BUCKET;
      else if (homeOrphanSet.has(id)) bucket = HOME_BUCKET;
      else bucket = findSidebarSpaceForRoom(id, roomToParents, sidebarSet);

      if (bucket && buckets.has(bucket)) buckets.get(bucket)!.add(id);
    }
    return buckets;
  }, [mx, sidebarBuckets, roomToUnread, roomToParents, homeRooms, directRooms]);

  // ── For "next-space-with-unreads" lookup we need the bucket's room list
  //    to pick top/bottom unread. For home/direct we have it. For other
  //    spaces, we don't have their full room list (would need a separate
  //    hook per space) — so we fall back to a SORT of just the unread
  //    rooms in that bucket using the same sortFn. Close enough to the
  //    visible-list order in practice.
  const sortFnForBucket = useMemo(() => {
    const getUnread = (id: string) => roomToUnread.get(id) ?? { highlight: 0, total: 0 };
    return roomSortOrder === 'az'
      ? factoryRoomIdByAtoZ(mx)
      : roomSortOrder === 'unread'
      ? factoryRoomIdByUnreadFirst(
          (id) => getUnread(id).highlight,
          (id) => getUnread(id).total,
          factoryRoomIdByActivity(mx)
        )
      : factoryRoomIdByActivity(mx);
  }, [mx, roomToUnread, roomSortOrder]);

  const firstUnreadInBucket = useCallback(
    (bucket: string): string | undefined => {
      // For the current view, prefer display order.
      if (bucket === currentBucket && currentViewRooms.length > 0) {
        for (const id of currentViewRooms) if (roomToUnread.has(id)) return id;
      }
      const unreads = unreadByBucket.get(bucket);
      if (!unreads || unreads.size === 0) return undefined;
      return [...unreads].sort(sortFnForBucket)[0];
    },
    [currentBucket, currentViewRooms, unreadByBucket, roomToUnread, sortFnForBucket]
  );

  const lastUnreadInBucket = useCallback(
    (bucket: string): string | undefined => {
      if (bucket === currentBucket && currentViewRooms.length > 0) {
        for (let i = currentViewRooms.length - 1; i >= 0; i -= 1) {
          if (roomToUnread.has(currentViewRooms[i])) return currentViewRooms[i];
        }
      }
      const unreads = unreadByBucket.get(bucket);
      if (!unreads || unreads.size === 0) return undefined;
      const sorted = [...unreads].sort(sortFnForBucket);
      return sorted[sorted.length - 1];
    },
    [currentBucket, currentViewRooms, unreadByBucket, roomToUnread, sortFnForBucket]
  );

  // ── Step within current view first; if exhausted, jump to neighbouring
  //    bucket (in sidebar order). Wraps around the sidebar.
  const stepUnread = useCallback(
    (direction: 1 | -1, predicate: (id: string) => boolean): string | undefined => {
      // 1) Walk current view in display order from the selected room.
      const idx = selectedRoomId ? currentViewRooms.indexOf(selectedRoomId) : -1;
      if (direction === 1) {
        for (let i = idx + 1; i < currentViewRooms.length; i += 1) {
          if (predicate(currentViewRooms[i])) return currentViewRooms[i];
        }
      } else {
        const start = idx === -1 ? currentViewRooms.length : idx;
        for (let i = start - 1; i >= 0; i -= 1) {
          if (predicate(currentViewRooms[i])) return currentViewRooms[i];
        }
      }

      // 2) No more in current view. Walk sidebar buckets.
      const bIdx = sidebarBuckets.indexOf(currentBucket);
      if (bIdx === -1) return undefined;
      const total = sidebarBuckets.length;
      // Visit buckets in order; wrap around past the current bucket.
      for (let step = 1; step <= total; step += 1) {
        const i = (bIdx + direction * step + total * 2) % total;
        const bucket = sidebarBuckets[i];
        const candidate = direction === 1 ? firstUnreadInBucket(bucket) : lastUnreadInBucket(bucket);
        if (candidate && predicate(candidate)) return candidate;
      }

      // 3) Last resort — wrap within current view from the other end.
      if (direction === 1) {
        for (let i = 0; i < currentViewRooms.length; i += 1) {
          if (predicate(currentViewRooms[i])) return currentViewRooms[i];
        }
      } else {
        for (let i = currentViewRooms.length - 1; i >= 0; i -= 1) {
          if (predicate(currentViewRooms[i])) return currentViewRooms[i];
        }
      }
      return undefined;
    },
    [
      selectedRoomId,
      currentViewRooms,
      sidebarBuckets,
      currentBucket,
      firstUnreadInBucket,
      lastUnreadInBucket,
    ]
  );

  const navigateToRoom = useCallback(
    (roomId: string) => {
      const roomIdOrAlias = getCanonicalAliasOrRoomId(mx, roomId);
      const isDirect = mDirects.has(roomId);
      if (isDirect) {
        navigate(getDirectRoomPath(roomIdOrAlias));
        return;
      }
      const parents = roomToParents.get(roomId);
      if (parents && parents.size > 0) {
        const spaceId = Array.from(parents)[0];
        navigate(getSpaceRoomPath(getCanonicalAliasOrRoomId(mx, spaceId), roomIdOrAlias));
        return;
      }
      navigate(getHomeRoomPath(roomIdOrAlias));
    },
    [mx, mDirects, roomToParents, navigate]
  );

  const goPrev = useCallback(
    (predicate: (id: string) => boolean) => {
      const target = stepUnread(-1, predicate);
      if (!target) return;
      setBottomBarDismissed(false);
      navigateToRoom(target);
    },
    [stepUnread, setBottomBarDismissed, navigateToRoom]
  );
  const goNext = useCallback(
    (predicate: (id: string) => boolean) => {
      const target = stepUnread(1, predicate);
      if (!target) return;
      setBottomBarDismissed(false);
      navigateToRoom(target);
    },
    [stepUnread, setBottomBarDismissed, navigateToRoom]
  );

  const isUnread = useCallback(
    (id: string) => (roomToUnread.get(id)?.total ?? 0) > 0,
    [roomToUnread]
  );
  const isMention = useCallback(
    (id: string) => (roomToUnread.get(id)?.highlight ?? 0) > 0,
    [roomToUnread]
  );

  const navigateNext = useCallback(() => goNext(isUnread), [goNext, isUnread]);
  const navigatePrev = useCallback(() => goPrev(isUnread), [goPrev, isUnread]);
  const navigateNextMention = useCallback(() => goNext(isMention), [goNext, isMention]);
  const navigatePrevMention = useCallback(() => goPrev(isMention), [goPrev, isMention]);

  const navigateFirst = useCallback(() => {
    // First overall unread: scan sidebar buckets in order.
    for (const b of sidebarBuckets) {
      const target = firstUnreadInBucket(b);
      if (target) {
        setBottomBarDismissed(false);
        navigateToRoom(target);
        return;
      }
    }
  }, [sidebarBuckets, firstUnreadInBucket, setBottomBarDismissed, navigateToRoom]);

  const unreadCount = useMemo(() => {
    let n = 0;
    for (const set of unreadByBucket.values()) n += set.size;
    return n;
  }, [unreadByBucket]);

  const mentionCount = useMemo(() => {
    let n = 0;
    for (const set of unreadByBucket.values()) {
      for (const id of set) {
        if ((roomToUnread.get(id)?.highlight ?? 0) > 0) n += 1;
      }
    }
    return n;
  }, [unreadByBucket, roomToUnread]);

  return {
    navigateNext,
    navigatePrev,
    navigateNextMention,
    navigatePrevMention,
    navigateFirst,
    unreadCount,
    mentionCount,
  };
}
