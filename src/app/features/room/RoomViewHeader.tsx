import React, { MouseEventHandler, forwardRef, useCallback, useState } from 'react';
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
import { Direction, EventTimeline, Room } from 'matrix-js-sdk';

import { useStateEvent } from '../../hooks/useStateEvent';
import { useRoomWidgets } from '../../hooks/useRoomWidgets';
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
import { RoomSettingsPage } from '../../state/roomSettings';
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
import { useWallyConference } from '../../hooks/useWallyConference';
import { ContainerColor } from '../../styles/ContainerColor.css';
import { useKeyDown } from '../../hooks/useKeyDown';
import { isKeyHotkey } from 'is-hotkey';
import { getIssueSchema } from '../issues/IssueBoard';
import { useToolbarConfig } from '../../hooks/useToolbarConfig';
import { ToolbarItemId } from '../../state/toolbarConfig';
import { renderItemIcon } from './PanelIconPicker';
import { activeWidgetIdAtom } from './WidgetsDrawer';
import { useAtom, useSetAtom } from 'jotai';
import { mentionNavAtom } from '../../hooks/useNavigateUnread';
import { useNavigateUnread } from '../../hooks/useNavigateUnread';
import { getPrevSessionStart } from '../../state/sessions';

type UnpinnedItem = {
  id: ToolbarItemId;
  label: string;
  iconSrc?: (filled?: boolean) => React.JSX.Element;
  active: boolean;
  onToggle: () => void;
};

