import React, { useCallback, useMemo } from 'react';
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
  getDirectPath,
  getDirectRoomPath,
  getHomePath,
  getHomeRoomPath,
  getSpacePath,
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

/**
 * Pending cross-bucket jump.
 *
 * Set by useNavigateUnread when the user steps off the end of the current
 * view's unreads — we navigate to the next/prev bucket's URL but can't
 * pick the actual room to land in here, because the destination view's
 * sorted room list isn't available until that page mounts and renders.
 *
 * Pages that own a bucket's room list (Home, Direct, Space) call
 * usePendingBucketJump(bucket, sortedRoomIds) which watches this atom
 * and, on a match, navigates to first or last room and clears it.
 */
export const pendingBucketJumpAtom = atom<{ bucket: string; edge: 'first' | 'last' } | null>(null);

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

  // ── Per-bucket FULL room sets (not just unreads). Used by the
  //    cross-space jump: when we step out of the current view we land on
  //    the first/last ROOM in the next bucket, even if it's read. The
  //    user can then walk unreads within that bucket from there. This is
  //    simpler and more predictable than trying to compute "first unread"
  //    for buckets whose display order we don't know at hook time.
  const allRoomsByBucket = useMemo((): Map<string, string[]> => {
    const sidebarSet = new Set(getSidebarSpaceIds(mx));
    const homeOrphanSet = new Set(homeRooms);
    const directSet = new Set(directRooms);
    const buckets = new Map<string, string[]>();
    for (const b of sidebarBuckets) buckets.set(b, []);

    // We need to enumerate every joined room. Use the union of the lists
    // we already pulled (homeRooms ∪ directRooms ∪ rooms with parents).
    const allIds = new Set<string>([...homeRooms, ...directRooms]);
    for (const id of roomToParents.keys()) allIds.add(id);
    // Also include unread rooms (covers the rare case where a room is in
    // a sidebar space but somehow missing from the above sets).
    for (const id of roomToUnread.keys()) allIds.add(id);

    for (const id of allIds) {
      const room = mx.getRoom(id);
      if (!room || room.isSpaceRoom()) continue;

      let bucket: string | undefined;
      if (directSet.has(id)) bucket = DIRECT_BUCKET;
      else if (homeOrphanSet.has(id)) bucket = HOME_BUCKET;
      else bucket = findSidebarSpaceForRoom(id, roomToParents, sidebarSet);

      if (bucket && buckets.has(bucket)) buckets.get(bucket)!.push(id);
    }

    // Sort each bucket with the current sort order.
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
    for (const ids of buckets.values()) ids.sort(sortFn);

    return buckets;
  }, [
    mx,
    sidebarBuckets,
    roomToUnread,
    roomToParents,
    homeRooms,
    directRooms,
    roomSortOrder,
  ]);

  /** First room (any read state) in a bucket, in the bucket's sort order. */
  const firstRoomInBucket = useCallback(
    (bucket: string): string | undefined => {
      if (bucket === currentBucket && currentViewRooms.length > 0) return currentViewRooms[0];
      const ids = allRoomsByBucket.get(bucket);
      return ids && ids.length > 0 ? ids[0] : undefined;
    },
    [currentBucket, currentViewRooms, allRoomsByBucket]
  );

  /** Last room (any read state) in a bucket, in the bucket's sort order. */
  const lastRoomInBucket = useCallback(
    (bucket: string): string | undefined => {
      if (bucket === currentBucket && currentViewRooms.length > 0)
        return currentViewRooms[currentViewRooms.length - 1];
      const ids = allRoomsByBucket.get(bucket);
      return ids && ids.length > 0 ? ids[ids.length - 1] : undefined;
    },
    [currentBucket, currentViewRooms, allRoomsByBucket]
  );

  /** Does this bucket contain at least one unread room? */
  const bucketHasUnread = useCallback(
    (bucket: string): boolean => {
      const ids = allRoomsByBucket.get(bucket);
      if (!ids) return false;
      for (const id of ids) if (roomToUnread.has(id)) return true;
      return false;
    },
    [allRoomsByBucket, roomToUnread]
  );

  const setPendingBucketJump = useAtom(pendingBucketJumpAtom)[1];

  /**
   * Step within current view first. If exhausted, find next/prev bucket
   * with unreads, navigate to its URL, and store a pending-jump request
   * so the destination view (once mounted with its sorted room list)
   * picks first/last room. Returns:
   *   - a roomId to navigate to within the current view (caller routes)
   *   - or null when we've delegated to a cross-bucket jump (caller
   *     should not navigate further; we already did)
   *   - or undefined if we have nothing to do.
   */
  const stepUnread = useCallback(
    (direction: 1 | -1, predicate: (id: string) => boolean): string | null | undefined => {
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

      // 2) No more in current view. Find next/prev bucket WITH unreads.
      const bIdx = sidebarBuckets.indexOf(currentBucket);
      if (bIdx !== -1) {
        const total = sidebarBuckets.length;
        for (let step = 1; step <= total; step += 1) {
          const i = (bIdx + direction * step + total * 2) % total;
          const bucket = sidebarBuckets[i];
          if (bucket === currentBucket) continue;
          if (!bucketHasUnread(bucket)) continue;

          // Navigate to the bucket's URL; the destination view will land
          // on first/last room once its sorted list is ready.
          const edge: 'first' | 'last' = direction === 1 ? 'first' : 'last';
          setPendingBucketJump({ bucket, edge });
          if (bucket === HOME_BUCKET) {
            navigate(getHomePath());
          } else if (bucket === DIRECT_BUCKET) {
            navigate(getDirectPath());
          } else {
            navigate(getSpacePath(getCanonicalAliasOrRoomId(mx, bucket)));
          }
          setBottomBarDismissed(false);
          return null;
        }
      }

      // 3) Last resort — no other bucket has unreads. Wrap within current
      //    view from the other end.
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
      bucketHasUnread,
      setPendingBucketJump,
      navigate,
      mx,
      setBottomBarDismissed,
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
      // null = cross-bucket jump already navigated; nothing more to do.
      if (target === null) return;
      if (!target) return;
      setBottomBarDismissed(false);
      navigateToRoom(target);
    },
    [stepUnread, setBottomBarDismissed, navigateToRoom]
  );
  const goNext = useCallback(
    (predicate: (id: string) => boolean) => {
      const target = stepUnread(1, predicate);
      if (target === null) return;
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
      const ids = allRoomsByBucket.get(b);
      if (!ids) continue;
      for (const id of ids) {
        if (roomToUnread.has(id)) {
          setBottomBarDismissed(false);
          navigateToRoom(id);
          return;
        }
      }
    }
  }, [sidebarBuckets, allRoomsByBucket, roomToUnread, setBottomBarDismissed, navigateToRoom]);

  const unreadCount = useMemo(() => {
    let n = 0;
    for (const ids of allRoomsByBucket.values()) {
      for (const id of ids) {
        if ((roomToUnread.get(id)?.total ?? 0) > 0) n += 1;
      }
    }
    return n;
  }, [allRoomsByBucket, roomToUnread]);

  const mentionCount = useMemo(() => {
    let n = 0;
    for (const ids of allRoomsByBucket.values()) {
      for (const id of ids) {
        if ((roomToUnread.get(id)?.highlight ?? 0) > 0) n += 1;
      }
    }
    return n;
  }, [allRoomsByBucket, roomToUnread]);

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

