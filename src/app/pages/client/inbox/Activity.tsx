import React, { useMemo } from 'react';
import {
  Avatar,
  Box,
  Chip,
  Icon,
  IconButton,
  Icons,
  Scroll,
  Text,
  config,
} from 'folds';
import { useAtom, useAtomValue } from 'jotai';
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
import { getCanonicalAliasOrRoomId } from '../../../utils/matrix';
import { getRoomAvatarUrl } from '../../../utils/room';
import { Time } from '../../../components/message';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { activityDismissedBeforeAtom } from '../../../state/activityDismiss';
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
  // Collapse repeats that communicate the same underlying fact:
  //   - Profile changes (avatar/display name) by the same user: one entry
  //     spanning all rooms. A display-name change propagates to every room
  //     the user is in; showing one line per room is pure noise.
  //   - Room-state changes of the same kind in the same room: one entry.
  // Representative event = newest; suffix counts/rooms when > 1.
  type Bucket = { item: ActivityItem; count: number; roomIds: Set<string> };
  const buckets = new Map<string, Bucket>();

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

      // Profile keys cross rooms (one profile, many rooms).
      // Room-state keys are per-room.
      const sender = mEvent.getSender() ?? '';
      const key = described.kind.startsWith('profile-')
        ? `${sender}:${described.kind}`
        : `${room.roomId}:${described.kind}`;

      const existing = buckets.get(key);
      if (existing) {
        existing.count += 1;
        existing.roomIds.add(room.roomId);
      } else {
        buckets.set(key, {
          count: 1,
          roomIds: new Set([room.roomId]),
          item: {
            room,
            mEvent,
            ts,
            kind: described.kind,
            summary: described.summary,
          },
        });
      }
    }
  }

  const items = Array.from(buckets.values()).map(({ item, count, roomIds }) => {
    const roomCount = roomIds.size;
    let suffix = '';
    if (roomCount > 1 && count === roomCount) suffix = ` (in ${roomCount} rooms)`;
    else if (roomCount > 1) suffix = ` (${count}× in ${roomCount} rooms)`;
    else if (count > 1) suffix = ` (${count}×)`;
    return suffix ? { ...item, summary: `${item.summary}${suffix}` } : item;
  });
  items.sort((a, b) => b.ts - a.ts);
  return items;
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
  const [dismissedBefore, setDismissedBefore] = useAtom(activityDismissedBeforeAtom);

  const items = useMemo(() => {
    const rooms = allRooms
      .map((id) => mx.getRoom(id))
      .filter((r): r is Room => !!r && !r.isSpaceRoom() && r.getMyMembership() === 'join');
    const since = Math.max(Date.now() - ACTIVITY_WINDOW_MS, dismissedBefore);
    return collectActivity(rooms, since);
  }, [allRooms, mx, dismissedBefore]);

  const handleMarkAllAsRead = () => {
    setDismissedBefore(Date.now());
  };

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
          {items.length > 0 && (
            <IconButton
              aria-label="Mark all as read"
              title="Mark all as read"
              size="300"
              onClick={handleMarkAllAsRead}
            >
              <Icon src={Icons.CheckTwice} />
            </IconButton>
          )}
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
                  {items.map((item) => {
                    const { room, mEvent, ts, summary } = item;
                    const roomAvatarMxc = getRoomAvatarUrl(mx, room, 32, useAuthentication);
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
                              src={roomAvatarMxc}
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
                            <Text size="T200" priority="300" truncate>
                              {summary}
                            </Text>
                          </Box>
                          <Time ts={ts} compact hour24Clock={hour24Clock} dateFormatString={dateFormatString} />
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
