import { useEffect, useState } from 'react';
import { RoomJoinRulesEventContent } from 'matrix-js-sdk/lib/types';
import { Room, RoomEvent, RoomEventHandlerMap, RoomStateEvent } from 'matrix-js-sdk';
import { StateEvent } from '../../types/matrix/room';
import { useStateEvent } from './useStateEvent';
import { dmRealHumans } from '../utils/matrix';

// Load a DM's members so its partner resolves for name + avatar. ALWAYS force a
// full /members fetch — not only under sliding sync. loadMembersIfNeeded() returns
// early once the lazy roster is "loaded", which is true even when only the
// heroes/recent senders are present (sliding sync leaves it at $LAZY; classic lazy
// loading leaves a partner who hasn't spoken recently out). Either way the DM
// partner is missing and the name/avatar fall back to the mxid ("the other side
// seems missing"). forceLoadMembers (fork) hits /members regardless and caches, so
// repeat calls are cheap. Cast because the published .d.ts lags the method.
// One in-flight /members fetch per room, SHARED across hooks (name + avatar) and
// re-renders. Without this every DM row fired forceLoadMembers twice on every
// render — a request storm that left the top rows resolving late ("names resolve
// on scroll"). Cleared on failure so it can retry.
const memberLoads = new Map<string, Promise<unknown>>();
const loadDmMembers = (room: Room): Promise<unknown> => {
  const cached = memberLoads.get(room.roomId);
  if (cached) return cached;
  const forceable = room as unknown as { forceLoadMembers?: () => Promise<unknown> };
  const p = forceable.forceLoadMembers ? forceable.forceLoadMembers() : room.loadMembersIfNeeded();
  memberLoads.set(room.roomId, p);
  p.catch(() => memberLoads.delete(room.roomId));
  return p;
};

export const useRoomAvatar = (room: Room, dm?: boolean): string | undefined => {
  const avatarEvent = useStateEvent(room, StateEvent.RoomAvatar);
  // For DMs, member profiles come from lazy-loaded members — trigger load and re-render.
  const [, setMemberTick] = useState(0);
  useEffect(() => {
    if (!dm) return;
    let cancelled = false;
    let rafId: number | null = null;
    // Debounce via rAF: many member state events may fire in one batch (e.g. large group
    // incorrectly marked as DM), so coalesce into a single setState per frame.
    const onMember = () => {
      if (cancelled) return;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (!cancelled) setMemberTick((t) => t + 1);
      });
    };
    // Refresh DIRECTLY when the load completes (not via the rAF, which a re-render
    // can cancel before it fires — that left top rows stuck until a scroll remount).
    loadDmMembers(room).then(() => { if (!cancelled) setMemberTick((t) => t + 1); }).catch(() => {});
    room.on(RoomStateEvent.Members, onMember);
    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      room.off(RoomStateEvent.Members, onMember);
    };
  }, [room, dm]);

  if (dm) {
    return room.getAvatarFallbackMember()?.getMxcAvatarUrl();
  }
  const content = avatarEvent?.getContent();
  const avatarMxc = content && typeof content.url === 'string' ? content.url : undefined;

  return avatarMxc;
};

/**
 * Display name for a DM room directly from members, bypassing room.name.
 *
 * Why bypass room.name: for DMs the SDK's room.name can read badly — it can
 * include YOU ("me, other") and bridge bots (e.g. the mautrix-whatsapp bot), and
 * it isn't always recalculated after lazy member load. getAvatarFallbackMember()
 * instead returns the single OTHER real person: it filters out functional
 * members (bridge bots) and PREFERS the sliding-sync heroes summary, so it
 * resolves the right name even when m.room.member events aren't loaded yet
 * (members can be 0 under sliding sync). So we trust it as-is — even when the
 * hero has no displayname (its .name is then the mxid, which is still the right
 * person), do NOT fall back to room.name there or the bad "me, other + bot" name
 * comes back (regression we hit, restored here).
 */
const getDmName = (room: Room): string => {
  // A DM name should only override room.name when the room is genuinely a 1:1 —
  // and we can only KNOW that once the full member roster is loaded. At first paint
  // a group's roster is only partial: the m.direct "partner" is known but the other
  // members aren't, so dmRealHumans() reads 1 and the title wrongly resolves to that
  // partner ("Gustavo") BEFORE enough members load to reveal it's a group (the
  // "resolves too early" bug). So: until the joined roster is fully loaded (loaded
  // count >= the summary's joined count), AND whenever more than one real human is
  // present (bots / your puppet / your alts excluded), trust the room's own name.
  // The member-load effect re-runs this once /members lands.
  const fullyLoaded = room.getJoinedMembers().length >= room.getJoinedMemberCount();
  if (!fullyLoaded || dmRealHumans(room.client, room).length > 1) return room.name;

  // For 2-person DMs getAvatarFallbackMember() gives the other member directly.
  const fallbackMember = room.getAvatarFallbackMember();
  if (fallbackMember) return fallbackMember.name;

  // Group DMs: compute name from other joined/invited members (room.name won't be recalculated).
  const others = room
    .getMembers()
    .filter((m) => m.userId !== room.myUserId && (m.membership === 'join' || m.membership === 'invite'));

  if (others.length === 0) return room.name;
  if (others.length === 1) return others[0].name;
  if (others.length === 2) return `${others[0].name} and ${others[1].name}`;
  return `${others[0].name} and ${others.length - 1} others`;
};

export const useRoomName = (room: Room, dm?: boolean): string => {
  const [name, setName] = useState(() => (dm ? getDmName(room) : room.name));

  useEffect(() => {
    if (dm) {
      setName(getDmName(room));
    } else {
      setName(room.name);
    }

    const handleRoomNameChange: RoomEventHandlerMap[RoomEvent.Name] = () => {
      setName(dm ? getDmName(room) : room.name);
    };
    room.on(RoomEvent.Name, handleRoomNameChange);
    return () => {
      room.removeListener(RoomEvent.Name, handleRoomNameChange);
    };
  }, [room, dm]);

  // For DMs: members are lazy-loaded. After load, read name directly from the
  // member object since room.name may not be recalculated by the SDK.
  useEffect(() => {
    if (!dm) return;
    let cancelled = false;
    let rafId: number | null = null;
    // Debounce via rAF: many member state events may fire in one batch (e.g. large group
    // incorrectly marked as DM), so coalesce into a single getDmName call per frame.
    const onMember = () => {
      if (cancelled) return;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (!cancelled) setName(getDmName(room));
      });
    };
    // Refresh DIRECTLY when the load completes (not via the rAF, which a re-render
    // can cancel before it fires — that left top rows stuck until a scroll remount).
    loadDmMembers(room).then(() => { if (!cancelled) setName(getDmName(room)); }).catch(() => {});
    room.on(RoomStateEvent.Members, onMember);
    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      room.off(RoomStateEvent.Members, onMember);
    };
  }, [room, dm]);

  return name;
};

export const useRoomTopic = (room: Room): string | undefined => {
  const topicEvent = useStateEvent(room, StateEvent.RoomTopic);

  const content = topicEvent?.getContent();
  const topic = content && typeof content.topic === 'string' ? content.topic : undefined;

  return topic;
};

export const useRoomJoinRule = (room: Room): RoomJoinRulesEventContent | undefined => {
  const mEvent = useStateEvent(room, StateEvent.RoomJoinRules);
  const joinRuleContent = mEvent?.getContent<RoomJoinRulesEventContent>();
  return joinRuleContent;
};
