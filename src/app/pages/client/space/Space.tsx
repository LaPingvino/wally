import React, {
  MouseEventHandler,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  Avatar,
  Box,
  Button,
  Icon,
  IconButton,
  Icons,
  Line,
  Menu,
  MenuItem,
  PopOut,
  RectCords,
  Spinner,
  Text,
  color,
  config,
  toRem,
} from 'folds';
import { useVirtualizer } from '@tanstack/react-virtual';
import { JoinRule, Room } from 'matrix-js-sdk';
import { RoomJoinRulesEventContent } from 'matrix-js-sdk/lib/types';
import FocusTrap from 'focus-trap-react';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { mDirectAtom } from '../../../state/mDirectList';
import {
  NavCategory,
  NavCategoryHeader,
  NavItem,
  NavItemContent,
  NavLink,
} from '../../../components/nav';
import { getSpaceLobbyPath, getSpaceRoomPath, getSpaceSearchPath } from '../../pathUtils';
import { getCanonicalAliasOrRoomId, isRoomAlias } from '../../../utils/matrix';
import { useSelectedRoom } from '../../../hooks/router/useSelectedRoom';
import {
  useSpaceLobbySelected,
  useSpaceSearchSelected,
} from '../../../hooks/router/useSelectedSpace';
import { useSpace } from '../../../hooks/useSpace';
import { VirtualTile } from '../../../components/virtualizer';
import { RoomNavCategoryButton, RoomNavItem } from '../../../features/room-nav';
import { makeNavCategoryId } from '../../../state/closedNavCategories';
import { roomToUnreadAtom } from '../../../state/room/roomToUnread';
import { useCategoryHandler } from '../../../hooks/useCategoryHandler';
import { useNavToActivePathMapper } from '../../../hooks/useNavToActivePathMapper';
import { useRoomName } from '../../../hooks/useRoomMeta';
import { HierarchyItem, useSpaceJoinedHierarchy } from '../../../hooks/useSpaceHierarchy';
import { factoryRoomIdByActivity, factoryRoomIdByAtoZ, factoryRoomIdByUnreadFirst, byOrderKey, byTsOldToNew } from '../../../utils/sort';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { useFavoriteRooms } from '../../../hooks/useFavoriteRooms';
import { PageNav, PageNavContent, PageNavHeader } from '../../../components/page';
import { usePowerLevels } from '../../../hooks/usePowerLevels';
import { useRecursiveChildScopeFactory, useSpaceChildren } from '../../../state/hooks/roomList';
import { roomToParentsAtom } from '../../../state/room/roomToParents';
import { markAsRead } from '../../../utils/notifications';
import { useRoomsUnread } from '../../../state/hooks/unread';
import { UseStateProvider } from '../../../components/UseStateProvider';
import { LeaveSpacePrompt } from '../../../components/leave-space-prompt';
import { copyToClipboard } from '../../../utils/dom';
import { useClosedNavCategoriesAtom } from '../../../state/hooks/closedNavCategories';
import { useStateEvent } from '../../../hooks/useStateEvent';
import { Membership, StateEvent } from '../../../../types/matrix/room';
import { stopPropagation } from '../../../utils/keyboard';
import { getMatrixToRoom } from '../../../plugins/matrix-to';
import { getViaServers } from '../../../plugins/via-servers';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import {
  getRoomNotificationMode,
  useRoomsNotificationPreferencesContext,
} from '../../../hooks/useRoomsNotificationPreferences';
import { CallNavStatus } from '../../../features/room-nav/RoomCallNavStatus';
import { useRoomListKeyboard } from '../../../hooks/useRoomListKeyboard';
import { RoomListbox } from '../../../components/room-listbox/RoomListbox';
import { searchModalAtom, searchModalInitialCharAtom } from '../../../state/searchModal';
import { useOpenSpaceSettings } from '../../../state/hooks/spaceSettings';
import { useRoomNavigate } from '../../../hooks/useRoomNavigate';
import { usePendingBucketJump, usePublishCurrentView } from '../../../hooks/useNavigateUnread';
import { useRoomCreators } from '../../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../../hooks/useRoomPermissions';
import { ContainerColor } from '../../../styles/ContainerColor.css';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { BreakWord } from '../../../styles/Text.css';
import { InviteUserPrompt } from '../../../components/invite-user-prompt';
import { useCallEmbed } from '../../../hooks/useCallEmbed';

