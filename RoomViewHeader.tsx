import React, { MouseEventHandler, forwardRef, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import {
  Box,
  Avatar,
  Text,
  Overlay,
  OverlayCenter,
  OverlayBackdrop,
  IconButton,
  Icon,
  Icons,
  Tooltip,
  TooltipProvider,
  Menu,
  MenuItem,
  toRem,
  config,
  Line,
  PopOut,
  RectCords,
  Badge,
  Spinner,
} from 'folds';
import { useNavigate } from 'react-router-dom';
import { EventTimeline, Room } from 'matrix-js-sdk';

import { useStateEvent } from '../../hooks/useStateEvent';
import { PageHeader } from '../../components/page';
import { RoomAvatar, RoomIcon } from '../../components/room-avatar';
import { UseStateProvider } from '../../components/UseStateProvider';
import { RoomTopicViewer } from '../../components/room-topic-viewer';
import { StateEvent } from '../../../types/matrix/room';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useIsDirectRoom, useRoom } from '../../hooks/useRoom';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { useSpaceOptionally } from '../../hooks/useSpace';
import { getHomeSearchPath, getSpaceSearchPath, withSearchParam } from '../../pages/pathUtils';
import { getCanonicalAliasOrRoomId, isRoomAlias, mxcUrlToHttp } from '../../utils/matrix';
import { _SearchPathSearchParams } from '../../pages/paths';
import * as css from './RoomViewHeader.css';
import { useRoomUnread } from '../../state/hooks/unread';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { markAsRead } from '../../utils/notifications';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { copyToClipboard } from '../../utils/dom';
import { LeaveRoomPrompt } from '../../components/leave-room-prompt';
import { useRoomAvatar, useRoomName, useRoomTopic } from '../../hooks/useRoomMeta';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { stopPropagation } from '../../utils/keyboard';
import { getMatrixToRoom } from '../../plugins/matrix-to';
import { getViaServers } from '../../plugins/via-servers';
import { BackRouteHandler } from '../../components/BackRouteHandler';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useRoomPinnedEvents } from '../../hooks/useRoomPinnedEvents';
import { RoomPinMenu } from './room-pin-menu';
import { useOpenRoomSettings } from '../../state/hooks/roomSettings';
import { RoomNotificationModeSwitcher } from '../../components/RoomNotificationSwitcher';
import {
  getRoomNotificationMode,
  getRoomNotificationModeIcon,
  useRoomsNotificationPreferencesContext,
} from '../../hooks/useRoomsNotificationPreferences';
import { JumpToTime } from './jump-to-time';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { InviteUserPrompt } from '../../components/invite-user-prompt';
import { useCallState } from '../../pages/client/call/CallProvider';
import { ContainerColor } from '../../styles/ContainerColor.css';
import { getIssueSchema } from '../issues/IssueBoard';

