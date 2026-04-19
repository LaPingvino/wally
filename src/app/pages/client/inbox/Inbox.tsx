import React, { useState, useEffect } from 'react';
import { Avatar, Box, Icon, Icons, Text } from 'folds';
import { useAtomValue } from 'jotai';
import { INotificationsResponse, Method } from 'matrix-js-sdk';
import { NavCategory, NavItem, NavItemContent, NavLink } from '../../../components/nav';
import { getInboxActivityPath, getInboxInvitesPath, getInboxNotificationsPath, getInboxUnreadPath } from '../../pathUtils';
import {
  useInboxActivitySelected,
  useInboxInvitesSelected,
  useInboxNotificationsSelected,
  useInboxUnreadSelected,
} from '../../../hooks/router/useInbox';
import { UnreadBadge } from '../../../components/unread-badge';
import { allInvitesAtom } from '../../../state/room-list/inviteList';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { roomToUnreadAtom } from '../../../state/room/roomToUnread';
import { useRoomsUnread } from '../../../state/hooks/unread';
import { useNavToActivePathMapper } from '../../../hooks/useNavToActivePathMapper';
import { PageNav, PageNavContent, PageNavHeader } from '../../../components/page';
import { useMatrixClient } from '../../../hooks/useMatrixClient';

function useNotificationsSupported(): boolean | null {
  const mx = useMatrixClient();
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    mx.http
      .authedRequest<INotificationsResponse>(Method.Get, '/notifications', { limit: 1 })
      .then(() => setSupported(true))
      .catch((err: any) => {
        setSupported(err?.httpStatus !== 404 && err?.errcode !== 'M_UNRECOGNIZED');
      });
  }, [mx]);
  return supported;
}

function InvitesNavItem() {
  const invitesSelected = useInboxInvitesSelected();
  const allInvites = useAtomValue(allInvitesAtom);
  const inviteCount = allInvites.length;

  return (
    <NavItem
      variant="Background"
      radii="400"
      highlight={inviteCount > 0}
      aria-selected={invitesSelected}
    >
      <NavLink to={getInboxInvitesPath()}>
        <NavItemContent>
          <Box as="span" grow="Yes" alignItems="Center" gap="200">
            <Avatar size="200" radii="400">
              <Icon src={Icons.Mail} size="100" filled={invitesSelected} />
            </Avatar>
            <Box as="span" grow="Yes">
              <Text as="span" size="Inherit" truncate>
                Invites
              </Text>
            </Box>
            {inviteCount > 0 && <UnreadBadge highlight count={inviteCount} />}
          </Box>
        </NavItemContent>
      </NavLink>
    </NavItem>
  );
}

export function Inbox() {
  useNavToActivePathMapper('inbox');
  const notificationsSelected = useInboxNotificationsSelected();
  const unreadSelected = useInboxUnreadSelected();
  const activitySelected = useInboxActivitySelected();
  const notificationsSupported = useNotificationsSupported();
  const allRooms = useAtomValue(allRoomsAtom);
  const allUnread = useRoomsUnread(allRooms, roomToUnreadAtom);

  const notificationsUnsupported = notificationsSupported === false;
  const notificationsTo = notificationsUnsupported ? getInboxUnreadPath() : getInboxNotificationsPath();
  const isNotificationsActive = notificationsUnsupported ? unreadSelected : notificationsSelected;
  const notificationsHasHighlight = notificationsUnsupported && (allUnread?.highlight ?? 0) > 0;
  const notificationsBadgeCount = notificationsUnsupported ? (allUnread?.total ?? 0) : 0;

  return (
    <PageNav>
      <PageNavHeader>
        <Box grow="Yes" gap="300">
          <Box grow="Yes">
            <Text size="H4" truncate>
              Inbox
            </Text>
          </Box>
        </Box>
      </PageNavHeader>

      <PageNavContent>
        <Box direction="Column" gap="300">
          <NavCategory>
            <NavItem
              variant="Background"
              radii="400"
              highlight={notificationsHasHighlight}
              aria-selected={isNotificationsActive}
            >
              <NavLink to={notificationsTo}>
                <NavItemContent>
                  <Box as="span" grow="Yes" alignItems="Center" gap="200">
                    <Avatar size="200" radii="400">
                      <Icon src={Icons.BellRing} size="100" filled={isNotificationsActive} />
                    </Avatar>
                    <Box as="span" grow="Yes">
                      <Text as="span" size="Inherit" truncate>
                        Notifications
                      </Text>
                    </Box>
                    {notificationsBadgeCount > 0 && (
                      <UnreadBadge highlight={notificationsHasHighlight} count={notificationsBadgeCount} />
                    )}
                  </Box>
                </NavItemContent>
              </NavLink>
            </NavItem>
            <InvitesNavItem />
            <NavItem
              variant="Background"
              radii="400"
              aria-selected={activitySelected}
            >
              <NavLink to={getInboxActivityPath()}>
                <NavItemContent>
                  <Box as="span" grow="Yes" alignItems="Center" gap="200">
                    <Avatar size="200" radii="400">
                      <Icon src={Icons.User} size="100" filled={activitySelected} />
                    </Avatar>
                    <Box as="span" grow="Yes">
                      <Text as="span" size="Inherit" truncate>
                        Activity
                      </Text>
                    </Box>
                  </Box>
                </NavItemContent>
              </NavLink>
            </NavItem>
          </NavCategory>
        </Box>
      </PageNavContent>
    </PageNav>
  );
}
