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
import { allInvitesAtom } from '../../../state/room-list/inviteList';
import { allRoomsThrottled } from '../../../state/room-list/roomList';
import { roomToUnreadThrottled } from '../../../state/room/roomToUnread';
import { useRoomsUnread } from '../../../state/hooks/unread';
import {
  getInboxInvitesPath,
  getInboxNotificationsPath,
  getInboxPath,
  getInboxUnreadPath,
  joinPathComponent,
} from '../../pathUtils';
import { useInboxSelected } from '../../../hooks/router/useInbox';
import { UnreadBadge } from '../../../components/unread-badge';
import { ScreenSize, useScreenSizeContext } from '../../../hooks/useScreenSize';
import { useNavToActivePathAtom } from '../../../state/hooks/navToActivePath';

export function InboxTab() {
  const screenSize = useScreenSizeContext();
  const navigate = useNavigate();
  const navToActivePath = useAtomValue(useNavToActivePathAtom());
  const inboxSelected = useInboxSelected();
  const allInvites = useAtomValue(allInvitesAtom);
  const inviteCount = allInvites.length;
  const allRooms = useAtomValue(allRoomsThrottled.out);
  const allUnread = useRoomsUnread(allRooms, roomToUnreadThrottled.out);
  const hasHighlight = (allUnread?.highlight ?? 0) > 0;
  const hasUnread = (allUnread?.total ?? 0) > 0;

  const handleInboxClick = () => {
    if (screenSize === ScreenSize.Mobile) {
      navigate(getInboxPath());
      return;
    }
    const activePath = navToActivePath.get('inbox');
    if (activePath) {
      navigate(joinPathComponent(activePath));
      return;
    }

    const path = inviteCount > 0 ? getInboxInvitesPath() : getInboxNotificationsPath();
    navigate(path);
  };

  return (
    <>
      <SidebarItem active={inboxSelected}>
        <SidebarItemTooltip tooltip="Inbox (Alt+I)">
          {(triggerRef) => (
            <SidebarAvatar as="button" ref={triggerRef} outlined aria-label="Inbox" aria-keyshortcuts="Alt+I" onClick={handleInboxClick}>
              <Icon src={Icons.Inbox} filled={inboxSelected} />
            </SidebarAvatar>
          )}
        </SidebarItemTooltip>
        {inviteCount > 0 && (
          <SidebarItemBadge hasCount>
            <UnreadBadge highlight count={inviteCount} />
          </SidebarItemBadge>
        )}
      </SidebarItem>
    </>
  );
}