type RoomMenuProps = {
  room: Room;
  requestClose: () => void;
  onOpenIssueBoard?: () => void;
  onToggleThreadsDrawer?: () => void;
  isThreadsDrawer?: boolean;
  unpinnedItems?: UnpinnedItem[];
  onPin?: (id: ToolbarItemId) => void;
};
const RoomMenu = forwardRef<HTMLDivElement, RoomMenuProps>(({ room, requestClose, onOpenIssueBoard, onToggleThreadsDrawer, isThreadsDrawer, unpinnedItems, onPin }, ref) => {
  const mx = useMatrixClient();
  const wallyConference = useWallyConference(room);
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
  const setMentionNav = useSetAtom(mentionNavAtom);
  const [searchingMentions, setSearchingMentions] = useState(false);
  const {
    navigatePrev,
    navigateNext,
    navigatePrevMention,
    navigateNextMention,
    unreadCount,
    mentionCount,
  } = useNavigateUnread();

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
      {unpinnedItems && unpinnedItems.length > 0 && (
        <>
          <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
            {unpinnedItems.map((item) => (
              <MenuItem
                key={item.id}
                size="300"
                radii="300"
                aria-pressed={item.active}
                onClick={() => { item.onToggle(); requestClose(); }}
                after={
                  <Box gap="100" alignItems="Center">
                    {item.iconSrc && <Icon size="100" src={item.iconSrc} />}
                    <IconButton
                      size="300"
                      radii="300"
                      onClick={(e) => { e.stopPropagation(); onPin?.(item.id); }}
                      aria-label="Pin to toolbar"
                    >
                      <Icon src={Icons.Pin} size="100" />
                    </IconButton>
                  </Box>
                }
              >
                <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                  {item.label}
                </Text>
              </MenuItem>
            ))}
          </Box>
          <Line variant="Surface" size="300" />
        </>
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
        {wallyConference.available && wallyConference.endpoint && (
          <MenuItem
            onClick={() => {
              const joinUrl = `${wallyConference.endpoint}/${encodeURIComponent(room.roomId)}`;
              copyToClipboard(joinUrl);
              requestClose();
            }}
            size="300"
            after={<Icon size="100" src={Icons.External} />}
            radii="300"
          >
            <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
              Share Guest Link
            </Text>
          </MenuItem>
        )}
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
        <MenuItem
          onClick={() => { navigatePrev(); requestClose(); }}
          size="300"
          after={<Icon size="100" src={Icons.ChevronTop} />}
          radii="300"
          aria-disabled={unreadCount === 0}
          aria-keyshortcuts="Alt+Shift+ArrowUp"
        >
          <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
            Previous Unread Room{unreadCount > 0 ? ` (${unreadCount})` : ''}
          </Text>
        </MenuItem>
        <MenuItem
          onClick={() => { navigateNext(); requestClose(); }}
          size="300"
          after={<Icon size="100" src={Icons.ChevronBottom} />}
          radii="300"
          aria-disabled={unreadCount === 0}
          aria-keyshortcuts="Alt+Shift+ArrowDown"
        >
          <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
            Next Unread Room{unreadCount > 0 ? ` (${unreadCount})` : ''}
          </Text>
        </MenuItem>
        <MenuItem
          onClick={() => { navigatePrevMention(); requestClose(); }}
          size="300"
          after={<Icon size="100" src={Icons.Mention} />}
          radii="300"
          aria-disabled={mentionCount === 0}
        >
          <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
            Previous Mention{mentionCount > 0 ? ` (${mentionCount})` : ''}
          </Text>
        </MenuItem>
        <MenuItem
          onClick={() => { navigateNextMention(); requestClose(); }}
          size="300"
          after={<Icon size="100" src={Icons.Mention} />}
          radii="300"
          aria-disabled={mentionCount === 0}
        >
          <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
            Next Mention{mentionCount > 0 ? ` (${mentionCount})` : ''}
          </Text>
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (searchingMentions) return;
            const myUserId = mx.getSafeUserId();
            const timelineSet = room.getUnfilteredTimelineSet();

            const isMentioned = (e: { getType(): string; getContent(): Record<string, unknown> }) => {
              if (e.getType() !== 'm.room.message') return false;
              const c = e.getContent() as Record<string, unknown>;
              const mentions = c['m.mentions'] as { user_ids?: string[] } | undefined;
              if (mentions?.user_ids?.includes(myUserId)) return true;
              return typeof c.body === 'string' && c.body.includes(myUserId);
            };

            const collectMentionIds = () =>
              timelineSet
                .getTimelines()
                .flatMap((tl) => tl.getEvents())
                .filter(isMentioned)
                .map((e) => e.getId()!)
                .filter(Boolean);

            // Threshold: search at most 24 h back, unless the previous session
            // started before that — in which case go back to that session start.
            const prevSession = getPrevSessionStart();
            const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
            const threshold = prevSession > 0 ? Math.min(prevSession, oneDayAgo) : oneDayAgo;

            void (async () => {
              let eventIds = collectMentionIds();

              if (eventIds.length === 0) {
                setSearchingMentions(true);
                try {
                  const liveTimeline = timelineSet.getLiveTimeline();
                  // eslint-disable-next-line no-constant-condition
                  while (true) {
                    // Walk to oldest loaded fragment
                    let oldest = liveTimeline;
                    let prev = oldest.getNeighbouringTimeline(Direction.Backward);
                    while (prev) {
                      oldest = prev;
                      prev = oldest.getNeighbouringTimeline(Direction.Backward);
                    }

                    // Check if oldest event is already past our threshold
                    const oldestEvent = oldest.getEvents()[0];
                    if (oldestEvent && oldestEvent.getTs() < threshold) break;

                    // Check if server has more to give
                    if (!oldest.getPaginationToken(Direction.Backward)) break;

                    // eslint-disable-next-line no-await-in-loop
                    const ok = await mx.paginateEventTimeline(oldest, {
                      backwards: true,
                      limit: 50,
                    });
                    if (!ok) break;

                    eventIds = collectMentionIds();
                    if (eventIds.length > 0) break;
                  }
                } finally {
                  setSearchingMentions(false);
                }
              }

              if (eventIds.length === 0) return;
              const index = eventIds.length - 1;
              setMentionNav({ roomId: room.roomId, eventIds, index });
              navigateRoom(room.roomId, eventIds[index]);
              requestClose();
            })();
          }}
          size="300"
          after={
            searchingMentions ? (
              <Spinner size="100" variant="Secondary" />
            ) : (
              <Icon size="100" src={Icons.Mention} />
            )
          }
          radii="300"
        >
          <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
            {searchingMentions ? 'Searching mentions…' : 'Jump to Last Mention'}
          </Text>
        </MenuItem>
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
  isWidgetsDrawer?: boolean;
  onToggleWidgetsDrawer?: () => void;
  onTogglePeopleDrawer?: () => void;
};

export function RoomViewHeader({ isIssueBoard, onToggleIssueBoard, isThreadsDrawer, onToggleThreadsDrawer, isWidgetsDrawer, onToggleWidgetsDrawer, onTogglePeopleDrawer }: RoomViewHeaderProps) {
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

  const wallyConference = useWallyConference(room);
  const [guestLinkCopied, setGuestLinkCopied] = useState(false);
  const handleCopyGuestLink = () => {
    if (!wallyConference.endpoint) return;
    const joinUrl = `${wallyConference.endpoint}/${encodeURIComponent(room.roomId)}`;
    copyToClipboard(joinUrl);
    setGuestLinkCopied(true);
    setTimeout(() => setGuestLinkCopied(false), 2000);
  };

  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);
  const permissions = useRoomPermissions(creators, powerLevels);
  const canCall = permissions.stateEvent('org.matrix.msc3401.call.member', mx.getSafeUserId());
  const roomWidgets = useRoomWidgets(room);
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
  const name = useRoomName(room, direct);
  const topic = useRoomTopic(room);
  const avatarMxc = useRoomAvatar(room, direct);
  const avatarUrl = avatarMxc
    ? mxcUrlToHttp(mx, avatarMxc, useAuthentication, 96, 96, 'crop') ?? undefined
    : undefined;

  const [peopleDrawer, setPeopleDrawer] = useSetting(settingsAtom, 'isPeopleDrawer');

  // Toolbar config — pins, ordering, defaultMode, widget shortcuts
  const { config: toolbarConfig, getEffective, setItem: setToolbarItem, removeItem: removeToolbarItem } = useToolbarConfig();
  const [ctxMenu, setCtxMenu] = useState<{ anchor: RectCords; id: ToolbarItemId } | null>(null);
  const [, setActiveWidgetId] = useAtom(activeWidgetIdAtom);

  const handleContextMenu = (id: ToolbarItemId) => (e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ anchor: (e.currentTarget as HTMLElement).getBoundingClientRect(), id });
  };

  // Widget shortcut entries derived from config
  type WidgetShortcutEntry = {
    id: ToolbarItemId;
    cfg: ReturnType<typeof getEffective>;
    widget: (typeof roomWidgets)[number];
  };
  const widgetShortcutEntries: WidgetShortcutEntry[] = Object.entries(toolbarConfig)
    .filter(([k]) => k.startsWith('widget:'))
    .map(([id]) => {
      const tid = id as ToolbarItemId;
      return { id: tid, cfg: getEffective(tid), widget: roomWidgets.find((w) => `widget:${w.id}` === id) };
    })
    .filter((x): x is WidgetShortcutEntry => x.widget !== undefined)
    .sort((a, b) => a.cfg.order - b.cfg.order);

  // Unpinned panel items for overflow menu
  const panelItems: UnpinnedItem[] = [
    {
      id: 'members' as ToolbarItemId,
      label: peopleDrawer ? 'Hide Members' : 'Show Members',
      iconSrc: Icons.User,
      active: peopleDrawer,
      onToggle: () => onTogglePeopleDrawer ? onTogglePeopleDrawer() : setPeopleDrawer((d) => !d),
    },
    {
      id: 'threads' as ToolbarItemId,
      label: isThreadsDrawer ? 'Hide Threads' : 'Show Threads',
      iconSrc: Icons.Message,
      active: isThreadsDrawer ?? false,
      onToggle: () => onToggleThreadsDrawer?.(),
    },
    {
      id: 'widgets' as ToolbarItemId,
      label: isWidgetsDrawer ? 'Hide Widgets' : 'Show Widgets',
      iconSrc: Icons.Category,
      active: isWidgetsDrawer ?? false,
      onToggle: () => onToggleWidgetsDrawer?.(),
    },
    {
      id: 'issues' as ToolbarItemId,
      label: isIssueBoard ? 'Show Chat' : 'Issue Tracker',
      iconSrc: Icons.CheckTwice,
      active: isIssueBoard ?? false,
      onToggle: () => onToggleIssueBoard?.(),
    },
  ].filter((item) => {
    if (screenSize !== ScreenSize.Desktop) return false;
    if (getEffective(item.id).pinned) return false;
    // Issues only appear if the room has a schema and user has rights
    if (item.id === 'issues' && !showIssuesButton) return false;
    // Threads/widgets need their toggle handlers
    if (item.id === 'threads' && !onToggleThreadsDrawer) return false;
    if (item.id === 'widgets' && !onToggleWidgetsDrawer) return false;
    return true;
  });

  const unpinnedWidgetItems: UnpinnedItem[] = widgetShortcutEntries
    .filter((x) => !x.cfg.pinned)
    .map(({ id, cfg, widget }) => ({
      id,
      label: cfg.label ?? widget!.name,
      active: isWidgetsDrawer ?? false,
      onToggle: () => {
        setActiveWidgetId(widget!.id);
        onToggleWidgetsDrawer?.();
      },
    }));

  const allUnpinnedItems = [...panelItems, ...unpinnedWidgetItems];

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

  const handleToolbarKeyDown = useCallback((evt: React.KeyboardEvent<HTMLElement>) => {
    const isLeft = isKeyHotkey('arrowleft', evt as unknown as KeyboardEvent);
    const isRight = isKeyHotkey('arrowright', evt as unknown as KeyboardEvent);
    const isHome = isKeyHotkey('home', evt as unknown as KeyboardEvent);
    const isEnd = isKeyHotkey('end', evt as unknown as KeyboardEvent);
    if (!isLeft && !isRight && !isHome && !isEnd) return;
    const toolbar = evt.currentTarget;
    const buttons = Array.from(
      toolbar.querySelectorAll<HTMLElement>('button:not([disabled])')
    );
    if (buttons.length === 0) return;
    evt.preventDefault();
    const focused = document.activeElement as HTMLElement;
    const currentIdx = buttons.indexOf(focused);
    let nextIdx: number;
    if (isHome) nextIdx = 0;
    else if (isEnd) nextIdx = buttons.length - 1;
    else if (isLeft) nextIdx = currentIdx <= 0 ? buttons.length - 1 : currentIdx - 1;
    else nextIdx = currentIdx >= buttons.length - 1 ? 0 : currentIdx + 1;
    buttons[nextIdx].focus();
  }, []);

  const handleHeaderKeyDown = useCallback(
    (evt: KeyboardEvent) => {
      if (isKeyHotkey('alt+shift+q', evt)) {
        evt.preventDefault();
        onToggleThreadsDrawer?.();
      } else if (isKeyHotkey('alt+shift+s', evt)) {
        evt.preventDefault();
        handleSearchClick();
      } else if (isKeyHotkey('alt+shift+c', evt) && (isActiveCall || room.isCallRoom())) {
        evt.preventDefault();
        toggleChat();
      }
    },
    [onToggleThreadsDrawer, handleSearchClick, isActiveCall, room, toggleChat]
  );
  useKeyDown(window, handleHeaderKeyDown);

  const openSettings = useOpenRoomSettings();
  const parentSpace = useSpaceOptionally();
  const handleMemberToggle = () => {
    if (isActiveCall) {
      openSettings(room.roomId, parentSpace?.roomId, RoomSettingsPage.MembersPage);
      return;
    }
    setPeopleDrawer(!peopleDrawer);
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

        <Box id="cinny-room-header-toolbar" data-section-label="Room actions" role="toolbar" aria-label="Room actions" aria-orientation="horizontal" shrink="No" onKeyDown={handleToolbarKeyDown}>
          {/* FRONT: feature buttons — hidden when the feature is impossible for this room.
              Wobble here (left side of group) is less noticeable than at the right. */}

          {/* Guest link — shown when Wally Conference bot is present */}
          {wallyConference.available && wallyConference.endpoint && (
            <TooltipProvider
              position="Bottom"
              offset={4}
              tooltip={
                <Tooltip>
                  <Text>{guestLinkCopied ? 'Link Copied!' : 'Share Guest Link'}</Text>
                </Tooltip>
              }
            >
              {(triggerRef) => (
                <IconButton
                  fill="None"
                  ref={triggerRef}
                  onClick={handleCopyGuestLink}
                  aria-label="Share guest link"
                >
                  <Icon size="400" src={Icons.Link} filled={guestLinkCopied} />
                </IconButton>
              )}
            </TooltipProvider>
          )}

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
                  aria-keyshortcuts="Alt+Shift+C"
                >
                  <Icon size="400" src={Icons.Message} filled={isChatOpen} />
                </IconButton>
              )}
            </TooltipProvider>
          )}

          {/* Issue board toggle — hidden when schema absent, insufficient rights, or unpinned */}
          {showIssuesButton && getEffective('issues').pinned && (
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
                  onContextMenu={handleContextMenu('issues')}
                >
                  <Icon size="400" src={Icons.CheckTwice} filled={isIssueBoard} />
                </IconButton>
              )}
            </TooltipProvider>
          )}

          {/* BACK: stable buttons — always visible, greyed when temporarily unavailable.
              The … menu is always the rightmost button; its position never changes. */}

          {/* Search — greyed when issue board covers the chat */}
          {!encryptionEvent && (
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
                <IconButton fill="None" ref={triggerRef} disabled={isIssueBoard} onClick={handleSearchClick} aria-label="Search room" aria-keyshortcuts="Alt+F">
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

          {/* Members — Desktop, pinnable */}
          {screenSize === ScreenSize.Desktop && getEffective('members').pinned && (
            <TooltipProvider
              position="Bottom"
              offset={4}
              tooltip={
                <Tooltip>
                  {room.isCallRoom() ? (
                    <Text>Members</Text>
                  ) : (
                    <Text>{peopleDrawer ? 'Hide Members' : 'Show Members'}</Text>
                  )}
                </Tooltip>
              }
            >
              {(triggerRef) => (
                <IconButton
                  fill="None"
                  ref={triggerRef}
                  onClick={onTogglePeopleDrawer ?? (() => setPeopleDrawer((d) => !d))}
                  aria-label={peopleDrawer ? 'Hide members' : 'Show members'}
                  aria-pressed={peopleDrawer}
                  aria-keyshortcuts="Alt+P"
                  onContextMenu={handleContextMenu('members')}
                >
                  <Icon size="400" src={Icons.User} />
                </IconButton>
              )}
            </TooltipProvider>
          )}

          {/* Widgets — Desktop, pinnable */}
          {screenSize === ScreenSize.Desktop && onToggleWidgetsDrawer && getEffective('widgets').pinned && (
            <TooltipProvider
              position="Bottom"
              offset={4}
              tooltip={
                <Tooltip>
                  <Text>
                    {isWidgetsDrawer
                      ? 'Hide Widgets'
                      : roomWidgets.length > 0
                      ? `Widgets (${roomWidgets.length})`
                      : 'Widgets'}
                  </Text>
                </Tooltip>
              }
            >
              {(triggerRef) => (
                <IconButton
                  fill="None"
                  ref={triggerRef}
                  onClick={onToggleWidgetsDrawer}
                  aria-pressed={isWidgetsDrawer}
                  aria-label={isWidgetsDrawer ? 'Hide widgets panel' : 'Show widgets panel'}
                  onContextMenu={handleContextMenu('widgets')}
                >
                  <Icon size="400" src={Icons.Category} filled={isWidgetsDrawer} />
                </IconButton>
              )}
            </TooltipProvider>
          )}

          {/* Threads — Desktop, pinnable */}
          {screenSize === ScreenSize.Desktop && getEffective('threads').pinned && (
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
                  aria-keyshortcuts="Alt+Shift+T"
                  onContextMenu={handleContextMenu('threads')}
                >
                  <Icon size="400" src={Icons.Message} filled={isThreadsDrawer} />
                </IconButton>
              )}
            </TooltipProvider>
          )}

          {/* Widget shortcut buttons — pinned individual widget shortcuts */}
          {widgetShortcutEntries.filter((x) => x.cfg.pinned).map(({ id, cfg, widget }) => (
            <TooltipProvider
              key={id}
              position="Bottom"
              offset={4}
              tooltip={
                <Tooltip>
                  <Text>{cfg.label ?? widget!.name}</Text>
                </Tooltip>
              }
            >
              {(triggerRef) => (
                <IconButton
                  fill="None"
                  ref={triggerRef}
                  size="300"
                  radii="300"
                  aria-label={cfg.label ?? widget!.name}
                  aria-pressed={isWidgetsDrawer}
                  onClick={() => {
                    setActiveWidgetId(widget!.id);
                    if (!isWidgetsDrawer) onToggleWidgetsDrawer?.();
                  }}
                  onContextMenu={handleContextMenu(id)}
                >
                  {renderItemIcon(cfg.icon, widget!.name, mx, useAuthentication)}
                </IconButton>
              )}
            </TooltipProvider>
          ))}

          {/* Context menu for panel/widget buttons */}
          <PopOut
            anchor={ctxMenu?.anchor}
            position="Bottom"
            align="Start"
            content={
              ctxMenu ? (
                <FocusTrap
                  focusTrapOptions={{
                    clickOutsideDeactivates: true,
                    returnFocusOnDeactivate: false,
                    onDeactivate: () => setCtxMenu(null),
                  }}
                >
                  <Menu style={{ minWidth: toRem(200) }}>
                    <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                      <MenuItem
                        size="300"
                        radii="300"
                        onClick={() => {
                          setToolbarItem(ctxMenu.id, { pinned: !getEffective(ctxMenu.id).pinned });
                          setCtxMenu(null);
                        }}
                      >
                        <Box grow="Yes">
                          <Text size="T300">
                            {getEffective(ctxMenu.id).pinned ? 'Remove from toolbar' : 'Pin to toolbar'}
                          </Text>
                        </Box>
                      </MenuItem>
                      <MenuItem
                        size="300"
                        radii="300"
                        onClick={() => {
                          const cur = getEffective(ctxMenu.id).defaultMode;
                          setToolbarItem(ctxMenu.id, { defaultMode: cur === 'fullwidth' ? 'sidebar' : 'fullwidth' });
                          setCtxMenu(null);
                        }}
                        after={getEffective(ctxMenu.id).defaultMode === 'fullwidth' ? <Icon src={Icons.CheckTwice} size="100" /> : undefined}
                      >
                        <Box grow="Yes">
                          <Text size="T300">Open full-width by default</Text>
                        </Box>
                      </MenuItem>
                      {ctxMenu.id.startsWith('widget:') && (
                        <MenuItem
                          size="300"
                          radii="300"
                          onClick={() => { removeToolbarItem(ctxMenu.id); setCtxMenu(null); }}
                        >
                          <Box grow="Yes">
                            <Text size="T300">Remove shortcut</Text>
                          </Box>
                        </MenuItem>
                      )}
                    </Box>
                  </Menu>
                </FocusTrap>
              ) : <div />
            }
          />

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
                <RoomMenu
                  room={room}
                  requestClose={() => setMenuAnchor(undefined)}
                  onOpenIssueBoard={onToggleIssueBoard}
                  onToggleThreadsDrawer={onToggleThreadsDrawer}
                  isThreadsDrawer={isThreadsDrawer}
                  unpinnedItems={allUnpinnedItems}
                  onPin={(id) => setToolbarItem(id, { pinned: true })}
                />
              </FocusTrap>
            }
          />
        </Box>
      </Box>
    </PageHeader>
  );
}
