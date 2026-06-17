import React, { useMemo } from 'react';
import {
  Avatar,
  Box,
  Chip,
  Header,
  Icon,
  IconButton,
  Icons,
  Scroll,
  Text,
  config,
} from 'folds';
import { useAtomValue } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { JoinRule, MatrixEvent, Room } from 'matrix-js-sdk';
import {
  Page,
  PageContent,
  PageContentCenter,
  PageHeader,
  PageHero,
} from '../../../components/page';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { roomToUnreadAtom } from '../../../state/room/roomToUnread';
import { roomToParentsAtom } from '../../../state/room/roomToParents';
import { mDirectAtom } from '../../../state/mDirectList';
import { RoomAvatar, RoomIcon } from '../../../components/room-avatar';
import { SequenceCard } from '../../../components/sequence-card';
import { markAsRead } from '../../../utils/notifications';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { getCanonicalAliasOrRoomId, getMxIdLocalPart, mxcUrlToHttp } from '../../../utils/matrix';
import { getMemberAvatarMxc, getMemberDisplayName, getRoomAvatarUrl } from '../../../utils/room';
import { Time, Username, UsernameBold } from '../../../components/message';
import { UserAvatar } from '../../../components/user-avatar';
import { useRoomUnread } from '../../../state/hooks/unread';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import {
  getDirectRoomPath,
  getHomeRoomPath,
  getSpacePath,
  getSpaceRoomPath,
} from '../../pathUtils';

const getUnreadMessages = (room: Room, userId: string, limit = 10): MatrixEvent[] => {
  const readUpToId = room.getEventReadUpTo(userId);
  const events = room.getLiveTimeline().getEvents();
  // Only show a preview when the read marker is in the loaded timeline. If it isn't, we don't know
  // which loaded events are actually unread — same "uncertain → nothing" rule getUnreadInfo uses,
  // rather than guessing the whole window is unread. (In practice this list is fed by the
  // pending-filtered unread atom, so the marker is loaded here; this just keeps the rule consistent.)
  const idx = readUpToId ? events.findIndex((e) => e.getId() === readUpToId) : -1;
  if (idx < 0) return [];
  const startIdx = idx + 1;
  return events
    .slice(startIdx)
    .filter(
      (e) =>
        !e.isRedacted() &&
        !e.isState() &&
        (e.getType() === 'm.room.message' ||
          e.getType() === 'm.sticker' ||
          e.getType() === 'm.room.encrypted')
    )
    .slice(-limit);
};

const getEventBody = (mEvent: MatrixEvent): string | null => {
  const content = mEvent.getContent();
  if (mEvent.getType() === 'm.room.message') return (content.body as string) ?? null;
  if (mEvent.getType() === 'm.sticker')
    return content.body ? `[Sticker] ${content.body}` : '[Sticker]';
  if (mEvent.getType() === 'm.room.encrypted') return '[Encrypted message]';
  return null;
};

type UnreadRoomGroupProps = {
  room: Room;
  messages: MatrixEvent[];
  hideActivity: boolean;
  hour24Clock: boolean;
  dateFormatString: string;
  onOpen: (roomId: string, eventId?: string) => void;
};
function UnreadRoomGroup({
  room,
  messages,
  hideActivity,
  hour24Clock,
  dateFormatString,
  onOpen,
}: UnreadRoomGroupProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const unread = useRoomUnread(room.roomId, roomToUnreadAtom);

  const handleOpenClick: React.MouseEventHandler = (e) => {
    const eventId = e.currentTarget.getAttribute('data-event-id');
    if (!eventId) return;
    onOpen(room.roomId, eventId);
  };

  return (
    <Box direction="Column" gap="200">
      <Header size="300">
        <Box gap="200" grow="Yes">
          <Avatar size="200" radii="300">
            <RoomAvatar
              roomId={room.roomId}
              src={getRoomAvatarUrl(mx, room, 96, useAuthentication)}
              alt={room.name}
              renderFallback={() => (
                <RoomIcon size="50" joinRule={room.getJoinRule() ?? JoinRule.Restricted} filled />
              )}
            />
          </Avatar>
          <Text size="H4" as="h3" truncate>
            {room.name}
          </Text>
        </Box>
        <Box shrink="No">
          {unread && (
            <Chip
              variant="Primary"
              radii="Pill"
              onClick={() => markAsRead(mx, room.roomId, hideActivity)}
              before={<Icon size="100" src={Icons.CheckTwice} />}
            >
              <Text size="T200">Mark as Read</Text>
            </Chip>
          )}
        </Box>
      </Header>
      {messages.length === 0 ? (
        <SequenceCard
          style={{ padding: config.space.S400 }}
          variant="SurfaceVariant"
          direction="Column"
        >
          <Box gap="300" justifyContent="SpaceBetween" alignItems="Center" grow="Yes">
            <Text size="T300" priority="300">
              {unread && unread.total > 0
                ? `${unread.total} unread message${unread.total !== 1 ? 's' : ''}`
                : 'Unread messages'}
            </Text>
            <Box shrink="No">
              <Chip onClick={() => onOpen(room.roomId)} variant="Secondary" radii="400">
                <Text size="T200">Open</Text>
              </Chip>
            </Box>
          </Box>
        </SequenceCard>
      ) : <Box direction="Column" gap="100">
        {messages.map((mEvent) => {
          const senderId = mEvent.getSender() ?? '';
          const displayName =
            getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;
          const senderAvatarMxc = getMemberAvatarMxc(room, senderId);
          const body = getEventBody(mEvent);

          return (
            <SequenceCard
              key={mEvent.getId()}
              style={{ padding: config.space.S400 }}
              variant="SurfaceVariant"
              direction="Column"
            >
              <Box gap="300" justifyContent="SpaceBetween" alignItems="Center" grow="Yes">
                <Box gap="200" alignItems="Center">
                  <Avatar size="300">
                    <UserAvatar
                      userId={senderId}
                      src={
                        senderAvatarMxc
                          ? mxcUrlToHttp(mx, senderAvatarMxc, useAuthentication, 48, 48, 'crop') ??
                            undefined
                          : undefined
                      }
                      alt={displayName}
                      renderFallback={() => <Icon size="200" src={Icons.User} filled />}
                    />
                  </Avatar>
                  <Box direction="Column">
                    <Box gap="200" alignItems="Baseline">
                      <Username>
                        <Text as="span" truncate>
                          <UsernameBold>{displayName}</UsernameBold>
                        </Text>
                      </Username>
                      <Time
                        ts={mEvent.getTs()}
                        hour24Clock={hour24Clock}
                        dateFormatString={dateFormatString}
                      />
                    </Box>
                    {body && (
                      <Text size="T300" priority="300">
                        {body}
                      </Text>
                    )}
                  </Box>
                </Box>
                <Box shrink="No">
                  <Chip
                    data-event-id={mEvent.getId()}
                    onClick={handleOpenClick}
                    variant="Secondary"
                    radii="400"
                  >
                    <Text size="T200">Open</Text>
                  </Chip>
                </Box>
              </Box>
            </SequenceCard>
          );
        })}
      </Box>}
    </Box>
  );
}