type RoomMenuProps = {
  room: Room;
  requestClose: () => void;
  onOpenIssueBoard?: () => void;
  onToggleThreadsDrawer?: () => void;
  isThreadsDrawer?: boolean;
};
const RoomMenu = forwardRef<HTMLDivElement, RoomMenuProps>(({ room, requestClose, onOpenIssueBoard, onToggleThreadsDrawer, isThreadsDrawer }, ref) => {
  const mx = useMatrixClient();
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const [issueTrackerEnabled] = useSetting(settingsAtom, 'issueTracker');
  const unread = useRoomUnread(room.roomId, roomToUnreadAtom);
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);

  const permissions = useRoomPermissions(creators, powerLevels);
  const canInvite = permissions.action('invite', mx.getSafeUserId());
  // Check room creator directly from the create event (creatorsSupported returns false for
  // room versions 1–11, which covers virtually all real rooms, breaking the creator bypass).
  const roomCreateEvent = room
    .getLiveTimeline()
    .getState(EventTimeline.BACKWARDS)
    ?.getStateEvents(StateEvent.RoomCreate, '');
  const isRoomCreator = roomCreateEvent?.getSender() === mx.getSafeUserId();
  const canConfigSchema =
    isRoomCreator ||
    permissions.stateEvent('eu.kiefte.issues.schema' as any, mx.getSafeUserId());
  const notificationPreferences = useRoomsNotificationPreferencesContext();
  const notificationMode = getRoomNotificationMode(notificationPreferences, room.roomId);
  const { navigateRoom } = useRoomNavigate();

  const [invitePrompt, setInvitePrompt] = useState(false);

  const hasIssueSchema = !!getIssueSchema(room);

  const handleMarkAsRead = () => {
    markAsRead(mx, room.roomId, hideActivity);
    requestClose();
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

  const openSettings = useOpenRoomSettings();
  const parentSpace = useSpaceOptionally();
  const handleOpenSettings = () => {
    openSettings(room.roomId, parentSpace?.roomId);
    requestClose();
  };

  const handleToggleThreads = () => {
    onToggleThreadsDrawer?.();
    requestClose();
  };

  const handleInitializeIssueTracker = () => {
    // Open the issue board — when no schema exists, IssueBoard renders the schema editor inline.
    onOpenIssueBoard?.();
    requestClose();
  };

  return (
    <Menu ref={ref} style={{ maxWidth: toRem(160), width: '100vw' }}>
      {invitePrompt && (
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
          onClick={handleOpenSettings}
          size="300"
          after={<Icon size="100" src={Icons.Setting} />}
          radii="300"
        >
          <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
            Room Settings
          </Text>
        </MenuItem>
        <UseStateProvider initial={false}>
          {(promptJump, setPromptJump) => (
            <>
              <MenuItem
                onClick={() => setPromptJump(true)}
                size="300"
                after={<Icon size="100" src={Icons.RecentClock} />}
                radii="300"
                aria-pressed={promptJump}
              >
                <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                  Jump to Time
                </Text>
              </MenuItem>
              {promptJump && (
                <JumpToTime
                  onSubmit={(eventId) => {
                    setPromptJump(false);
                    navigateRoom(room.roomId, eventId);
                    requestClose();
                  }}
                  onCancel={() => setPromptJump(false)}
                />
              )}
            </>
          )}
        </UseStateProvider>
        {onToggleThreadsDrawer && (
          <MenuItem
            onClick={handleToggleThreads}
            size="300"
            after={<Icon size="100" src={Icons.Message} />}
            radii="300"
            aria-pressed={isThreadsDrawer}
          >
            <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
              {isThreadsDrawer ? 'Hide Threads' : 'Threads'}
            </Text>
          </MenuItem>
        )}
      </Box>
      {/* Experimental: Issue Tracker setup (requires experimental setting + admin rights) */}
      {issueTrackerEnabled && canConfigSchema && !hasIssueSchema && (
        <>
          <Line variant="Surface" size="300" />
          <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
            <MenuItem
              onClick={handleInitializeIssueTracker}
              variant="Primary"
              fill="None"
              size="300"
              after={<Icon size="100" src={Icons.CheckTwice} />}
              radii="300"
            >
              <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                Init Issue Tracker
              </Text>
            </MenuItem>
          </Box>
        </>
      )}
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
});

type RoomViewHeaderProps = {
  isIssueBoard?: boolean;
  onToggleIssueBoard?: () => void;
  isThreadsDrawer?: boolean;
  onToggleThreadsDrawer?: () => void;
};

export function RoomViewHeader({ isIssueBoard, onToggleIssueBoard, isThreadsDrawer, onToggleThreadsDrawer }: RoomViewHeaderProps) {
  const navigate = useNavigate();
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const screenSize = useScreenSizeContext();
  const room = useRoom();
  const space = useSpaceOptionally();
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const [pinMenuAnchor, setPinMenuAnchor] = useState<RectCords>();
  const direct = useIsDirectRoom();

  const { isChatOpen, isCallViewOpen, toggleChat, toggleCallView, setActiveCallRoomId, hangUp, activeCallRoomId } = useCallState();
  // NOTE: isActiveCall hides the phone button and shows the chat toggle for active calls.
  const isActiveCall = activeCallRoomId === room.roomId;

  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);
  const permissions = useRoomPermissions(creators, powerLevels);
  const canCall = permissions.stateEvent('org.matrix.msc3401.call.member', mx.getSafeUserId());
  const canWriteIssues = permissions.stateEvent('eu.kiefte.issue' as any, mx.getSafeUserId());
  // Check room creator directly (creatorsSupported returns false for versions 1–11).
  const headerCreateEvent = room
    .getLiveTimeline()
    .getState(EventTimeline.BACKWARDS)
    ?.getStateEvents(StateEvent.RoomCreate, '');
  const isHeaderRoomCreator = headerCreateEvent?.getSender() === mx.getSafeUserId();
  const canConfigSchema =
    isHeaderRoomCreator ||
    permissions.stateEvent('eu.kiefte.issues.schema' as any, mx.getSafeUserId());

  // Issues button is shown when schema exists AND user has rights to interact with issues.
  const hasIssueSchema = !!getIssueSchema(room);
  const showIssuesButton = hasIssueSchema && (canWriteIssues || canConfigSchema);

  // NOTE: This handler is a new addition compared to the PR (hazre/cinny feat/element-call).
  // The PR only adds a Chat toggle for voice rooms; this adds a Start Call button for
  // regular and DM rooms so users can initiate Element Call from any room.
  const handleStartCall = () => {
    hangUp();
    setActiveCallRoomId(room.roomId, true);
  };

  const pinnedEvents = useRoomPinnedEvents(room);
  const encryptionEvent = useStateEvent(room, StateEvent.RoomEncryption);
  const ecryptedRoom = !!encryptionEvent;
  const avatarMxc = useRoomAvatar(room, direct);
  const name = useRoomName(room);
  const topic = useRoomTopic(room);
  const avatarUrl = avatarMxc
    ? mxcUrlToHttp(mx, avatarMxc, useAuthentication, 96, 96, 'crop') ?? undefined
    : undefined;

  const [peopleDrawer, setPeopleDrawer] = useSetting(settingsAtom, 'isPeopleDrawer');

  const handleSearchClick = () => {
    const searchParams: _SearchPathSearchParams = {
      rooms: room.roomId,
    };
    const path = space
      ? getSpaceSearchPath(getCanonicalAliasOrRoomId(mx, space.roomId))
      : getHomeSearchPath();
    navigate(withSearchParam(path, searchParams));
  };

  const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setMenuAnchor(evt.currentTarget.getBoundingClientRect());
  };

  const handleOpenPinMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setPinMenuAnchor(evt.currentTarget.getBoundingClientRect());
  };

  return (
    <PageHeader
      className={ContainerColor({ variant: 'Surface' })}
      balance={screenSize === ScreenSize.Mobile}
    >
      <Box grow="Yes" gap="300">
        {screenSize === ScreenSize.Mobile && (
          <BackRouteHandler>
            {(onBack) => (
              <Box shrink="No" alignItems="Center">
                <IconButton fill="None" onClick={onBack} aria-label="Go back">
                  <Icon src={Icons.ArrowLeft} />
                </IconButton>
              </Box>
            )}
          </BackRouteHandler>
        )}
        <Box grow="Yes" alignItems="Center" gap="300">
          {screenSize !== ScreenSize.Mobile && (
            <Avatar size="300">
              <RoomAvatar
                roomId={room.roomId}
                src={avatarUrl}
                alt={name}
                renderFallback={() => (
                  <RoomIcon size="200" joinRule={room.getJoinRule()} roomType={room.getType()} />
                )}
              />
            </Avatar>
          )}
          <Box direction="Column">
            <Text size={topic ? 'H5' : 'H3'} truncate>
              {name}
            </Text>
            {topic && (
              <UseStateProvider initial={false}>
                {(viewTopic, setViewTopic) => (
                  <>
                    <Overlay open={viewTopic} backdrop={<OverlayBackdrop />}>
                      <OverlayCenter>
                        <FocusTrap
                          focusTrapOptions={{
                            initialFocus: false,
                            clickOutsideDeactivates: true,
                            onDeactivate: () => setViewTopic(false),
                            escapeDeactivates: stopPropagation,
                          }}
                        >
                          <RoomTopicViewer
                            name={name}
                            topic={topic}
                            requestClose={() => setViewTopic(false)}
                          />
                        </FocusTrap>
                      </OverlayCenter>
                    </Overlay>
                    <Text
                      as="button"
                      type="button"
                      onClick={() => setViewTopic(true)}
                      className={css.HeaderTopic}
                      size="T200"
                      priority="300"
                      truncate
                    >
                      {topic}
                    </Text>
                  </>
                )}
              </UseStateProvider>
            )}
          </Box>
        </Box>

        <Box shrink="No">
          {/* FRONT: feature buttons — hidden when the feature is impossible for this room.
              Wobble here (left side of group) is less noticeable than at the right. */}

          {/* Call button — hidden when canCall is false AND no call is active/running.
              Unified: "Start Call" before a call, "Show/Hide Call" toggle once active. */}
          {(canCall || isActiveCall || room.isCallRoom()) && !isIssueBoard && (
            <TooltipProvider
              position="Bottom"
              offset={4}
              tooltip={
                <Tooltip>
                  <Text>
                    {(isActiveCall || room.isCallRoom())
                      ? (isCallViewOpen ? 'Hide Call' : 'Show Call')
                      : 'Start Call'}
                  </Text>
                </Tooltip>
              }
            >
              {(triggerRef) => (
                <IconButton
                  fill="None"
                  ref={triggerRef}
                  onClick={isActiveCall || room.isCallRoom() ? toggleCallView : handleStartCall}
                  aria-label={
                    (isActiveCall || room.isCallRoom())
                      ? (isCallViewOpen ? 'Hide call' : 'Show call')
                      : 'Start call'
                  }
                  aria-pressed={(isActiveCall || room.isCallRoom()) ? isCallViewOpen : undefined}
                  aria-keyshortcuts={!isActiveCall && !room.isCallRoom() ? 'Alt+J' : undefined}
                >
                  <Icon
                    size="400"
                    src={Icons.Phone}
                    filled={(isActiveCall || room.isCallRoom()) && isCallViewOpen}
                  />
                </IconButton>
              )}
            </TooltipProvider>
          )}

          {/* Chat toggle — hidden when no call is active */}
          {(isActiveCall || room.isCallRoom()) && !isIssueBoard && (
            <TooltipProvider
              position="Bottom"
              offset={4}
              tooltip={
                <Tooltip>
                  <Text>{isChatOpen ? 'Hide Chat' : 'Show Chat'}</Text>
                </Tooltip>
              }
            >
              {(triggerRef) => (
                <IconButton
                  fill="None"
                  ref={triggerRef}
                  onClick={toggleChat}
                  aria-label={isChatOpen ? 'Hide chat' : 'Show chat'}
                  aria-pressed={isChatOpen}
                >
                  <Icon size="400" src={Icons.Message} filled={isChatOpen} />
                </IconButton>
              )}
            </TooltipProvider>
          )}

          {/* Issue board toggle — hidden when schema absent or insufficient rights */}
          {showIssuesButton && (
            <TooltipProvider
              position="Bottom"
              offset={4}
              tooltip={
                <Tooltip>
                  <Text>{isIssueBoard ? 'Show Chat' : 'Issue Tracker'}</Text>
                </Tooltip>
              }
            >
              {(triggerRef) => (
                <IconButton
                  fill="None"
                  ref={triggerRef}
                  onClick={onToggleIssueBoard}
                  aria-pressed={isIssueBoard}
                  aria-label={isIssueBoard ? 'Show chat' : 'Issue tracker'}
                >
                  <Icon size="400" src={Icons.CheckTwice} filled={isIssueBoard} />
                </IconButton>
              )}
            </TooltipProvider>
          )}

          {/* BACK: stable buttons — always visible, greyed when temporarily unavailable.
              The … menu is always the rightmost button; its position never changes. */}

          {/* Search — greyed when issue board covers the chat */}
          {!ecryptedRoom && (
            <TooltipProvider
              position="Bottom"
              offset={4}
              tooltip={
                <Tooltip>
                  <Text>Search</Text>
                </Tooltip>
              }
            >
              {(triggerRef) => (
                <IconButton fill="None" ref={triggerRef} disabled={isIssueBoard} onClick={handleSearchClick} aria-label="Search room">
                  <Icon size="400" src={Icons.Search} />
                </IconButton>
              )}
            </TooltipProvider>
          )}

          {/* Pinned messages — greyed when issue board covers the chat */}
          <TooltipProvider
            position="Bottom"
            offset={4}
            tooltip={
              <Tooltip>
                <Text>Pinned Messages</Text>
              </Tooltip>
            }
          >
            {(triggerRef) => (
              <IconButton
                fill="None"
                style={{ position: 'relative' }}
                disabled={isIssueBoard}
                onClick={handleOpenPinMenu}
                ref={triggerRef}
                aria-pressed={!!pinMenuAnchor}
                aria-label={`Pinned messages${pinnedEvents.length > 0 ? ` (${pinnedEvents.length} pinned)` : ''}`}
              >
                {pinnedEvents.length > 0 && (
                  <Badge
                    style={{
                      position: 'absolute',
                      left: toRem(3),
                      top: toRem(3),
                    }}
                    variant="Secondary"
                    size="400"
                    fill="Solid"
                    radii="Pill"
                  >
                    <Text as="span" size="L400">
                      {pinnedEvents.length}
                    </Text>
                  </Badge>
                )}
                <Icon size="400" src={Icons.Pin} filled={!!pinMenuAnchor} />
              </IconButton>
            )}
          </TooltipProvider>
          <PopOut
            anchor={pinMenuAnchor}
            position="Bottom"
            content={
              <FocusTrap
                focusTrapOptions={{
                  initialFocus: false,
                  returnFocusOnDeactivate: false,
                  onDeactivate: () => setPinMenuAnchor(undefined),
                  clickOutsideDeactivates: true,
                  isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
                  isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
                  escapeDeactivates: stopPropagation,
                }}
              >
                <RoomPinMenu room={room} requestClose={() => setPinMenuAnchor(undefined)} />
              </FocusTrap>
            }
          />

          {/* Members — Desktop, always enabled */}
          {screenSize === ScreenSize.Desktop && (
            <TooltipProvider
              position="Bottom"
              offset={4}
              tooltip={
                <Tooltip>
                  <Text>{peopleDrawer ? 'Hide Members' : 'Show Members'}</Text>
                </Tooltip>
              }
            >
              {(triggerRef) => (
                <IconButton
                  fill="None"
                  ref={triggerRef}
                  onClick={() => setPeopleDrawer((drawer) => !drawer)}
                  aria-label={peopleDrawer ? 'Hide members' : 'Show members'}
                  aria-pressed={peopleDrawer}
                >
                  <Icon size="400" src={Icons.User} />
                </IconButton>
              )}
            </TooltipProvider>
          )}

          {/* Threads — Desktop, always enabled */}
          {screenSize === ScreenSize.Desktop && (
            <TooltipProvider
              position="Bottom"
              offset={4}
              tooltip={
                <Tooltip>
                  <Text>{isThreadsDrawer ? 'Hide Threads' : 'Show Threads'}</Text>
                </Tooltip>
              }
            >
              {(triggerRef) => (
                <IconButton
                  fill="None"
                  ref={triggerRef}
                  onClick={onToggleThreadsDrawer}
                  aria-pressed={isThreadsDrawer}
                  aria-label={isThreadsDrawer ? 'Hide threads panel' : 'Show threads panel'}
                >
                  <Icon size="400" src={Icons.Message} filled={isThreadsDrawer} />
                </IconButton>
              )}
            </TooltipProvider>
          )}

          {/* More options — always rightmost */}
          <TooltipProvider
            position="Bottom"
            align="End"
            offset={4}
            tooltip={
              <Tooltip>
                <Text>More Options</Text>
              </Tooltip>
            }
          >
            {(triggerRef) => (
              <IconButton
                fill="None"
                onClick={handleOpenMenu}
                ref={triggerRef}
                aria-pressed={!!menuAnchor}
                aria-label="More options"
              >
                <Icon size="400" src={Icons.VerticalDots} filled={!!menuAnchor} />
              </IconButton>
            )}
          </TooltipProvider>
          <PopOut
            anchor={menuAnchor}
            position="Bottom"
            align="End"
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
                <RoomMenu room={room} requestClose={() => setMenuAnchor(undefined)} onOpenIssueBoard={onToggleIssueBoard} onToggleThreadsDrawer={onToggleThreadsDrawer} isThreadsDrawer={isThreadsDrawer} />
              </FocusTrap>
            }
          />
        </Box>
      </Box>
    </PageHeader>
  );
}
