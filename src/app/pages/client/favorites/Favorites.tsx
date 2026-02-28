import React, { useMemo, useRef } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { Avatar, Box, Icon, Icons, Text } from 'folds';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { mDirectAtom } from '../../../state/mDirectList';
import { roomToParentsAtom } from '../../../state/room/roomToParents';
import { useFavoriteRooms } from '../../../hooks/useFavoriteRooms';
import { useNavToActivePathMapper } from '../../../hooks/useNavToActivePathMapper';
import { useSelectedRoom } from '../../../hooks/router/useSelectedRoom';
import {
  getRoomNotificationMode,
  useRoomsNotificationPreferencesContext,
} from '../../../hooks/useRoomsNotificationPreferences';
import { makeNavCategoryId } from '../../../state/closedNavCategories';
import { useClosedNavCategoriesAtom } from '../../../state/hooks/closedNavCategories';
import { useCategoryHandler } from '../../../hooks/useCategoryHandler';
import { RoomNavItem, RoomNavCategoryButton } from '../../../features/room-nav';
import {
  NavCategory,
  NavCategoryHeader,
  NavEmptyCenter,
  NavEmptyLayout,
  NavItemContent,
} from '../../../components/nav';
import { PageNav, PageNavContent, PageNavHeader } from '../../../components/page';
import { getFavoritesRoomPath } from '../../pathUtils';
import { getCanonicalAliasOrRoomId } from '../../../utils/matrix';

const DM_CATEGORY_ID = makeNavCategoryId('favorites', 'dm');
const ROOMS_CATEGORY_ID = makeNavCategoryId('favorites', 'rooms');

