import React, { useMemo } from 'react';
import {
  Avatar,
  Box,
  Chip,
  Header,
  Icon,
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
import { roomToParentsAtom } from '../../../state/room/roomToParents';
import { mDirectAtom } from '../../../state/mDirectList';
import { RoomAvatar, RoomIcon } from '../../../components/room-avatar';
import { SequenceCard } from '../../../components/sequence-card';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { getCanonicalAliasOrRoomId, mxcUrlToHttp } from '../../../utils/matrix';
import { getMemberAvatarMxc, getMemberDisplayName, getRoomAvatarUrl } from '../../../utils/room';
import { Time } from '../../../components/message';
import { UserAvatar } from '../../../components/user-avatar';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import {
  getDirectRoomPath,
  getHomeRoomPath,
  getSpacePath,
  getSpaceRoomPath,
} from '../../pathUtils';

const ACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

type ActivityKind =
  | 'profile-avatar'
  | 'profile-name'
  | 'room-name'
  | 'room-avatar'
  | 'room-topic';

type ActivityItem = {
  room: Room;
  mEvent: MatrixEvent;
  ts: number;
  kind: ActivityKind;
  summary: string;
};

function describeMemberChange(mEvent: MatrixEvent): { kind: ActivityKind; summary: string } | null {
  const content = mEvent.getContent() as { membership?: string; displayname?: string; avatar_url?: string };
  const prev = mEvent.getPrevContent() as { membership?: string; displayname?: string; avatar_url?: string };
  // Only interested in profile changes within a sustained 'join' membership —
  // joins/leaves/invites are room membership changes, not profile activity.
  if (content.membership !== 'join' || prev.membership !== 'join') return null;

  const nameChanged = (content.displayname ?? '') !== (prev.displayname ?? '');
  const avatarChanged = (content.avatar_url ?? '') !== (prev.avatar_url ?? '');

  if (nameChanged) {
    const from = prev.displayname ?? mEvent.getStateKey() ?? '?';
    const to = content.displayname ?? mEvent.getStateKey() ?? '?';
    return { kind: 'profile-name', summary: `${from} is now known as ${to}` };
  }
  if (avatarChanged) {
    const who = content.displayname ?? mEvent.getStateKey() ?? '?';
    return { kind: 'profile-avatar', summary: `${who} changed their profile picture` };
  }
  return null;
}

function describeRoomState(mEvent: MatrixEvent): { kind: ActivityKind; summary: string } | null {
  const type = mEvent.getType();
  const content = mEvent.getContent() as Record<string, unknown>;
  const prev = mEvent.getPrevContent() as Record<string, unknown>;
  if (type === 'm.room.name') {
    const from = (prev.name as string | undefined) ?? '(unset)';
    const to = (content.name as string | undefined) ?? '(unset)';
    if (from === to) return null;
    return { kind: 'room-name', summary: `Room renamed: ${from} → ${to}` };
  }
  if (type === 'm.room.avatar') {
    if ((content.url ?? '') === (prev.url ?? '')) return null;
    return { kind: 'room-avatar', summary: 'Room avatar changed' };
  }
  if (type === 'm.room.topic') {
    if ((content.topic ?? '') === (prev.topic ?? '')) return null;
    return { kind: 'room-topic', summary: 'Room topic changed' };
  }
  return null;
}

function collectActivity(rooms: Room[], since: number): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const room of rooms) {
    const events = room.getLiveTimeline().getEvents();
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const mEvent = events[i];
      const ts = mEvent.getTs();
      if (ts < since) break;
      if (mEvent.isRedacted()) continue;
      let described = null;
      if (mEvent.getType() === 'm.room.member') {
        described = describeMemberChange(mEvent);
      } else {
        described = describeRoomState(mEvent);
      }
      if (!described) continue;
      items.push({
        room,
        mEvent,
        ts,
        kind: described.kind,
        summary: described.summary,
      });
    }
  }
  items.sort((a, b) => b.ts - a.ts);
  return items;
}

function iconFor(kind: ActivityKind) {
  switch (kind) {
    case 'profile-avatar':
      return Icons.Photo;
    case 'profile-name':
      return Icons.User;
    case 'room-name':
      return Icons.Hash;
    case 'room-avatar':
      return Icons.Photo;
    case 'room-topic':
      return Icons.Document;
    default:
      return Icons.Info;
  }
}

