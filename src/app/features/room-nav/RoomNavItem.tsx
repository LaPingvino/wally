import React, { MouseEventHandler, forwardRef, useState, MouseEvent } from 'react';
import { useAtom } from 'jotai';
import { EventType, JoinRule, Room } from 'matrix-js-sdk';
import {
  Avatar,
  Box,
  Icon,
  IconButton,
  Icons,
  Text,
  Menu,
  MenuItem,
  config,
  PopOut,
  toRem,
  Line,
  RectCords,
  Badge,
  Spinner,
  Tooltip,
  TooltipProvider,
} from 'folds';
import { useFocusWithin, useHover } from 'react-aria';
import FocusTrap from 'focus-trap-react';
import { useNavigate } from 'react-router-dom';
import { NavButton, NavItem, NavItemContent, NavItemOptions } from '../../components/nav';
import { UnreadBadge, UnreadBadgeCenter } from '../../components/unread-badge';
import { RoomAvatar, RoomIcon } from '../../components/room-avatar';
import { getDirectRoomAvatarUrl, getRoomAvatarUrl, getStateEvent } from '../../utils/room';
import { nameInitials } from '../../utils/common';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomUnread } from '../../state/hooks/unread';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { getPowersLevelFromMatrixEvent, usePowerLevels } from '../../hooks/usePowerLevels';
import { copyToClipboard } from '../../utils/dom';
import { markAsRead } from '../../utils/notifications';
import { UseStateProvider } from '../../components/UseStateProvider';
import { LeaveRoomPrompt } from '../../components/leave-room-prompt';
import { useRoomTypingMember } from '../../hooks/useRoomTypingMembers';
import { TypingIndicator } from '../../components/typing-indicator';
import { stopPropagation } from '../../utils/keyboard';
import { getMatrixToRoom } from '../../plugins/matrix-to';
import { getCanonicalAliasOrRoomId, isRoomAlias } from '../../utils/matrix';
import { getViaServers } from '../../plugins/via-servers';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { useOpenRoomSettings } from '../../state/hooks/roomSettings';
import { useSpaceOptionally } from '../../hooks/useSpace';
import { useCallState } from '../../pages/client/call/CallProvider';
import { callChatAtom } from '../../state/callEmbed';
import { useCallMembers } from '../../hooks/useCallMemberships';
import { useRoomName } from '../../hooks/useRoomMeta';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { RoomNavUser } from './RoomNavUser';
import {
  getRoomNotificationModeIcon,
  RoomNotificationMode,
} from '../../hooks/useRoomsNotificationPreferences';
import { RoomNotificationModeSwitcher } from '../../components/RoomNotificationSwitcher';
import {
  useRoomNoticeInboxOnly,
  useSetRoomNoticeInboxOnly,
} from '../../state/room/noticeMode';
import { getRoomCreatorsForRoomId, useRoomCreators } from '../../hooks/useRoomCreators';
import { getRoomPermissionsAPI, useRoomPermissions } from '../../hooks/useRoomPermissions';
import { InviteUserPrompt } from '../../components/invite-user-prompt';
import { StateEvent } from '../../../types/matrix/room';