export function Unread() {
  const mx = useMatrixClient();
  const navigate = useNavigate();
  const roomToUnread = useAtomValue(roomToUnreadAtom);
  const allRooms = useAtomValue(allRoomsAtom);
  const mDirects = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');
  const [dateFormatString] = useSetting(settingsAtom, 'dateFormatString');

  const sortedUnreadRooms = useMemo(() => {
    const entries = Array.from(roomToUnread.entries()).filter(
      ([roomId, u]) =>
        (u.total > 0 || u.highlight > 0) && u.from === null && allRooms.includes(roomId)
    );
    entries.sort(([aId, aU], [bId, bU]) => {
      if (bU.highlight !== aU.highlight) return bU.highlight - aU.highlight;
      if (bU.total !== aU.total) return bU.total - aU.total;
      return (
        (mx.getRoom(bId)?.getLastActiveTimestamp() ?? 0) -
        (mx.getRoom(aId)?.getLastActiveTimestamp() ?? 0)
      );
    });
    return entries;
  }, [roomToUnread, allRooms, mx]);

  const navigateToRoom = (roomId: string, eventId?: string) => {
    const room = mx.getRoom(roomId);
    if (!room) return;
    const roomIdOrAlias = getCanonicalAliasOrRoomId(mx, roomId);
    if (room.isSpaceRoom()) {
      navigate(getSpacePath(roomIdOrAlias));
      return;
    }
    if (mDirects.has(roomId)) {
      navigate(getDirectRoomPath(roomIdOrAlias, eventId));
      return;
    }
    const parents = roomToParents.get(roomId);
    if (parents && parents.size > 0) {
      const spaceId = Array.from(parents)[0];
      navigate(getSpaceRoomPath(getCanonicalAliasOrRoomId(mx, spaceId), roomIdOrAlias, eventId));
    } else {
      navigate(getHomeRoomPath(roomIdOrAlias, eventId));
    }
  };

  const handleMarkAllAsRead = () => {
    sortedUnreadRooms.forEach(([roomId]) => markAsRead(mx, roomId, hideActivity));
  };

  const unreadGroups = useMemo(
    () =>
      sortedUnreadRooms.flatMap(([roomId]) => {
        const room = mx.getRoom(roomId);
        if (!room) return [];
        const messages = getUnreadMessages(room, mx.getUserId() ?? '', 10);
        return [{ roomId, room, messages }];
      }),
    [sortedUnreadRooms, mx]
  );

  return (
    <Page>
      <PageHeader>
        <Box grow="Yes" gap="300" alignItems="Center">
          <Box grow="Yes">
            <Text size="H4" as="h1" truncate>
              Unread
            </Text>
          </Box>
          {sortedUnreadRooms.length > 0 && (
            <IconButton
              aria-label="Mark all as read"
              title="Mark all as read"
              size="300"
              onClick={handleMarkAllAsRead}
            >
              <Icon src={Icons.CheckTwice} size="100" />
            </IconButton>
          )}
        </Box>
      </PageHeader>
      <Box style={{ position: 'relative' }} grow="Yes">
        <Scroll hideTrack visibility="Hover">
          <PageContent>
            <PageContentCenter>
              {unreadGroups.length === 0 ? (
                <PageHero
                  icon={<Icon size="600" src={Icons.CheckTwice} />}
                  title="All caught up!"
                  subTitle="No unread messages."
                />
              ) : (
                <Box direction="Column" gap="200">
                  {unreadGroups.map(({ roomId, room, messages }) => (
                    <UnreadRoomGroup
                      key={roomId}
                      room={room}
                      messages={messages}
                      hideActivity={hideActivity}
                      hour24Clock={hour24Clock}
                      dateFormatString={dateFormatString}
                      onOpen={navigateToRoom}
                    />
                  ))}
                </Box>
              )}
            </PageContentCenter>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}
