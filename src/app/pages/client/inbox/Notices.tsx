import React, { useMemo } from 'react';
import {
  Avatar,
  Box,
  Chip,
  Icon,
  Icons,
  Scroll,
  Text,
  config,
} from 'folds';
import { useAtomValue } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { JoinRule, MatrixEvent, MsgType, Room } from 'matrix-js-sdk';
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
import { getMemberDisplayName, getRoomAvatarUrl } from '../../../utils/room';
import { Time } from '../../../components/message';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import {
  getDirectRoomPath,
  getHomeRoomPath,
  getSpaceRoomPath,
} from '../../pathUtils';

// 7 days of m.notice history — long enough to catch a missed wallops or
// bridge connect/disconnect cycle, short enough to keep the list tractable.
const NOTICE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// Bodies in this view get a hard cap so a runaway bot dump (heisenbridge
// pasting an MOTD, etc.) doesn't blow up the layout. The room link is
// always one click away if someone wants the full text.
const NOTICE_BODY_TRUNCATE = 800;

type NoticeItem = {
  key: string;
  room: Room;
  mEvent: MatrixEvent;
  ts: number;
  sender: string;
  body: string;
};

function collectNotices(rooms: Room[], since: number): NoticeItem[] {
  const items: NoticeItem[] = [];
  for (const room of rooms) {
    const events = room.getLiveTimeline().getEvents();
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const mEvent = events[i];
      const ts = mEvent.getTs();
      if (ts < since) break;
      if (mEvent.getType() !== 'm.room.message') continue;
      const content = mEvent.getContent() as { msgtype?: string; body?: string };
      if (content.msgtype !== MsgType.Notice) continue;
      if (mEvent.isRedacted()) continue;
      if (mEvent.getRelation()?.rel_type === 'm.replace') continue;
      const senderId = mEvent.getSender() ?? '';
      const sender = senderId ? getMemberDisplayName(room, senderId) ?? senderId : 'Unknown';
      const rawBody = (content.body ?? '').trim();
      const body =
        rawBody.length > NOTICE_BODY_TRUNCATE
          ? `${rawBody.slice(0, NOTICE_BODY_TRUNCATE)}…`
          : rawBody;
      items.push({
        key: `${room.roomId}:${mEvent.getId() ?? ts}`,
        room,
        mEvent,
        ts,
        sender,
        body,
      });
    }
  }
  items.sort((a, b) => b.ts - a.ts);
  return items;
}

export function Notices() {
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
    return collectNotices(rooms, Date.now() - NOTICE_WINDOW_MS);
  }, [allRooms, mx]);

  const navigateToRoom = (roomId: string, eventId?: string) => {
    const room = mx.getRoom(roomId);
    if (!room) return;
    const roomIdOrAlias = getCanonicalAliasOrRoomId(mx, roomId);
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
              Notices
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
                  title="No recent notices"
                  subTitle="Bot output, bridge logs, wallops, and other m.notice messages from the past week appear here — without marking rooms unread."
                />
              )}
              {items.length > 0 && (
                <Box direction="Column" gap="200">
                  {items.map((item) => {
                    const { room, mEvent, ts, sender, body } = item;
                    const roomAvatarMxc = getRoomAvatarUrl(mx, room, 32, useAuthentication);
                    return (
                      <SequenceCard
                        key={item.key}
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
                              {room.name} · {sender}
                            </Text>
                          </Box>
                          <Time
                            ts={ts}
                            compact
                            hour24Clock={hour24Clock}
                            dateFormatString={dateFormatString}
                          />
                          <Chip
                            onClick={() => navigateToRoom(room.roomId, mEvent.getId())}
                            variant="Secondary"
                            radii="400"
                          >
                            <Text size="T200">Open</Text>
                          </Chip>
                        </Box>
                        {body && (
                          <Box>
                            <Text
                              size="T300"
                              priority="400"
                              style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                            >
                              {body}
                            </Text>
                          </Box>
                        )}
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