type RoomNavItemMenuProps = {
  room: Room;
  requestClose: () => void;
  notificationMode?: RoomNotificationMode;
};
const RoomNavItemMenu = forwardRef<HTMLDivElement, RoomNavItemMenuProps>(
  ({ room, requestClose, notificationMode }, ref) => {
    const mx = useMatrixClient();
    const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
    const unread = useRoomUnread(room.roomId, roomToUnreadAtom);
    const powerLevels = usePowerLevels(room);
    const creators = useRoomCreators(room);

    const permissions = useRoomPermissions(creators, powerLevels);
    const canInvite = permissions.action('invite', mx.getSafeUserId());
    const openRoomSettings = useOpenRoomSettings();
    const space = useSpaceOptionally();

    const [invitePrompt, setInvitePrompt] = useState(false);

    const handleMarkAsRead = () => {
      markAsRead(mx, room.roomId, hideActivity);
      requestClose();
    };

    const noticeInboxOnly = useRoomNoticeInboxOnly(room);
    const setNoticeInboxOnly = useSetRoomNoticeInboxOnly(mx, room.roomId);
    const handleToggleNoticeInboxOnly = () => {
      void setNoticeInboxOnly(!noticeInboxOnly);
    };

    const handleInvite = () => {
      setInvitePrompt(true);
    };

    const handleCopyLink = () => {
      const roomIdOrAlias = getCanonicalAliasOrRoomId(mx, room.roomId);
      const viaServers = isRoomAlias(roomIdOrAlias) ? undefined : getViaServers(room);
      copyToClipboard(getMatrixToRoom(roomIdOrAlias, viaServers));
      requestClose();
    };

    const handleRoomSettings = () => {
      openRoomSettings(room.roomId, space?.roomId);
      requestClose();
    };

    const isFavorite = !!room.tags['m.favourite'];
    const handleToggleFavorite = () => {
      if (isFavorite) {
        mx.deleteRoomTag(room.roomId, 'm.favourite');
      } else {
        mx.setRoomTag(room.roomId, 'm.favourite', { order: 0.5 });
      }
      requestClose();
    };

    return (
      <Menu ref={ref} style={{ maxWidth: toRem(160), width: '100vw' }}>
        {invitePrompt && room && (
          <InviteUserPrompt
            room={room}
            requestClose={() => {
              setInvitePrompt(false);
              requestClose();
            }}
          />
        )}
        <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
          <MenuItem
            onClick={handleMarkAsRead}
            size="300"
            after={<Icon size="100" src={Icons.CheckTwice} />}
            radii="300"
            disabled={!unread}
          >
            <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
              Mark as Read
            </Text>
          </MenuItem>
          <RoomNotificationModeSwitcher roomId={room.roomId} value={notificationMode}>
            {(handleOpen, opened, changing) => (
              <MenuItem
                size="300"
                after={
                  changing ? (
                    <Spinner size="100" variant="Secondary" />
                  ) : (
                    <Icon size="100" src={getRoomNotificationModeIcon(notificationMode)} />
                  )
                }
                radii="300"
                aria-pressed={opened}
                onClick={handleOpen}
              >
                <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                  Notifications
                </Text>
              </MenuItem>
            )}
          </RoomNotificationModeSwitcher>
          <MenuItem
            onClick={handleToggleNoticeInboxOnly}
            size="300"
            after={<Icon size="100" src={Icons.Info} filled={noticeInboxOnly} />}
            radii="300"
            aria-pressed={noticeInboxOnly}
            title={
              noticeInboxOnly
                ? 'Notices from this room appear only in the Notices inbox'
                : 'Notices from this room appear inline in the timeline'
            }
          >
            <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
              {noticeInboxOnly ? 'Show notices inline' : 'Notices to inbox only'}
            </Text>
          </MenuItem>
          <MenuItem
            onClick={handleToggleFavorite}
            size="300"
            after={<Icon size="100" src={Icons.Star} filled={isFavorite} />}
            radii="300"
          >
            <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
              {isFavorite ? 'Unfavorite' : 'Favorite'}
            </Text>
          </MenuItem>
        </Box>
        <Line variant="Surface" size="300" />
        <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
          <MenuItem
            onClick={handleInvite}
            variant="Primary"
            fill="None"
            size="300"
            after={<Icon size="100" src={Icons.UserPlus} />}
            radii="300"
            aria-pressed={invitePrompt}
            disabled={!canInvite}
          >
            <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
              Invite
            </Text>
          </MenuItem>
          <MenuItem
            onClick={handleCopyLink}
            size="300"
            after={<Icon size="100" src={Icons.Link} />}
            radii="300"
          >
            <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
              Copy Link
            </Text>
          </MenuItem>
          <MenuItem
            onClick={handleRoomSettings}
            size="300"
            after={<Icon size="100" src={Icons.Setting} />}
            radii="300"
          >
            <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
              Room Settings
            </Text>
          </MenuItem>
        </Box>
        <Line variant="Surface" size="300" />
        <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
          <UseStateProvider initial={false}>
            {(promptLeave, setPromptLeave) => (
              <>
                <MenuItem
                  onClick={() => setPromptLeave(true)}
                  variant="Critical"
                  fill="None"
                  size="300"
                  after={<Icon size="100" src={Icons.ArrowGoLeft} />}
                  radii="300"
                  aria-pressed={promptLeave}
                >
                  <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                    Leave Room
                  </Text>
                </MenuItem>
                {promptLeave && (
                  <LeaveRoomPrompt
                    roomId={room.roomId}
                    onDone={requestClose}
                    onCancel={() => setPromptLeave(false)}
                  />
                )}
              </>
            )}
          </UseStateProvider>
        </Box>
      </Menu>
    );
  }
);
RoomNavItemMenu.displayName = 'RoomNavItemMenu';

function CallChatToggle() {
  const [chat, setChat] = useAtom(callChatAtom);

  return (
    <IconButton
      onClick={() => setChat(!chat)}
      aria-pressed={chat}
      aria-label="Toggle Chat"
      variant="Background"
      fill="None"
      size="300"
      radii="300"
    >
      <Icon size="50" src={Icons.Message} filled={chat} />
    </IconButton>
  );
}