export function Favorites() {
  const mx = useMatrixClient();
  useNavToActivePathMapper('favorites');
  const scrollRef = useRef<HTMLDivElement>(null);

  const allRooms = useAtomValue(allRoomsAtom);
  const mDirects = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const notificationPreferences = useRoomsNotificationPreferencesContext();
  const selectedRoomId = useSelectedRoom();

  const [closedCategories, setClosedCategories] = useAtom(useClosedNavCategoriesAtom());

  const allFavoriteIds = useFavoriteRooms(allRooms);

  const { dmFavorites, spaceFavoritesMap, orphanFavorites } = useMemo(() => {
    const dms: string[] = [];
    const spaces = new Map<string, string[]>();
    const orphans: string[] = [];

    allFavoriteIds.forEach((id) => {
      if (mDirects.has(id)) {
        dms.push(id);
        return;
      }
      const parents = roomToParents.get(id);
      if (parents && parents.size > 0) {
        let addedToSpace = false;
        parents.forEach((spaceId) => {
          if (mx.getRoom(spaceId)?.getMyMembership() === 'join') {
            const existing = spaces.get(spaceId) ?? [];
            existing.push(id);
            spaces.set(spaceId, existing);
            addedToSpace = true;
          }
        });
        if (!addedToSpace) {
          orphans.push(id);
        }
      } else {
        orphans.push(id);
      }
    });

    return { dmFavorites: dms, spaceFavoritesMap: spaces, orphanFavorites: orphans };
  }, [allFavoriteIds, mDirects, roomToParents, mx]);

  const handleCategoryClick = useCategoryHandler(setClosedCategories, (categoryId) =>
    closedCategories.has(categoryId)
  );

  return (
    <PageNav>
      <PageNavHeader>
        <Box alignItems="Center" grow="Yes" gap="300">
          <Box grow="Yes">
            <Text size="H4" as="h1" truncate>
              Favorites
            </Text>
          </Box>
        </Box>
      </PageNavHeader>
      {allFavoriteIds.length === 0 ? (
        <NavEmptyCenter>
          <NavEmptyLayout
            icon={<Icon size="600" src={Icons.Star} />}
            title={
              <Text size="H5" as="h2" align="Center">
                No Favorites
              </Text>
            }
            content={
              <Text size="T300" align="Center">
                Right-click any room to add it to favorites.
              </Text>
            }
          />
        </NavEmptyCenter>
      ) : (
        <PageNavContent scrollRef={scrollRef}>
          <Box direction="Column" gap="300">
            {dmFavorites.length > 0 && (
              <NavCategory>
                <NavCategoryHeader>
                  <RoomNavCategoryButton
                    closed={closedCategories.has(DM_CATEGORY_ID)}
                    data-category-id={DM_CATEGORY_ID}
                    onClick={handleCategoryClick}
                  >
                    Direct Messages
                  </RoomNavCategoryButton>
                </NavCategoryHeader>
                {!closedCategories.has(DM_CATEGORY_ID) &&
                  dmFavorites.map((roomId) => {
                    const room = mx.getRoom(roomId);
                    if (!room) return null;
                    return (
                      <RoomNavItem
                        key={roomId}
                        room={room}
                        selected={selectedRoomId === roomId}
                        focused={false}
                        optionId={`room-option-fav-${roomId}`}
                        tabIndex={0}
                        showAvatar
                        direct
                        linkPath={getFavoritesRoomPath(getCanonicalAliasOrRoomId(mx, roomId))}
                        notificationMode={getRoomNotificationMode(notificationPreferences, roomId)}
                      />
                    );
                  })}
              </NavCategory>
            )}
            {orphanFavorites.length > 0 && (
              <NavCategory>
                <NavCategoryHeader>
                  <RoomNavCategoryButton
                    closed={closedCategories.has(ROOMS_CATEGORY_ID)}
                    data-category-id={ROOMS_CATEGORY_ID}
                    onClick={handleCategoryClick}
                  >
                    Rooms
                  </RoomNavCategoryButton>
                </NavCategoryHeader>
                {!closedCategories.has(ROOMS_CATEGORY_ID) &&
                  orphanFavorites.map((roomId) => {
                    const room = mx.getRoom(roomId);
                    if (!room) return null;
                    return (
                      <RoomNavItem
                        key={roomId}
                        room={room}
                        selected={selectedRoomId === roomId}
                        focused={false}
                        optionId={`room-option-fav-${roomId}`}
                        tabIndex={0}
                        showAvatar={false}
                        direct={false}
                        linkPath={getFavoritesRoomPath(getCanonicalAliasOrRoomId(mx, roomId))}
                        notificationMode={getRoomNotificationMode(notificationPreferences, roomId)}
                      />
                    );
                  })}
              </NavCategory>
            )}
            {Array.from(spaceFavoritesMap.entries()).map(([spaceId, roomIds]) => {
              const spaceCategoryId = makeNavCategoryId('favorites', spaceId);
              const spaceRoom = mx.getRoom(spaceId);
              const spaceName = spaceRoom?.name ?? spaceId;
              return (
                <NavCategory key={spaceId}>
                  <NavCategoryHeader>
                    <RoomNavCategoryButton
                      closed={closedCategories.has(spaceCategoryId)}
                      data-category-id={spaceCategoryId}
                      onClick={handleCategoryClick}
                    >
                      {spaceName}
                    </RoomNavCategoryButton>
                  </NavCategoryHeader>
                  {!closedCategories.has(spaceCategoryId) &&
                    roomIds.map((roomId) => {
                      const room = mx.getRoom(roomId);
                      if (!room) return null;
                      return (
                        <RoomNavItem
                          key={roomId}
                          room={room}
                          selected={selectedRoomId === roomId}
                          focused={false}
                          optionId={`room-option-fav-${roomId}`}
                          tabIndex={0}
                          showAvatar={false}
                          direct={false}
                          linkPath={getFavoritesRoomPath(getCanonicalAliasOrRoomId(mx, roomId))}
                          notificationMode={getRoomNotificationMode(
                            notificationPreferences,
                            roomId
                          )}
                        />
                      );
                    })}
                </NavCategory>
              );
            })}
          </Box>
        </PageNavContent>
      )}
    </PageNav>
  );
}
