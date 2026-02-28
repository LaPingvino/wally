import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, Icons } from 'folds';
import { useAtomValue } from 'jotai';
import {
  SidebarAvatar,
  SidebarItem,
  SidebarItemBadge,
  SidebarItemTooltip,
} from '../../../components/sidebar';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { roomToUnreadAtom } from '../../../state/room/roomToUnread';
import { useRoomsUnread } from '../../../state/hooks/unread';
import { getFavoritesPath } from '../../pathUtils';
import { useFavoritesSelected } from '../../../hooks/router/useFavoritesSelected';
import { UnreadBadge } from '../../../components/unread-badge';
import { useFavoriteRooms } from '../../../hooks/useFavoriteRooms';

export function FavoritesTab() {
  const navigate = useNavigate();
  const favoritesSelected = useFavoritesSelected();
  const allRooms = useAtomValue(allRoomsAtom);
  const favoriteRoomIds = useFavoriteRooms(allRooms);
  const favoriteUnread = useRoomsUnread(favoriteRoomIds, roomToUnreadAtom);

  return (
    <SidebarItem active={favoritesSelected}>
      <SidebarItemTooltip tooltip="Favorites (Alt+F)">
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            aria-label="Favorites"
            aria-keyshortcuts="Alt+F"
            onClick={() => navigate(getFavoritesPath())}
          >
            <Icon src={Icons.Star} filled={favoritesSelected} />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
      {favoriteUnread && (
        <SidebarItemBadge hasCount={favoriteUnread.total > 0}>
          <UnreadBadge highlight={favoriteUnread.highlight > 0} count={favoriteUnread.total} />
        </SidebarItemBadge>
      )}
    </SidebarItem>
  );
}