type RoomNavItemProps = {
  room: Room;
  selected: boolean;
  linkPath: string;
  notificationMode?: RoomNotificationMode;
  showAvatar?: boolean;
  direct?: boolean;
  focused?: boolean;
  optionId?: string;
  tabIndex?: number;
};
export function RoomNavItem({
  room,
  selected,
  showAvatar,
  direct,
  notificationMode,
  linkPath,
  focused,
  optionId,
  tabIndex,
}: RoomNavItemProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const [hover, setHover] = useState(false);
  const { hoverProps } = useHover({ onHoverChange: setHover });
  const { focusWithinProps } = useFocusWithin({ onFocusWithinChange: setHover });
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const unread = useRoomUnread(room.roomId, roomToUnreadAtom);
  const typingMember = useRoomTypingMember(room.roomId).filter(
    (receipt) => receipt.userId !== mx.getUserId()
  );

  const {
    activeCallRoomId,
    setActiveCallRoomId,
    setViewedCallRoomId,
    isChatOpen,
    toggleChat,
    hangUp,
  } = useCallState();

  // isActiveCall: true as soon as this room is set as active call (including while connecting)
  const isActiveCall = activeCallRoomId === room.roomId;
  const callMemberships = useCallMembers(mx, room.roomId);

  const powerLevels = usePowerLevels(room);
  const creators = useRoomCreators(room);
  const roomName = useRoomName(room, direct);

  const permissions = useRoomPermissions(creators, powerLevels);
  const canJoinCall = permissions.event(EventType.GroupCallMemberPrefix, mx.getSafeUserId());

  const { navigateRoom } = useRoomNavigate();
  const navigate = useNavigate();
  const ariaLabel = [
    roomName,
    room.isCallRoom()
      ? [
          'Call Room',
          isActiveCall && 'Currently in Call',
          callMemberships.length && `${callMemberships.length} in Call`,
        ]
      : direct
        ? 'Direct Message'
        : room.getJoinRule() === JoinRule.Public
          ? 'Public Room'
          : 'Group Room',
    unread?.total && `${unread.total} Messages`,
  ]
    .flat()
    .filter(Boolean)
    .join(', ');

  const handleContextMenu: MouseEventHandler<HTMLElement> = (evt) => {
    evt.preventDefault();
    setMenuAnchor({
      x: evt.clientX,
      y: evt.clientY,
      width: 0,
      height: 0,
    });
  };

  const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setMenuAnchor(evt.currentTarget.getBoundingClientRect());
  };

  // Navigate to the room; for voice rooms also activate the call so the
  // call panel opens. Room.tsx's auto-join effect handles the actual join.
  const handleNavItemClick: MouseEventHandler<HTMLElement> = () => {
    if (room.isCallRoom() && activeCallRoomId !== room.roomId) {
      hangUp();
      setActiveCallRoomId(room.roomId, true);
    }
    navigate(linkPath);
  };

  // Open chat panel for voice rooms — NOT the call lobby.
  // isVoiceRoom=false so setActiveCallRoomId sets isCallViewOpen=false + isChatOpen=true.
  const handleChatButtonClick = (evt: MouseEvent<HTMLButtonElement>) => {
    evt.stopPropagation();
    if (activeCallRoomId !== room.roomId) {
      hangUp();
      setActiveCallRoomId(room.roomId, false);
    } else if (!isChatOpen) {
      toggleChat();
    }
    setViewedCallRoomId(room.roomId);
    navigate(linkPath);
  };

  // Join the call for a voice room and navigate to it so the call panel opens
  const handleCallButtonClick = (evt: MouseEvent<HTMLButtonElement>) => {
    evt.stopPropagation();
    if (activeCallRoomId !== room.roomId) {
      hangUp();
      setActiveCallRoomId(room.roomId, true);
    }
    navigateRoom(room.roomId);
  };

  const optionsVisible = hover || !!menuAnchor;

  return (
    <Box direction="Column" grow="Yes">
      <NavItem
        variant="Background"
        radii="400"
        highlight={unread !== undefined}
        aria-selected={selected}
        role="option"
        id={optionId}
        data-hover={!!menuAnchor}
        onContextMenu={handleContextMenu}
        {...hoverProps}
        {...focusWithinProps}
      >
        <NavButton onClick={handleNavItemClick} aria-label={ariaLabel} tabIndex={tabIndex ?? -1}>
          <NavItemContent>
            <Box as="span" grow="Yes" alignItems="Center" gap="200">
              <Avatar size="200" radii="400">
                {showAvatar ? (
                  <RoomAvatar
                    roomId={room.roomId}
                    src={
                      direct
                        ? getDirectRoomAvatarUrl(mx, room, 96, useAuthentication)
                        : getRoomAvatarUrl(mx, room, 96, useAuthentication)
                    }
                    alt={roomName}
                    renderFallback={() => (
                      <Text as="span" size="H6">
                        {nameInitials(roomName)}
                      </Text>
                    )}
                  />
                ) : (
                  <RoomIcon
                    style={{
                      opacity: unread || isActiveCall ? config.opacity.P500 : config.opacity.P300,
                    }}
                    filled={selected || isActiveCall}
                    size="100"
                    joinRule={room.getJoinRule()}
                    roomType={room.getType()}
                    locked={room.isCallRoom() && !canJoinCall}
                  />
                )}
              </Avatar>
              <Box as="span" grow="Yes">
                <Text
                  priority={unread || isActiveCall ? '500' : '300'}
                  as="span"
                  size="Inherit"
                  truncate
                >
                  {roomName}
                </Text>
              </Box>
              {!optionsVisible && !unread && !selected && typingMember.length > 0 && (
                <Badge size="300" variant="Secondary" fill="Soft" radii="Pill" outlined>
                  <TypingIndicator size="300" disableAnimation />
                </Badge>
              )}
              {!optionsVisible && unread && (
                <UnreadBadgeCenter>
                  <UnreadBadge highlight={unread.highlight > 0} count={unread.total} />
                </UnreadBadgeCenter>
              )}
              {!optionsVisible && notificationMode !== RoomNotificationMode.Unset && (
                <Icon
                  size="50"
                  src={getRoomNotificationModeIcon(notificationMode)}
                  aria-label={notificationMode}
                />
              )}
            </Box>
          </NavItemContent>
        </NavButton>
        {/* Always show call icon for voice rooms; show full options on hover */}
        {(room.isCallRoom() || optionsVisible) && (
          <NavItemOptions>
            {/* Persistent call icon — always visible for voice rooms */}
            {room.isCallRoom() && (
              <TooltipProvider
                position="Bottom"
                offset={4}
                tooltip={
                  <Tooltip>
                    <Text>{isActiveCall ? 'Open Call' : 'Join Call'}</Text>
                  </Tooltip>
                }
              >
                {(triggerRef) => (
                  <IconButton
                    ref={triggerRef}
                    data-testid="call-button"
                    onClick={handleCallButtonClick}
                    aria-pressed={isActiveCall}
                    aria-label={isActiveCall ? 'Open Call' : 'Join Call'}
                    variant="Background"
                    fill="None"
                    size="300"
                    radii="300"
                  >
                    <Icon size="50" src={Icons.Phone} filled={isActiveCall} />
                  </IconButton>
                )}
              </TooltipProvider>
            )}
            {/* Context menu options — hover only */}
            {optionsVisible && (
              <PopOut
                id={`menu-${room.roomId}`}
                aria-expanded={!!menuAnchor}
                anchor={menuAnchor}
                offset={menuAnchor?.width === 0 ? 0 : undefined}
                alignOffset={menuAnchor?.width === 0 ? 0 : -5}
                position="Bottom"
                align={menuAnchor?.width === 0 ? 'Start' : 'End'}
                content={
                  <FocusTrap
                    focusTrapOptions={{
                      initialFocus: false,
                      returnFocusOnDeactivate: false,
                      onDeactivate: () => setMenuAnchor(undefined),
                      clickOutsideDeactivates: true,
                      isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
                      isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
                      escapeDeactivates: stopPropagation,
                    }}
                  >
                    <RoomNavItemMenu
                      room={room}
                      requestClose={() => setMenuAnchor(undefined)}
                      notificationMode={notificationMode}
                    />
                  </FocusTrap>
                }
              >
                {room.isCallRoom() && (
                  <TooltipProvider
                    position="Bottom"
                    offset={4}
                    tooltip={
                      <Tooltip>
                        <Text>Open Chat</Text>
                      </Tooltip>
                    }
                  >
                    {(triggerRef) => (
                      <IconButton
                        ref={triggerRef}
                        data-testid="chat-button"
                        onClick={handleChatButtonClick}
                        aria-pressed={isChatOpen && selected}
                        aria-label="Open Chat"
                        variant="Background"
                        fill="None"
                        size="300"
                        radii="300"
                      >
                        <Icon size="50" src={Icons.Message} />
                      </IconButton>
                    )}
                  </TooltipProvider>
                )}
                <IconButton
                  onClick={handleOpenMenu}
                  aria-pressed={!!menuAnchor}
                  aria-controls={`menu-${room.roomId}`}
                  aria-label="More Options"
                  variant="Background"
                  fill="None"
                  size="300"
                  radii="300"
                >
                  <Icon size="50" src={Icons.VerticalDots} filled={!!menuAnchor} />
                </IconButton>
              </PopOut>
            )}
          </NavItemOptions>
        )}
      </NavItem>
      {room.isCallRoom() && (
        <Box direction="Column" style={{ paddingLeft: config.space.S200 }}>
          {callMemberships.map((callMembership) => (
            <RoomNavUser
              key={callMembership.membershipID}
              room={room}
              callMembership={callMembership}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}
