import React, { MouseEventHandler, forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Text,
  config,
  toRem,
} from 'folds';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import FocusTrap from 'focus-trap-react';
import { factoryRoomIdByActivity, factoryRoomIdByAtoZ, factoryRoomIdByUnreadFirst } from '../../../utils/sort';
import {
  NavButton,
  NavCategory,
  NavCategoryHeader,
  NavEmptyCenter,
  NavEmptyLayout,
  NavItem,
  NavItemContent,
  NavLink,
} from '../../../components/nav';
import {
  encodeSearchParamValueArray,
  getExplorePath,
  getHomeCreatePath,
  getHomeRoomPath,
  getHomeSearchPath,
  withSearchParam,
} from '../../pathUtils';
import { getCanonicalAliasOrRoomId } from '../../../utils/matrix';
import { useSelectedRoom } from '../../../hooks/router/useSelectedRoom';
import {
  useHomeCreateSelected,
  useHomeSearchSelected,
} from '../../../hooks/router/useHomeSelected';
import { useHomeRooms } from './useHomeRooms';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { VirtualTile } from '../../../components/virtualizer';
import { RoomNavCategoryButton, RoomNavItem } from '../../../features/room-nav';
import { makeNavCategoryId } from '../../../state/closedNavCategories';
import { roomToUnreadAtom } from '../../../state/room/roomToUnread';
import { useCategoryHandler } from '../../../hooks/useCategoryHandler';
import { useNavToActivePathMapper } from '../../../hooks/useNavToActivePathMapper';
import { PageNav, PageNavHeader, PageNavContent } from '../../../components/page';
import { useRoomsUnread } from '../../../state/hooks/unread';
import { markAsRead } from '../../../utils/notifications';
import { useClosedNavCategoriesAtom } from '../../../state/hooks/closedNavCategories';
import { stopPropagation } from '../../../utils/keyboard';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import {
  getRoomNotificationMode,
  useRoomsNotificationPreferencesContext,
} from '../../../hooks/useRoomsNotificationPreferences';
import { CallNavStatus } from '../../../features/room-nav/RoomCallNavStatus';
import { useRoomListKeyboard } from '../../../hooks/useRoomListKeyboard';
import { searchModalAtom, searchModalInitialCharAtom } from '../../../state/searchModal';
import { RoomListbox } from '../../../components/room-listbox/RoomListbox';
import { useRoomNavigate } from '../../../hooks/useRoomNavigate';
import {
  NAV_HOME_BUCKET,
  usePendingBucketJump,
  usePublishCurrentView,
} from '../../../hooks/useNavigateUnread';
import { UseStateProvider } from '../../../components/UseStateProvider';
import { JoinAddressPrompt } from '../../../components/join-address-prompt';
import { _RoomSearchParams } from '../../paths';
import { useFavoriteRooms } from '../../../hooks/useFavoriteRooms';

type HomeMenuProps = {
  requestClose: () => void;
};
const HomeMenu = forwardRef<HTMLDivElement, HomeMenuProps>(({ requestClose }, ref) => {
  const orphanRooms = useHomeRooms();
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const unread = useRoomsUnread(orphanRooms, roomToUnreadAtom);
  const mx = useMatrixClient();
  const [roomSortOrder, setRoomSortOrder] = useSetting(settingsAtom, 'roomSortOrder');

  const handleMarkAsRead = () => {
    if (!unread) return;
    orphanRooms.forEach((rId) => markAsRead(mx, rId, hideActivity));
    requestClose();
  };

  return (
    <Menu ref={ref} style={{ maxWidth: toRem(160), width: '100vw' }}>
      <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
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
          aria-disabled={!unread}
        >
          <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
            Mark as Read
          </Text>
        </MenuItem>
      </Box>
    </Menu>
  );
});

function HomeHeader() {
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();

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
          <Box grow="Yes">
            <Text size="H4" truncate>
              Home
            </Text>
          </Box>
          <Box>
            <IconButton aria-pressed={!!menuAnchor} variant="Background" onClick={handleOpenMenu}>
              <Icon src={Icons.VerticalDots} size="200" />
            </IconButton>
          </Box>
        </Box>
      </PageNavHeader>
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
            <HomeMenu requestClose={() => setMenuAnchor(undefined)} />
          </FocusTrap>
        }
      />
    </>
  );
}

