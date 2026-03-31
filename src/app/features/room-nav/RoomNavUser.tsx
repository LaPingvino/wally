import { Avatar, Box, Icon, Icons, Text } from 'folds';
import React, { useEffect, useState } from 'react';
import { EventType, Room, RoomStateEvent } from 'matrix-js-sdk';
import { CallMembership } from 'matrix-js-sdk/lib/matrixrtc/CallMembership';
import { NavButton, NavItem, NavItemContent } from '../../components/nav';
import { UserAvatar } from '../../components/user-avatar';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useCallState } from '../../pages/client/call/CallProvider';
import { getMxIdLocalPart } from '../../utils/matrix';
import { getMemberAvatarMxc, getMemberDisplayName } from '../../utils/room';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useOpenUserRoomProfile } from '../../state/hooks/userRoomProfile';
import { useSpaceOptionally } from '../../hooks/useSpace';

type RoomNavUserProps = {
  room: Room;
  callMembership: CallMembership;
};
export function RoomNavUser({ room, callMembership }: RoomNavUserProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const openProfile = useOpenUserRoomProfile();
  const space = useSpaceOptionally();
  const { lkConnected, activeCallRoomId } = useCallState();
  const isActiveCall = lkConnected && activeCallRoomId === room.roomId;
  const userId = callMembership.sender ?? '';
  const isGuest = callMembership.deviceId?.startsWith('GUEST_') ?? false;

  // Re-render when state events update (guest display_name may arrive late)
  const [, setVer] = useState(0);
  useEffect(() => {
    if (!isGuest) return;
    const onState = () => setVer((v) => v + 1);
    room.on(RoomStateEvent.Events, onState);
    return () => { room.off(RoomStateEvent.Events, onState); };
  }, [room, isGuest]);

  let guestName: string | undefined;
  if (isGuest) {
    for (const evt of room.currentState.getStateEvents(EventType.GroupCallMemberPrefix)) {
      const c = evt.getContent<{ device_id?: string; display_name?: string }>();
      if (c.device_id === callMembership.deviceId && c.display_name) {
        guestName = c.display_name;
        break;
      }
    }
  }

  const avatarMxcUrl = isGuest ? undefined : getMemberAvatarMxc(room, userId);
  const avatarUrl = avatarMxcUrl
    ? mx.mxcUrlToHttp(avatarMxcUrl, 32, 32, 'crop', undefined, false, useAuthentication)
    : undefined;
  const getName = isGuest
    ? (guestName ? `${guestName} (Guest)` : `Guest (${callMembership.deviceId?.slice(6, 14) ?? '?'})`)
    : (getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId));
  const isCallParticipant = isActiveCall && userId !== mx.getUserId();

  const handleNavUserClick: React.MouseEventHandler<HTMLButtonElement> = (evt) => {
    openProfile(room.roomId, space?.roomId, userId, evt.currentTarget.getBoundingClientRect());
  };

  const ariaLabel = isCallParticipant ? `Call Participant: ${getName}` : getName;

  return (
    <NavItem variant="Background" radii="400">
      <NavButton onClick={handleNavUserClick} aria-label={ariaLabel}>
        <NavItemContent as="div">
          <Box direction="Column" grow="Yes" gap="200" justifyContent="Stretch">
            <Box alignItems="Center" gap="200">
              <Avatar size="200">
                <UserAvatar
                  userId={userId}
                  src={avatarUrl ?? undefined}
                  alt={getName}
                  renderFallback={() => <Icon size="50" src={Icons.User} filled />}
                />
              </Avatar>
              <Text as="span" size="B400" priority="300" truncate>
                {getName}
              </Text>
            </Box>
          </Box>
        </NavItemContent>
      </NavButton>
    </NavItem>
  );
}
