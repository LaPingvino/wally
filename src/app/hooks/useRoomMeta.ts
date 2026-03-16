import { useEffect, useState } from 'react';
import { RoomJoinRulesEventContent } from 'matrix-js-sdk/lib/types';
import { Room, RoomEvent, RoomEventHandlerMap, RoomMemberEvent } from 'matrix-js-sdk';
import { StateEvent } from '../../types/matrix/room';
import { useStateEvent } from './useStateEvent';

export const useRoomAvatar = (room: Room, dm?: boolean): string | undefined => {
  const avatarEvent = useStateEvent(room, StateEvent.RoomAvatar);
  // For DMs, member profiles come from lazy-loaded members — trigger load and re-render.
  const [, setMemberTick] = useState(0);
  useEffect(() => {
    if (!dm) return;
    let cancelled = false;
    room.loadMembersIfNeeded().then(() => {
      if (!cancelled) setMemberTick((t) => t + 1);
    });
    const onMember = () => { if (!cancelled) setMemberTick((t) => t + 1); };
    room.on(RoomMemberEvent.Membership, onMember);
    room.on(RoomMemberEvent.Name, onMember);
    room.on(RoomMemberEvent.AvatarUrl, onMember);
    return () => {
      cancelled = true;
      room.off(RoomMemberEvent.Membership, onMember);
      room.off(RoomMemberEvent.Name, onMember);
      room.off(RoomMemberEvent.AvatarUrl, onMember);
    };
  }, [room, dm]);

  if (dm) {
    return room.getAvatarFallbackMember()?.getMxcAvatarUrl();
  }
  const content = avatarEvent?.getContent();
  const avatarMxc = content && typeof content.url === 'string' ? content.url : undefined;

  return avatarMxc;
};

export const useRoomName = (room: Room, dm?: boolean): string => {
  const [name, setName] = useState(room.name);

  useEffect(() => {
    setName(room.name);

    const handleRoomNameChange: RoomEventHandlerMap[RoomEvent.Name] = () => {
      setName(room.name);
    };
    room.on(RoomEvent.Name, handleRoomNameChange);
    return () => {
      room.removeListener(RoomEvent.Name, handleRoomNameChange);
    };
  }, [room]);

  // For DMs: member display names aren't available until members are loaded.
  // Force a name re-read after loadMembersIfNeeded() resolves, since the SDK
  // doesn't always emit RoomEvent.Name after a lazy member load.
  useEffect(() => {
    if (!dm) return;
    let cancelled = false;
    room.loadMembersIfNeeded().then(() => {
      if (!cancelled) setName(room.name);
    });
    return () => { cancelled = true; };
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