function HomeEmpty() {
  const navigate = useNavigate();

  return (
    <NavEmptyCenter>
      <NavEmptyLayout
        icon={<Icon size="600" src={Icons.Hash} />}
        title={
          <Text size="H5" align="Center">
            No Rooms
          </Text>
        }
        content={
          <Text size="T300" align="Center">
            You do not have any rooms yet.
          </Text>
        }
        options={
          <>
            <Button onClick={() => navigate(getHomeCreatePath())} variant="Secondary" size="300">
              <Text size="B300" truncate>
                Create Room
              </Text>
            </Button>
            <Button
              onClick={() => navigate(getExplorePath())}
              variant="Secondary"
              fill="Soft"
              size="300"
            >
              <Text size="B300" truncate>
                Explore Community Rooms
              </Text>
            </Button>
          </>
        }
      />
    </NavEmptyCenter>
  );
}

const DEFAULT_CATEGORY_ID = makeNavCategoryId('home', 'room');
const FAVORITES_CATEGORY_ID = makeNavCategoryId('home', 'favorites');
export function Home() {
  const mx = useMatrixClient();
  useNavToActivePathMapper('home');
  const scrollRef = useRef<HTMLDivElement>(null);
  const rooms = useHomeRooms();
  const notificationPreferences = useRoomsNotificationPreferencesContext();
  const roomToUnread = useAtomValue(roomToUnreadAtom);
  const navigate = useNavigate();

  const selectedRoomId = useSelectedRoom();
  const createRoomSelected = useHomeCreateSelected();
  const searchSelected = useHomeSearchSelected();
  const noRoomToDisplay = rooms.length === 0;
  const [closedCategories, setClosedCategories] = useAtom(useClosedNavCategoriesAtom());
  const [roomSortOrder] = useSetting(settingsAtom, 'roomSortOrder');

  const favoriteRoomIds = useFavoriteRooms(rooms);
  const favoriteRoomIdsSet = useMemo(() => new Set(favoriteRoomIds), [favoriteRoomIds]);

  const sortedRooms = useMemo(() => {
    let sortFn;
    if (roomSortOrder === 'az') {
      sortFn = factoryRoomIdByAtoZ(mx);
    } else if (roomSortOrder === 'unread') {
      sortFn = factoryRoomIdByUnreadFirst(
        (id) => roomToUnread.get(id)?.highlight ?? 0,
        (id) => roomToUnread.get(id)?.total ?? 0,
        factoryRoomIdByActivity(mx)
      );
    } else {
      sortFn = factoryRoomIdByActivity(mx);
    }
    const items = Array.from(rooms).sort(sortFn).filter((rId) => !favoriteRoomIdsSet.has(rId));
    if (closedCategories.has(DEFAULT_CATEGORY_ID)) {
      return items.filter((rId) => roomToUnread.has(rId) || rId === selectedRoomId);
    }
    return items;
  }, [mx, rooms, closedCategories, roomToUnread, selectedRoomId, roomSortOrder, favoriteRoomIdsSet]);

  const virtualizer = useVirtualizer({
    count: sortedRooms.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 38,
    overscan: 10,
    getItemKey: (index) => sortedRooms[index],
  });

  const { navigateRoom } = useRoomNavigate();
  // Publish the displayed list to useNavigateUnread + drain any
  // pending cross-bucket jump. Use a Home-bound navigator so the jump
  // honours the bucket the user clicked towards (otherwise navigateRoom
  // would re-pick a parent space and could land us in a different bucket).
  const navigateInBucket = useCallback(
    (roomId: string) => navigate(getHomeRoomPath(getCanonicalAliasOrRoomId(mx, roomId))),
    [navigate, mx]
  );
  // Favorites are rendered above the main list as a separate section
  // and are filtered out of sortedRooms. Include them at the front of
  // the published view so prev/next can step to unread favorites
  // (otherwise bucketHasUnread sees them but the visible list doesn't,
  // causing a cross-bucket jump loop).
  const navigableRooms = useMemo(() => {
    if (favoriteRoomIds.length === 0) return sortedRooms;
    return [...favoriteRoomIds, ...sortedRooms];
  }, [favoriteRoomIds, sortedRooms]);
  usePublishCurrentView(NAV_HOME_BUCKET, navigableRooms);
  usePendingBucketJump(NAV_HOME_BUCKET, navigableRooms, navigateInBucket);

  const setSearchModal = useSetAtom(searchModalAtom);
  const setSearchInitialChar = useSetAtom(searchModalInitialCharAtom);

  const keyboardNav = useRoomListKeyboard({
    items: sortedRooms,
    selectedRoomId,
    virtualizer,
    onNavigate: (roomId) => navigateRoom(roomId),
    onTypeChar: (key) => { setSearchInitialChar(key); setSearchModal(true); },
  });

  const handleCategoryClick = useCategoryHandler(setClosedCategories, (categoryId) =>
    closedCategories.has(categoryId)
  );

  return (
    <PageNav>
      <HomeHeader />
      {noRoomToDisplay ? (
        <HomeEmpty />
      ) : (
        <PageNavContent scrollRef={scrollRef}>
          <Box direction="Column" gap="300">
            <NavCategory>
              <NavItem variant="Background" radii="400" aria-selected={createRoomSelected}>
                <NavButton onClick={() => navigate(getHomeCreatePath())}>
                  <NavItemContent>
                    <Box as="span" grow="Yes" alignItems="Center" gap="200">
                      <Avatar size="200" radii="400">
                        <Icon src={Icons.Plus} size="100" />
                      </Avatar>
                      <Box as="span" grow="Yes">
                        <Text as="span" size="Inherit" truncate>
                          Create Room
                        </Text>
                      </Box>
                    </Box>
                  </NavItemContent>
                </NavButton>
              </NavItem>
              <UseStateProvider initial={false}>
                {(open, setOpen) => (
                  <>
                    <NavItem variant="Background" radii="400">
                      <NavButton onClick={() => setOpen(true)}>
                        <NavItemContent>
                          <Box as="span" grow="Yes" alignItems="Center" gap="200">
                            <Avatar size="200" radii="400">
                              <Icon src={Icons.Link} size="100" />
                            </Avatar>
                            <Box as="span" grow="Yes">
                              <Text as="span" size="Inherit" truncate>
                                Join with Address
                              </Text>
                            </Box>
                          </Box>
                        </NavItemContent>
                      </NavButton>
                    </NavItem>
                    {open && (
                      <JoinAddressPrompt
                        onCancel={() => setOpen(false)}
                        onOpen={(roomIdOrAlias, viaServers, eventId) => {
                          setOpen(false);
                          const path = getHomeRoomPath(roomIdOrAlias, eventId);
                          navigate(
                            viaServers
                              ? withSearchParam<_RoomSearchParams>(path, {
                                  viaServers: encodeSearchParamValueArray(viaServers),
                                })
                              : path
                          );
                        }}
                      />
                    )}
                  </>
                )}
              </UseStateProvider>
              <NavItem variant="Background" radii="400" aria-selected={searchSelected}>
                <NavLink to={getHomeSearchPath()}>
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
            {favoriteRoomIds.length > 0 && (
              <NavCategory>
                <NavCategoryHeader>
                  <RoomNavCategoryButton
                    closed={closedCategories.has(FAVORITES_CATEGORY_ID)}
                    data-category-id={FAVORITES_CATEGORY_ID}
                    onClick={handleCategoryClick}
                  >
                    Favorites
                  </RoomNavCategoryButton>
                </NavCategoryHeader>
                {!closedCategories.has(FAVORITES_CATEGORY_ID) &&
                  favoriteRoomIds.map((roomId) => {
                    const room = mx.getRoom(roomId);
                    if (!room) return null;
                    return (
                      <RoomNavItem
                        key={roomId}
                        room={room}
                        selected={selectedRoomId === roomId}
                        focused={false}
                        optionId={`room-option-fav-${roomId}`}
                        linkPath={getHomeRoomPath(getCanonicalAliasOrRoomId(mx, roomId))}
                        notificationMode={getRoomNotificationMode(notificationPreferences, roomId)}
                      />
                    );
                  })}
              </NavCategory>
            )}
            <NavCategory>
              <NavCategoryHeader>
                <RoomNavCategoryButton
                  closed={closedCategories.has(DEFAULT_CATEGORY_ID)}
                  data-category-id={DEFAULT_CATEGORY_ID}
                  onClick={handleCategoryClick}
                >
                  Rooms
                </RoomNavCategoryButton>
              </NavCategoryHeader>
              <RoomListbox
                aria-label="Rooms"
                items={sortedRooms}
                focusedIndex={keyboardNav.focusedIndex}
              >
                <div
                  style={{
                    position: 'relative',
                    height: virtualizer.getTotalSize(),
                  }}
                >
                  {virtualizer.getVirtualItems().map((vItem) => {
                    const roomId = sortedRooms[vItem.index];
                    const room = mx.getRoom(roomId);
                    if (!room) return null;
                    const selected = selectedRoomId === roomId;

                    return (
                      <VirtualTile
                        virtualItem={vItem}
                        key={vItem.key}
                        ref={virtualizer.measureElement}
                      >
                        <RoomNavItem
                          room={room}
                          selected={selected}
                          focused={keyboardNav.focusedIndex === vItem.index}
                          optionId={`room-option-${roomId}`}
                          linkPath={getHomeRoomPath(getCanonicalAliasOrRoomId(mx, roomId))}
                          notificationMode={getRoomNotificationMode(
                            notificationPreferences,
                            room.roomId
                          )}
                        />
                      </VirtualTile>
                    );
                  })}
                </div>
              </RoomListbox>
            </NavCategory>
          </Box>
        </PageNavContent>
      )}
      <CallNavStatus />
    </PageNav>
  );
}
