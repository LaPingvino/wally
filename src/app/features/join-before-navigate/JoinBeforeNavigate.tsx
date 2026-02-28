import React, { useEffect, useMemo, useRef } from 'react';
import { Box, Button, Icon, IconButton, Icons, Scroll, Text, toRem } from 'folds';
import { useAtomValue } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { RoomCard } from '../../components/room-card';
import { RoomTopicViewer } from '../../components/room-topic-viewer';
import { Page, PageHeader } from '../../components/page';
import { RoomSummaryLoader } from '../../components/RoomSummaryLoader';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { allRoomsAtom } from '../../state/room-list/roomList';
import { roomToParentsAtom } from '../../state/room/roomToParents';
import { mDirectAtom } from '../../state/mDirectList';
import { getCanonicalAliasOrRoomId } from '../../utils/matrix';
import {
  getDirectRoomPath,
  getHomeRoomPath,
  getSpacePath,
  getSpaceRoomPath,
} from '../../pages/pathUtils';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { BackRouteHandler } from '../../components/BackRouteHandler';

type JoinBeforeNavigateProps = { roomIdOrAlias: string; eventId?: string; viaServers?: string[] };
export function JoinBeforeNavigate({
  roomIdOrAlias,
  eventId,
  viaServers,
}: JoinBeforeNavigateProps) {
  const mx = useMatrixClient();
  const allRooms = useAtomValue(allRoomsAtom);
  const mDirects = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const navigate = useNavigate();
  const screenSize = useScreenSizeContext();
  const autoNavDone = useRef(false);

  const navigateTo = (roomId: string, evId?: string) => {
    const room = mx.getRoom(roomId);
    if (!room) return;
    const rIdOrAlias = getCanonicalAliasOrRoomId(mx, roomId);
    if (room.isSpaceRoom()) {
      navigate(getSpacePath(rIdOrAlias));
      return;
    }
    if (mDirects.has(roomId)) {
      navigate(getDirectRoomPath(rIdOrAlias, evId));
      return;
    }
    const parents = roomToParents.get(roomId);
    if (parents && parents.size > 0) {
      const spaceId = Array.from(parents)[0];
      navigate(getSpaceRoomPath(getCanonicalAliasOrRoomId(mx, spaceId), rIdOrAlias, evId));
    } else {
      navigate(getHomeRoomPath(rIdOrAlias, evId));
    }
  };

  useEffect(() => {
    if (autoNavDone.current) return;
    // Redirect invalid IDs (e.g. "index.html" from the desktop app) to home
    if (!roomIdOrAlias.startsWith('!') && !roomIdOrAlias.startsWith('#')) {
      autoNavDone.current = true;
      navigate('/');
      return;
    }
    // Auto-navigate when the user is already a member (room ID only; aliases need resolution)
    if (roomIdOrAlias.startsWith('!')) {
      const room = mx.getRoom(roomIdOrAlias);
      if (room && allRooms.includes(room.roomId)) {
        const isSpace = room.isSpaceRoom();
        const isDM = mDirects.has(room.roomId);
        const parents = roomToParents.get(room.roomId);
        const isInSpace = parents && parents.size > 0;

        // Only auto-navigate when we know the correct destination:
        // - Space rooms and DMs: destination is always clear
        // - Space-child rooms: only after roomToParents has loaded the parents
        // - Home rooms: skip auto-nav; HomeRouteRoomProvider re-renders naturally
        //   when allRoomsAtom updates, so the room appears without a navigate() call.
        // - Space-child rooms with parents not yet loaded: don't navigate yet.
        //   This effect retries when roomToParents updates (it's in deps) and
        //   isInSpace becomes true, preventing a premature navigation to the wrong
        //   home path that would lock autoNavDone and prevent the correction.
        if (isSpace || isDM || isInSpace) {
          autoNavDone.current = true;
          navigateTo(room.roomId, eventId);
        }
      }
    }
  }, [mx, roomIdOrAlias, allRooms, mDirects, roomToParents, navigate, eventId]);

  const handleView = (roomId: string) => navigateTo(roomId, eventId);

  const alreadyJoinedRoomId = useMemo(() => {
    if (!roomIdOrAlias.startsWith('!')) return undefined;
    const room = mx.getRoom(roomIdOrAlias);
    return room && allRooms.includes(room.roomId) ? room.roomId : undefined;
  }, [mx, roomIdOrAlias, allRooms]);

  return (
    <Page>
      <PageHeader balance>
        <Box grow="Yes" gap="200">
          <Box shrink="No">
            {screenSize === ScreenSize.Mobile && (
              <BackRouteHandler>
                {(onBack) => (
                  <IconButton onClick={onBack}>
                    <Icon src={Icons.ArrowLeft} />
                  </IconButton>
                )}
              </BackRouteHandler>
            )}
          </Box>
          <Box grow="Yes" justifyContent="Center" alignItems="Center" gap="200">
            <Text size="H3" truncate>
              {roomIdOrAlias}
            </Text>
          </Box>
          {alreadyJoinedRoomId && (
            <Box shrink="No">
              <Button size="300" variant="Primary" radii="300" onClick={() => handleView(alreadyJoinedRoomId)}>
                <Text size="B300">Show Timeline</Text>
              </Button>
            </Box>
          )}
        </Box>
      </PageHeader>
      <Box grow="Yes">
        <Scroll hideTrack visibility="Hover" size="0">
          <Box style={{ height: '100%' }} grow="Yes" alignItems="Center" justifyContent="Center">
            <RoomSummaryLoader roomIdOrAlias={roomIdOrAlias}>
              {(summary) => (
                <RoomCard
                  style={{ maxWidth: toRem(364), width: '100%' }}
                  roomIdOrAlias={roomIdOrAlias}
                  allRooms={allRooms}
                  avatarUrl={summary?.avatar_url}
                  name={summary?.name}
                  topic={summary?.topic}
                  memberCount={summary?.num_joined_members}
                  roomType={summary?.room_type}
                  viaServers={viaServers}
                  renderTopicViewer={(name, topic, requestClose) => (
                    <RoomTopicViewer name={name} topic={topic} requestClose={requestClose} />
                  )}
                  onView={handleView}
                />
              )}
            </RoomSummaryLoader>
          </Box>
        </Scroll>
      </Box>
    </Page>
  );
}
