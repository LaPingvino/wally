import { as, Avatar, Box, Icon, Icons, Text } from 'folds';
import React, { useEffect, useState } from 'react';
import classNames from 'classnames';
import { EventType, Room, RoomStateEvent } from 'matrix-js-sdk';
import { CallMembership } from 'matrix-js-sdk/lib/matrixrtc/CallMembership';
import { UserAvatar } from '../../components/user-avatar';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getMxIdLocalPart } from '../../utils/matrix';
import { getMemberAvatarMxc, getMemberDisplayName } from '../../utils/room';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useOpenUserRoomProfile } from '../../state/hooks/userRoomProfile';
import { useSpaceOptionally } from '../../hooks/useSpace';
import * as css from './CallView.css';

type CallViewUserProps = {
  room: Room;
  callMembership: CallMembership;
};

export const UserProfileButton = as<'button'>(
  ({ as: AsUserProfileButton = 'button', className, ...props }, ref) => (
    <AsUserProfileButton className={classNames(css.UserLink, className)} {...props} ref={ref} />
  )
);

export const CallViewUserBase = as<'div'>(({ className, ...props }, ref) => (
  <Box
    direction="Column"
    gap="300"
    className={classNames(css.CallViewUser, className)}
    {...props}
    ref={ref}
  />
));

export function CallViewUser({ room, callMembership }: CallViewUserProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const openProfile = useOpenUserRoomProfile();
  const space = useSpaceOptionally();
  const userId = callMembership.sender ?? '';

  // Guests have device_id starting with GUEST_ and display_name in the event content.
  // Re-render when state events change so we pick up display_name after it syncs.
  const isGuest = callMembership.deviceId?.startsWith('GUEST_') ?? false;
  const [, setStateVersion] = useState(0);
  useEffect(() => {
    if (!isGuest) return;
    const onState = () => setStateVersion((v) => v + 1);
    room.on(RoomStateEvent.Events, onState);
    return () => { room.off(RoomStateEvent.Events, onState); };
  }, [room, isGuest]);

  let guestDisplayName: string | undefined;
  if (isGuest) {
    const allCallMembers = room.currentState.getStateEvents(EventType.GroupCallMemberPrefix);
    for (const evt of allCallMembers) {
      const content = evt.getContent<{ device_id?: string; display_name?: string }>();
      if (content.device_id === callMembership.deviceId && content.display_name) {
        guestDisplayName = content.display_name;
        break;
      }
    }
  }

  const avatarMxcUrl = isGuest ? undefined : getMemberAvatarMxc(room, userId);
  const avatarUrl = avatarMxcUrl
    ? mx.mxcUrlToHttp(avatarMxcUrl, 32, 32, 'crop', undefined, false, useAuthentication)
    : undefined;
  const getName = isGuest && guestDisplayName
    ? `${guestDisplayName} (Guest)`
    : (getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId));

  const handleUserClick: React.MouseEventHandler<HTMLButtonElement> = (evt) => {
    openProfile(room.roomId, space?.roomId, userId, evt.currentTarget.getBoundingClientRect());
  };

  return (
    <UserProfileButton onClick={handleUserClick} aria-label={getName}>
      <CallViewUserBase>
        <Box direction="Column" grow="Yes" alignItems="Center" gap="200" justifyContent="Center">
          <Avatar size="200">
            <UserAvatar
              userId={userId}
              src={avatarUrl ?? undefined}
              alt={getName}
              renderFallback={() => <Icon size="50" src={Icons.User} filled />}
            />
          </Avatar>
          <Text size="B400" priority="300" truncate>
            {getName}
          </Text>
        </Box>
      </CallViewUserBase>
    </UserProfileButton>
  );
}
