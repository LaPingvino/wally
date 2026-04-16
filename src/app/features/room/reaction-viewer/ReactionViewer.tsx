import React, { useCallback, useMemo, useState } from 'react';
import classNames from 'classnames';
import {
  Avatar,
  Box,
  Header,
  Icon,
  IconButton,
  Icons,
  Line,
  MenuItem,
  Scroll,
  Text,
  as,
  config,
} from 'folds';
import { MatrixEvent, Room, RoomMember } from 'matrix-js-sdk';
import { Relations } from 'matrix-js-sdk/lib/models/relations';
import { getMemberDisplayName } from '../../../utils/room';
import { eventWithShortcode, getMxIdLocalPart } from '../../../utils/matrix';
import * as css from './ReactionViewer.css';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useRelations } from '../../../hooks/useRelations';
import { Reaction } from '../../../components/message';
import { getHexcodeForEmoji, getShortcodeFor } from '../../../plugins/emoji';
import { UserAvatar } from '../../../components/user-avatar';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { useOpenUserRoomProfile } from '../../../state/hooks/userRoomProfile';
import { useSpaceOptionally } from '../../../hooks/useSpace';
import { getMouseEventCords } from '../../../utils/dom';
import { useIgnoredUsers } from '../../../hooks/useIgnoredUsers';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';

export type ReactionViewerProps = {
  room: Room;
  initialKey?: string;
  relations: Relations;
  requestClose: () => void;
};
export const ReactionViewer = as<'div', ReactionViewerProps>(
  ({ className, room, initialKey, relations, requestClose, ...props }, ref) => {
    const mx = useMatrixClient();
    const useAuthentication = useMediaAuthentication();
    const [hideBlockedReactions] = useSetting(settingsAtom, 'hideBlockedUserReactions');
    const ignoredUsers = useIgnoredUsers();
    const ignoredUsersSet = useMemo(() => new Set(ignoredUsers), [ignoredUsers]);
    const rawReactions = useRelations(
      relations,
      useCallback((rel) => [...(rel.getSortedAnnotationsByKey() ?? [])], [])
    );
    const reactions = useMemo(() => {
      if (!hideBlockedReactions || ignoredUsersSet.size === 0) return rawReactions;
      return rawReactions
        .map(([key, events]) => {
          const filtered = new Set(
            Array.from(events).filter((evt) => {
              const sender = evt.getSender();
              return !sender || !ignoredUsersSet.has(sender);
            })
          );
          return [key, filtered] as [string, Set<any>];
        })
        .filter(([, events]) => events.size > 0);
    }, [rawReactions, hideBlockedReactions, ignoredUsersSet]);
    const space = useSpaceOptionally();
    const openProfile = useOpenUserRoomProfile();

    const [selectedKey, setSelectedKey] = useState<string>(() => {
      if (initialKey) return initialKey;
      const defaultReaction = reactions.find((reaction) => typeof reaction[0] === 'string');
      return defaultReaction ? defaultReaction[0] : '';
    });

    const getName = (member: RoomMember) =>
      getMemberDisplayName(room, member.userId) ?? getMxIdLocalPart(member.userId) ?? member.userId;

    const getReactionsForKey = (key: string): MatrixEvent[] => {
      const reactSet = reactions.find(([k]) => k === key)?.[1];
      if (!reactSet) return [];
      const all = Array.from(reactSet);
      if (!hideBlockedReactions || ignoredUsersSet.size === 0) return all;
      return all.filter((evt) => {
        const sender = evt.getSender();
        return !sender || !ignoredUsersSet.has(sender);
      });
    };

    const selectedReactions = getReactionsForKey(selectedKey);
    const selectedShortcode =
      selectedReactions.find(eventWithShortcode)?.getContent().shortcode ??
      getShortcodeFor(getHexcodeForEmoji(selectedKey)) ??
      selectedKey;

    return (
      <Box
        className={classNames(css.ReactionViewer, className)}
        direction="Row"
        {...props}
        ref={ref}
      >
        <Box shrink="No" className={css.Sidebar}>
          <Scroll visibility="Hover" hideTrack size="300">
            <Box className={css.SidebarContent} direction="Column" gap="200">
              {reactions.map(([key, evts]) => {
                if (typeof key !== 'string') return null;
                return (
                  <Reaction
                    key={key}
                    mx={mx}
                    reaction={key}
                    count={evts.size}
                    aria-selected={key === selectedKey}
                    onClick={() => setSelectedKey(key)}
                    useAuthentication={useAuthentication}
                  />
                );
              })}
            </Box>
          </Scroll>
        </Box>
        <Line variant="Surface" direction="Vertical" size="300" />
        <Box grow="Yes" direction="Column">
          <Header className={css.Header} variant="Surface" size="600">
            <Box grow="Yes">
              <Text size="H3" truncate>{`Reacted with :${selectedShortcode}:`}</Text>
            </Box>
            <IconButton size="300" onClick={requestClose}>
              <Icon src={Icons.Cross} />
            </IconButton>
          </Header>

          <Box grow="Yes">
            <Scroll visibility="Hover" hideTrack size="300">
              <Box className={css.Content} direction="Column">
                {selectedReactions.map((mEvent) => {
                  const senderId = mEvent.getSender();
                  if (!senderId) return null;
                  const member = room.getMember(senderId);
                  const name = (member ? getName(member) : getMxIdLocalPart(senderId)) ?? senderId;

                  const avatarMxcUrl = member?.getMxcAvatarUrl();
                  const avatarUrl = avatarMxcUrl
                    ? mx.mxcUrlToHttp(
                        avatarMxcUrl,
                        100,
                        100,
                        'crop',
                        undefined,
                        false,
                        useAuthentication
                      )
                    : undefined;

                  return (
                    <MenuItem
                      key={senderId}
                      style={{ padding: `0 ${config.space.S200}` }}
                      radii="400"
                      onClick={(event) => {
                        openProfile(
                          room.roomId,
                          space?.roomId,
                          senderId,
                          getMouseEventCords(event.nativeEvent),
                          'Bottom'
                        );
                      }}
                      before={
                        <Avatar size="200">
                          <UserAvatar
                            userId={senderId}
                            src={avatarUrl ?? undefined}
                            alt={name}
                            renderFallback={() => <Icon size="50" src={Icons.User} filled />}
                          />
                        </Avatar>
                      }
                    >
                      <Box grow="Yes">
                        <Text size="T400" truncate>
                          {name}
                        </Text>
                      </Box>
                    </MenuItem>
                  );
                })}
              </Box>
            </Scroll>
          </Box>
        </Box>
      </Box>
    );
  }
);
