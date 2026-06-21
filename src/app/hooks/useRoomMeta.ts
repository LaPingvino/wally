import { useEffect, useState } from 'react';
import { RoomJoinRulesEventContent } from 'matrix-js-sdk/lib/types';
import { Room, RoomEvent, RoomEventHandlerMap } from 'matrix-js-sdk';
import { StateEvent } from '../../types/matrix/room';
import { useStateEvent } from './useStateEvent';

// Both the DM name and avatar come straight from the SDK now. Wally used to
// compute them client-side (getDmName + a forced /members load) because the SDK's
// room.name/fallback member resolved late and could include YOU + bridge bots.
// With the SDK naming DMs correctly from the heroes summary, that machinery only
// fought it — the right value flashed in, then "popped" to the stale computed one.
// The heroes summary that fixes the name also populates getAvatarFallbackMember(),
// so the avatar resolves from the same source with no manual member load.
export const useRoomAvatar = (room: Room, dm?: boolean): string | undefined => {
  const avatarEvent = useStateEvent(room, StateEvent.RoomAvatar);
  const content = avatarEvent?.getContent();
  const avatarMxc = content && typeof content.url === 'string' ? content.url : undefined;

  if (dm) {
    // An explicit room avatar (e.g. a bridge-set channel photo) wins over the
    // DM-partner fallback. Without this, a WhatsApp broadcast channel — which the
    // bridge maps into m.direct but whose only other "member" is your own ghost —
    // resolves to YOUR face instead of the channel photo. See getDirectRoomAvatarUrl.
    return avatarMxc ?? room.getAvatarFallbackMember()?.getMxcAvatarUrl();
  }

  return avatarMxc;
};

export const useRoomName = (room: Room): string => {
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