export function Activity() {
  const mx = useMatrixClient();
  const navigate = useNavigate();
  const allRooms = useAtomValue(allRoomsAtom);
  const mDirects = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');
  const [dateFormatString] = useSetting(settingsAtom, 'dateFormatString');
  const useAuthentication = useMediaAuthentication();

  const items = useMemo(() => {
    const rooms = allRooms
      .map((id) => mx.getRoom(id))
      .filter((r): r is Room => !!r && !r.isSpaceRoom() && r.getMyMembership() === 'join');
    return collectActivity(rooms, Date.now() - ACTIVITY_WINDOW_MS);
  }, [allRooms, mx]);

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

  return (
    <Page>
      <PageHeader>
        <Box grow="Yes" gap="300" alignItems="Center">
          <Box grow="Yes">
            <Text size="H4" as="h1" truncate>
              Activity
            </Text>
          </Box>
        </Box>
      </PageHeader>
      <Box grow="Yes">
        <Scroll hideTrack visibility="Hover">
          <PageContent>
            <PageContentCenter>
              {items.length === 0 && (
                <PageHero
                  icon={<Icon size="600" src={Icons.Info} />}
                  title="No recent activity"
                  subTitle="Profile-picture, display-name, and room-metadata changes from the past week will show up here — without marking the rooms unread."
                />
              )}
              {items.length > 0 && (
                <Box direction="Column" gap="200">
                  <Header size="300">
                    <Text size="L400">Last 7 days</Text>
                  </Header>
                  {items.map((item) => {
                    const { room, mEvent, ts, kind, summary } = item;
                    const roomAvatarMxc = getRoomAvatarUrl(mx, room, 32, useAuthentication);
                    const sender = mEvent.getSender();
                    const senderMxc =
                      sender ? getMemberAvatarMxc(room, sender) : undefined;
                    const senderName = sender ? getMemberDisplayName(room, sender) ?? sender : '';
                    const senderAvatarUrl = senderMxc
                      ? mxcUrlToHttp(mx, senderMxc, useAuthentication, 32, 32, 'crop') ?? undefined
                      : undefined;
                    return (
                      <SequenceCard
                        key={`${room.roomId}:${mEvent.getId()}`}
                        variant="SurfaceVariant"
                        direction="Column"
                        gap="200"
                        style={{ padding: config.space.S200 }}
                      >
                        <Box alignItems="Center" gap="200">
                          <Avatar size="200" radii="400">
                            <RoomAvatar
                              roomId={room.roomId}
                              src={roomAvatarMxc ?? undefined}
                              alt={room.name}
                              renderFallback={() => (
                                <RoomIcon
                                  size="200"
                                  joinRule={room.getJoinRule() ?? JoinRule.Restricted}
                                />
                              )}
                            />
                          </Avatar>
                          <Box grow="Yes" direction="Column">
                            <Text size="T200" truncate>
                              {room.name}
                            </Text>
                          </Box>
                          <Time ts={ts} compact hour24Clock={hour24Clock} dateFormatString={dateFormatString} />
                        </Box>
                        <Box alignItems="Center" gap="200">
                          {kind.startsWith('profile-') && sender && (
                            <Avatar size="200" radii="Pill">
                              <UserAvatar
                                userId={sender}
                                src={senderAvatarUrl}
                                alt={senderName}
                                renderFallback={() => (
                                  <Text size="H6">{senderName.charAt(0).toUpperCase()}</Text>
                                )}
                              />
                            </Avatar>
                          )}
                          {!kind.startsWith('profile-') && (
                            <Avatar size="200" radii="400">
                              <Icon size="100" src={iconFor(kind)} />
                            </Avatar>
                          )}
                          <Box grow="Yes">
                            <Text size="T300" truncate>
                              {summary}
                            </Text>
                          </Box>
                          <Box shrink="No">
                            <Chip
                              onClick={() => navigateToRoom(room.roomId, mEvent.getId())}
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
                </Box>
              )}
            </PageContentCenter>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}