type SpaceMenuProps = {
  room: Room;
  requestClose: () => void;
};
const SpaceMenu = forwardRef<HTMLDivElement, SpaceMenuProps>(({ room, requestClose }, ref) => {
  const mx = useMatrixClient();
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const [developerTools] = useSetting(settingsAtom, 'developerTools');
  const [roomSortOrder, setRoomSortOrder] = useSetting(settingsAtom, 'roomSortOrder');
  const roomToParents = useAtomValue(roomToParentsAtom);
  const powerLevels = usePowerLevels(room);
  const creators = useRoomCreators(room);

  const permissions = useRoomPermissions(creators, powerLevels);
  const canInvite = permissions.action('invite', mx.getSafeUserId());
  const openSpaceSettings = useOpenSpaceSettings();
  const { navigateRoom } = useRoomNavigate();

  const [invitePrompt, setInvitePrompt] = useState(false);

  const allChild = useSpaceChildren(
    allRoomsAtom,
    room.roomId,
    useRecursiveChildScopeFactory(mx, roomToParents)
  );
  const unread = useRoomsUnread(allChild, roomToUnreadAtom);

  const handleMarkAsRead = () => {
    allChild.forEach((childRoomId) => markAsRead(mx, childRoomId, hideActivity));
    requestClose();
  };

  const handleCopyLink = () => {
    const roomIdOrAlias = getCanonicalAliasOrRoomId(mx, room.roomId);
    const viaServers = isRoomAlias(roomIdOrAlias) ? undefined : getViaServers(room);
    copyToClipboard(getMatrixToRoom(roomIdOrAlias, viaServers));
    requestClose();
  };

  const handleInvite = () => {
    setInvitePrompt(true);
  };

  const handleRoomSettings = () => {
    openSpaceSettings(room.roomId);
    requestClose();
  };

  const handleOpenTimeline = () => {
    navigateRoom(room.roomId);
    requestClose();
  };

  return (
    <Menu ref={ref} style={{ maxWidth: toRem(160), width: '100vw' }}>
      <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
        {invitePrompt && room && (
          <InviteUserPrompt
            room={room}
            requestClose={() => {
              setInvitePrompt(false);
              requestClose();
            }}
          />
        )}
        <MenuItem
          onClick={() => setRoomSortOrder('admin')}
          size="300"
          after={roomSortOrder === 'admin' ? <Icon size="100" src={Icons.Check} /> : undefined}
          radii="300"
        >
          <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
            Admin Order
          </Text>
        </MenuItem>
        <MenuItem
          onClick={() => setRoomSortOrder('activity')}
          size="300"
          after={roomSortOrder === 'activity' ? <Icon size="100" src={Icons.Check} /> : undefined}
          radii="300"
        >
          <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
            Sort by Activity
          </Text>
        </MenuItem>
        <MenuItem
          onClick={() => setRoomSortOrder('az')}
          size="300"
          after={roomSortOrder === 'az' ? <Icon size="100" src={Icons.Check} /> : undefined}
          radii="300"
        >
          <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
            Sort A-Z
          </Text>
        </MenuItem>
        <MenuItem
          onClick={() => setRoomSortOrder('unread')}
          size="300"
          after={roomSortOrder === 'unread' ? <Icon size="100" src={Icons.Check} /> : undefined}
          radii="300"
        >
          <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
            Unread First
          </Text>
        </MenuItem>
        <Line variant="Surface" size="300" />
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
            Space Settings
          </Text>
        </MenuItem>
        {developerTools && (
          <MenuItem
            onClick={handleOpenTimeline}
            size="300"
            after={<Icon size="100" src={Icons.Terminal} />}
            radii="300"
          >
            <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
              Event Timeline
            </Text>
          </MenuItem>
        )}
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
                  Leave Space
                </Text>
              </MenuItem>
              {promptLeave && (
                <LeaveSpacePrompt
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

function SpaceHeader() {
  const space = useSpace();
  const spaceName = useRoomName(space);
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();

  const joinRules = useStateEvent(
    space,
    StateEvent.RoomJoinRules
  )?.getContent<RoomJoinRulesEventContent>();

  const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    const cords = evt.currentTarget.getBoundingClientRect();
    setMenuAnchor((currentState) => {
      if (currentState) return undefined;
      return cords;
    });
  };

  return (
    <>
      <PageNavHeader>
        <Box alignItems="Center" grow="Yes" gap="300">
          <Box grow="Yes" alignItems="Center" gap="100">
            <Text size="H4" truncate>
              {spaceName}
            </Text>
            {joinRules?.join_rule !== JoinRule.Public && <Icon src={Icons.Lock} size="50" />}
          </Box>
          <Box shrink="No">
            <IconButton aria-pressed={!!menuAnchor} variant="Background" onClick={handleOpenMenu}>
              <Icon src={Icons.VerticalDots} size="200" />
            </IconButton>
          </Box>
        </Box>
      </PageNavHeader>
      {menuAnchor && (
        <PopOut
          anchor={menuAnchor}
          position="Bottom"
          align="End"
          offset={6}
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
              <SpaceMenu room={space} requestClose={() => setMenuAnchor(undefined)} />
            </FocusTrap>
          }
        />
      )}
    </>
  );
}

type SpaceTombstoneProps = { roomId: string; replacementRoomId: string };
export function SpaceTombstone({ roomId, replacementRoomId }: SpaceTombstoneProps) {
  const mx = useMatrixClient();
  const { navigateSpace } = useRoomNavigate();

  const [joinState, handleJoin] = useAsyncCallback(
    useCallback(() => {
      const currentRoom = mx.getRoom(roomId);
      const via = currentRoom ? getViaServers(currentRoom) : [];
      return mx.joinRoom(replacementRoomId, {
        viaServers: via,
      });
    }, [mx, roomId, replacementRoomId])
  );
  const replacementRoom = mx.getRoom(replacementRoomId);

  const handleOpen = () => {
    if (replacementRoom) navigateSpace(replacementRoom.roomId);
    if (joinState.status === AsyncStatus.Success) navigateSpace(joinState.data.roomId);
  };

  return (
    <Box
      style={{
        padding: config.space.S200,
        borderRadius: config.radii.R400,
        borderWidth: config.borderWidth.B300,
      }}
      className={ContainerColor({ variant: 'Surface' })}
      direction="Column"
      gap="300"
    >
      <Box direction="Column" grow="Yes" gap="100">
        <Text size="L400">Space Upgraded</Text>
        <Text size="T200">This space has been replaced and is no longer active.</Text>
        {joinState.status === AsyncStatus.Error && (
          <Text className={BreakWord} style={{ color: color.Critical.Main }} size="T200">
            {(joinState.error as any)?.message ?? 'Failed to join replacement space!'}
          </Text>
        )}
      </Box>
      <Box direction="Column" shrink="No">
        {replacementRoom?.getMyMembership() === Membership.Join ||
        joinState.status === AsyncStatus.Success ? (
          <Button onClick={handleOpen} size="300" variant="Success" fill="Solid" radii="300">
            <Text size="B300">Open New Space</Text>
          </Button>
        ) : (
          <Button
            onClick={handleJoin}
            size="300"
            variant="Primary"
            fill="Solid"
            radii="300"
            before={
              joinState.status === AsyncStatus.Loading && (
                <Spinner size="100" variant="Primary" fill="Solid" />
              )
            }
            disabled={joinState.status === AsyncStatus.Loading}
          >
            <Text size="B300">Join New Space</Text>
          </Button>
        )}
      </Box>
    </Box>
  );
}

export function Space() {
  const mx = useMatrixClient();
  const space = useSpace();
  useNavToActivePathMapper(space.roomId);
  const spaceIdOrAlias = getCanonicalAliasOrRoomId(mx, space.roomId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mDirects = useAtomValue(mDirectAtom);
  const roomToUnread = useAtomValue(roomToUnreadAtom);
  const allRooms = useAtomValue(allRoomsAtom);
  const allJoinedRooms = useMemo(() => new Set(allRooms), [allRooms]);
  const notificationPreferences = useRoomsNotificationPreferencesContext();

  const tombstoneEvent = useStateEvent(space, StateEvent.RoomTombstone);
  const selectedRoomId = useSelectedRoom();
  const lobbySelected = useSpaceLobbySelected(spaceIdOrAlias);
  const searchSelected = useSpaceSearchSelected(spaceIdOrAlias);
  const callEmbed = useCallEmbed();

  const [closedCategories, setClosedCategories] = useAtom(useClosedNavCategoriesAtom());

  const [roomSortOrder] = useSetting(settingsAtom, 'roomSortOrder');

  const getRoom = useCallback(
    (rId: string): Room | undefined => {
      if (allJoinedRooms.has(rId)) {
        return mx.getRoom(rId) ?? undefined;
      }
      return undefined;
    },
    [mx, allJoinedRooms]
  );

  const sortSpaceRoomItems = useCallback(
    (_parentId: string, items: HierarchyItem[]): HierarchyItem[] => {
      const sorted = [...items];
      if (roomSortOrder === 'activity') {
        sorted.sort((a, b) => factoryRoomIdByActivity(mx)(a.roomId, b.roomId));
      } else if (roomSortOrder === 'az') {
        sorted.sort((a, b) => factoryRoomIdByAtoZ(mx)(a.roomId, b.roomId));
      } else if (roomSortOrder === 'unread') {
        sorted.sort((a, b) =>
          factoryRoomIdByUnreadFirst(
            (id) => roomToUnread.get(id)?.highlight ?? 0,
            (id) => roomToUnread.get(id)?.total ?? 0,
            factoryRoomIdByActivity(mx)
          )(a.roomId, b.roomId)
        );
      } else {
        // Default: preserve space admin ordering (order key + timestamp)
        sorted.sort((a, b) => byTsOldToNew(a.ts, b.ts));
        sorted.sort((a, b) => byOrderKey(a.content.order, b.content.order));
      }
      return sorted;
    },
    [mx, roomSortOrder, roomToUnread]
  );

  const hierarchy = useSpaceJoinedHierarchy(
    space.roomId,
    getRoom,
    useCallback(
      (parentId, roomId) => {
        if (!closedCategories.has(makeNavCategoryId(space.roomId, parentId))) {
          return false;
        }
        const showRoomAnyway =
          roomToUnread.has(roomId) || roomId === selectedRoomId || callEmbed?.roomId === roomId;
        return !showRoomAnyway;
      },
      [space.roomId, closedCategories, roomToUnread, selectedRoomId, callEmbed]
    ),
    sortSpaceRoomItems
  );

  // Virtual "Unread" group: when roomSortOrder==='unread' and the space has sub-spaces,
  // hoist all unread rooms from every sub-space into a single group at the top.
  // When a room becomes read, it disappears from the virtual group and returns to its sub-space.
  const VIRTUAL_UNREAD_ID = '__virtual-unread__';
  const displayHierarchy = useMemo((): HierarchyItem[] => {
    if (roomSortOrder !== 'unread') return hierarchy;
    // Only activate virtual group when there's more than one space section
    const hasSubSpaces = hierarchy.some(
      (item) => 'space' in item && item.space && item.roomId !== space.roomId
    );
    if (!hasSubSpaces) return hierarchy;

    // Collect all unread non-space rooms from any sub-space
    const unreadItems = hierarchy.filter(
      (item) => !('space' in item && item.space) && roomToUnread.has(item.roomId)
    );
    if (unreadItems.length === 0) return hierarchy;

    // Sort unread rooms: highlights first, then total, then activity
    const sortFn = factoryRoomIdByUnreadFirst(
      (id) => roomToUnread.get(id)?.highlight ?? 0,
      (id) => roomToUnread.get(id)?.total ?? 0,
      factoryRoomIdByActivity(mx)
    );
    const sortedUnread = [...unreadItems].sort((a, b) => sortFn(a.roomId, b.roomId));
    const unreadSet = new Set(sortedUnread.map((i) => i.roomId));

    // Virtual header item — roomId is a sentinel, not a real room
    const virtualHeader = {
      roomId: VIRTUAL_UNREAD_ID,
      content: {},
      ts: 0,
      space: true,
    } as unknown as HierarchyItem;

    // When the virtual group is collapsed, hide its rooms too
    const virtualGroupClosed = closedCategories.has(
      makeNavCategoryId(space.roomId, VIRTUAL_UNREAD_ID)
    );

    // Remaining hierarchy: keep all space headers + read rooms.
    // Sub-space headers whose rooms are all in the virtual group still appear —
    // rooms will bounce back to them once read.
    const remaining = hierarchy.filter(
      (item) => 'space' in item && item.space ? true : !unreadSet.has(item.roomId)
    );

    return [
      virtualHeader,
      ...(virtualGroupClosed ? [] : sortedUnread),
      ...remaining,
    ];
  }, [hierarchy, roomSortOrder, roomToUnread, mx, space.roomId, closedCategories]);

  const virtualizer = useVirtualizer({
    count: displayHierarchy.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 0,
    overscan: 10,
    getItemKey: (index) => displayHierarchy[index]?.roomId ?? index,
  });

  const roomsOnly = useMemo(
    () =>
      displayHierarchy
        .filter(({ roomId }) => {
          const r = mx.getRoom(roomId);
          return r && !r.isSpaceRoom();
        })
        .map(({ roomId }) => roomId),
    [displayHierarchy, mx]
  );

  const allSpaceRoomIds = useMemo(
    () =>
      hierarchy
        .filter(({ roomId }) => {
          const r = mx.getRoom(roomId);
          return r && !r.isSpaceRoom();
        })
        .map(({ roomId }) => roomId),
    [hierarchy, mx]
  );
  const spaceFavoriteRoomIds = useFavoriteRooms(allSpaceRoomIds);
  const SPACE_FAVORITES_CATEGORY_ID = makeNavCategoryId(space.roomId, '__favorites__');

  const { navigateRoom } = useRoomNavigate();
  const navigate = useNavigate();
  // Space-bound navigator so a cross-bucket jump into THIS space lands
  // in this space's URL, not whatever orphan parent navigateRoom would
  // pick (which can route to a different sidebar bucket entirely).
  const navigateInBucket = useCallback(
    (roomId: string) => navigate(getSpaceRoomPath(spaceIdOrAlias, getCanonicalAliasOrRoomId(mx, roomId))),
    [navigate, mx, spaceIdOrAlias]
  );
  // Publish the displayed list to useNavigateUnread + drain any
  // pending cross-bucket jump.
  usePublishCurrentView(space.roomId, roomsOnly);
  usePendingBucketJump(space.roomId, roomsOnly, navigateInBucket);

  const setSearchModal = useSetAtom(searchModalAtom);
  const setSearchInitialChar = useSetAtom(searchModalInitialCharAtom);

  const keyboardNav = useRoomListKeyboard({
    items: roomsOnly,
    selectedRoomId,
    virtualizer,
    onNavigate: (roomId) => navigateRoom(roomId),
    onTypeChar: (key) => { setSearchInitialChar(key); setSearchModal(true); },
  });

  const handleCategoryClick = useCategoryHandler(setClosedCategories, (categoryId) =>
    closedCategories.has(categoryId)
  );

  const displayHierarchyRef = useRef(displayHierarchy);
  displayHierarchyRef.current = displayHierarchy;
  useEffect(() => {
    if (!selectedRoomId) return;
    const idx = displayHierarchyRef.current.findIndex((item) => item.roomId === selectedRoomId);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'auto' });
  }, [selectedRoomId, virtualizer]);

  const getToLink = (roomId: string) =>
    getSpaceRoomPath(spaceIdOrAlias, getCanonicalAliasOrRoomId(mx, roomId));
  return (
    <PageNav>
      <SpaceHeader />
      <PageNavContent scrollRef={scrollRef}>
        <Box direction="Column" gap="300">
          {tombstoneEvent && (
            <SpaceTombstone
              roomId={space.roomId}
              replacementRoomId={tombstoneEvent.getContent().replacement_room}
            />
          )}
          <NavCategory>
            <NavItem variant="Background" radii="400" aria-selected={lobbySelected}>
              <NavLink to={getSpaceLobbyPath(getCanonicalAliasOrRoomId(mx, space.roomId))}>
                <NavItemContent>
                  <Box as="span" grow="Yes" alignItems="Center" gap="200">
                    <Avatar size="200" radii="400">
                      <Icon src={Icons.Flag} size="100" filled={lobbySelected} />
                    </Avatar>
                    <Box as="span" grow="Yes">
                      <Text as="span" size="Inherit" truncate>
                        Lobby
                      </Text>
                    </Box>
                  </Box>
                </NavItemContent>
              </NavLink>
            </NavItem>
            <NavItem variant="Background" radii="400" aria-selected={searchSelected}>
              <NavLink to={getSpaceSearchPath(getCanonicalAliasOrRoomId(mx, space.roomId))}>
                <NavItemContent>
                  <Box as="span" grow="Yes" alignItems="Center" gap="200">
                    <Avatar size="200" radii="400">
                      <Icon src={Icons.Search} size="100" filled={searchSelected} />
                    </Avatar>
                    <Box as="span" grow="Yes">
                      <Text as="span" size="Inherit" truncate>
                        Message Search
                      </Text>
                    </Box>
                  </Box>
                </NavItemContent>
              </NavLink>
            </NavItem>
          </NavCategory>
          {spaceFavoriteRoomIds.length > 0 && (
            <NavCategory>
              <NavCategoryHeader>
                <RoomNavCategoryButton
                  closed={closedCategories.has(SPACE_FAVORITES_CATEGORY_ID)}
                  data-category-id={SPACE_FAVORITES_CATEGORY_ID}
                  onClick={handleCategoryClick}
                >
                  Favorites
                </RoomNavCategoryButton>
              </NavCategoryHeader>
              {!closedCategories.has(SPACE_FAVORITES_CATEGORY_ID) &&
                spaceFavoriteRoomIds.map((roomId) => {
                  const room = mx.getRoom(roomId);
                  if (!room) return null;
                  return (
                    <RoomNavItem
                      key={roomId}
                      room={room}
                      selected={selectedRoomId === roomId}
                      focused={false}
                      optionId={`room-option-fav-${roomId}`}
                      linkPath={getSpaceRoomPath(spaceIdOrAlias, getCanonicalAliasOrRoomId(mx, roomId))}
                      notificationMode={getRoomNotificationMode(notificationPreferences, roomId)}
                    />
                  );
                })}
            </NavCategory>
          )}
          <RoomListbox
            aria-label="Space rooms"
            items={roomsOnly}
            focusedIndex={keyboardNav.focusedIndex}
          >
            <NavCategory
              style={{
                height: virtualizer.getTotalSize(),
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((vItem) => {
                const { roomId } = hierarchy[vItem.index] ?? {};
                const room = mx.getRoom(roomId);
                if (!room) return null;

                if (room.isSpaceRoom()) {
                  const categoryId = makeNavCategoryId(space.roomId, roomId);

                  return (
                    <VirtualTile
                      virtualItem={vItem}
                      key={vItem.key}
                      ref={virtualizer.measureElement}
                    >
                      <div style={{ paddingTop: vItem.index === 0 ? undefined : config.space.S400 }}>
                        <NavCategoryHeader>
                          <RoomNavCategoryButton
                            data-category-id={categoryId}
                            onClick={handleCategoryClick}
                            closed={closedCategories.has(categoryId)}
                          >
                            {roomId === space.roomId ? 'Rooms' : room?.name}
                          </RoomNavCategoryButton>
                        </NavCategoryHeader>
                      </div>
                    </VirtualTile>
                  );
                }

                const roomIdx = roomsOnly.indexOf(roomId);
                return (
                  <VirtualTile virtualItem={vItem} key={vItem.key} ref={virtualizer.measureElement}>
                    <RoomNavItem
                      room={room}
                      selected={selectedRoomId === roomId}
                      focused={roomIdx >= 0 && keyboardNav.focusedIndex === roomIdx}
                      optionId={`room-option-${roomId}`}
                      showAvatar={mDirects.has(roomId)}
                      direct={mDirects.has(roomId)}
                      linkPath={getToLink(roomId)}
                      notificationMode={getRoomNotificationMode(notificationPreferences, room.roomId)}
                    />
                  </VirtualTile>
                );
              })}
            </NavCategory>
          </RoomListbox>
        </Box>
      </PageNavContent>
      <CallNavStatus />
    </PageNav>
  );
}
