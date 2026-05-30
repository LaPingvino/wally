import { useEffect, useState } from 'react';
import { RoomJoinRulesEventContent } from 'matrix-js-sdk/lib/types';
import { Room, RoomEvent, RoomEventHandlerMap, RoomStateEvent } from 'matrix-js-sdk';
import { StateEvent } from '../../types/matrix/room';
import { useStateEvent } from './useStateEvent';

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
    room.loadMembersIfNeeded().then(() => { onMember(); });
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
 * Display name for a DM room, preferring a loaded member's real display name but
 * falling back to the SDK's room.name (which resolves DM names from the
 * sliding-sync heroes summary) when members aren't loaded yet.
 *
 * History: this member-based path was a workaround for an OLDER SDK that didn't
 * recalculate room.name for DMs after lazy member load — it relied on full sync
 * having every member present. Under sliding sync the members are MISSING until
 * inflation, so a bare membership stub (no displayname → `name` is just the
 * mxid) would override a perfectly good hero-based room.name with an mxid. We
 * therefore only trust a member when it actually has a `rawDisplayName`; for
 * everything else room.name is the reliable source now that the SDK equalizes it.
 */
const getDmName = (room: Room): string => {
  // For 2-person DMs getAvatarFallbackMember() gives the other member directly.
  const fallbackMember = room.getAvatarFallbackMember();
  if (fallbackMember?.rawDisplayName) return fallbackMember.name;

  // Group DMs: compute name from other members that have a real display name.
  const others = room
    .getMembers()
    .filter((m) => m.userId !== room.myUserId && (m.membership === 'join' || m.membership === 'invite'))
    .filter((m) => m.rawDisplayName);

  if (others.length === 0) return room.name; // not loaded yet → trust heroes
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
    room.loadMembersIfNeeded().then(() => { onMember(); });
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