/**
 * Drains the pending-bucket-jump request: when the destination view's
 * sorted room list is ready and matches the pending bucket, navigate to
 * its first or last room and clear the atom.
 *
 * Call from each page that owns a bucket's room list. `bucket` is the
 * bucket sentinel for this page (HOME_BUCKET / DIRECT_BUCKET / spaceId).
 */
export function usePendingBucketJump(
  bucket: string,
  sortedRoomIds: string[],
  navigateRoom: (roomId: string) => void
): void {
  const [pending, setPending] = useAtom(pendingBucketJumpAtom);
  // Stable refs so the effect can fire when sortedRoomIds becomes ready
  // without retriggering when navigateRoom identity changes.
  React.useEffect(() => {
    if (!pending) return;
    if (pending.bucket !== bucket) return;
    if (sortedRoomIds.length === 0) return;
    const target =
      pending.edge === 'first' ? sortedRoomIds[0] : sortedRoomIds[sortedRoomIds.length - 1];
    setPending(null);
    navigateRoom(target);
  }, [pending, bucket, sortedRoomIds, navigateRoom, setPending]);
}

/** Sentinel bucket IDs exported so page components can pass them in. */
export const NAV_HOME_BUCKET = HOME_BUCKET;
export const NAV_DIRECT_BUCKET = DIRECT_BUCKET;
