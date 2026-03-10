import React, { useCallback, useEffect, useRef } from 'react';
import { Transforms } from 'slate';
import { Box, Text, config } from 'folds';
import { EventType, JoinRule, Room } from 'matrix-js-sdk';
import { MatrixRTCSession } from 'matrix-js-sdk/lib/matrixrtc/MatrixRTCSession';
import { ReactEditor } from 'slate-react';
import { isKeyHotkey } from 'is-hotkey';
import { useStateEvent } from '../../hooks/useStateEvent';
import { StateEvent } from '../../../types/matrix/room';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useEditor } from '../../components/editor';
import { RoomInputPlaceholder } from './RoomInputPlaceholder';
import { RoomTimeline } from './RoomTimeline';
import { RoomViewTyping } from './RoomViewTyping';
import { RoomTombstone } from './RoomTombstone';
import { RoomInput } from './RoomInput';
import { RoomViewFollowing, RoomViewFollowingPlaceholder } from './RoomViewFollowing';
import * as followingCss from './RoomViewFollowing.css';
import { Page } from '../../components/page';
import { useAtomValue, useSetAtom } from 'jotai';
import { activePersonaAtom } from '../../state/personas';
import { useKeyDown } from '../../hooks/useKeyDown';
import { editableActiveElement } from '../../utils/dom';
import { searchModalAtom } from '../../state/searchModal';
import { settingsAtom } from '../../state/settings';
import { useSetting } from '../../state/hooks/settings';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useIsDirectRoom, useRoom } from '../../hooks/useRoom';
import { useRoomUnread } from '../../state/hooks/unread';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { announce } from '../../utils/announce';
import { playReactionSound, playReplyToMeSound } from '../../utils/sounds';

const FN_KEYS_REGEX = /^F\d+$/;
const shouldFocusMessageField = (evt: KeyboardEvent): boolean => {
  const { code } = evt;
  if (evt.metaKey || evt.altKey || evt.ctrlKey) {
    return false;
  }

  if (FN_KEYS_REGEX.test(code)) return false;

  if (
    code.startsWith('OS') ||
    code.startsWith('Meta') ||
    code.startsWith('Shift') ||
    code.startsWith('Alt') ||
    code.startsWith('Control') ||
    code.startsWith('Arrow') ||
    code.startsWith('Page') ||
    code.startsWith('End') ||
    code.startsWith('Home') ||
    code === 'Tab' ||
    code === 'Space' ||
    code === 'Enter' ||
    code === 'NumLock' ||
    code === 'ScrollLock'
  ) {
    return false;
  }

  const active = document.activeElement;
  if (active && active.closest('[role="log"], [role="listbox"]')) return false;

  return true;
};

export function RoomView({ eventId }: { eventId?: string }) {
  const roomInputRef = useRef<HTMLDivElement>(null);
  const roomViewRef = useRef<HTMLDivElement>(null);

  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const [perMessageProfiles] = useSetting(settingsAtom, 'perMessageProfiles');
  const activePersona = useAtomValue(activePersonaAtom);

  const room = useRoom();
  const { roomId } = room;
  const editor = useEditor();

  const mx = useMatrixClient();

  const tombstoneEvent = useStateEvent(room, StateEvent.RoomTombstone);
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);
  const direct = useIsDirectRoom();
  const unread = useRoomUnread(roomId, roomToUnreadAtom);

  useEffect(() => {
    const roomType = room.isCallRoom()
      ? 'Call Room'
      : direct
        ? 'Direct Message'
        : room.getJoinRule() === JoinRule.Public
          ? 'Public Room'
          : 'Group Room';
    const parts: string[] = [room.name, roomType];
    if (unread?.total) parts.push(`${unread.total} unread messages`);
    const callMemberCount = MatrixRTCSession.callMembershipsForRoom(room).length;
    if (callMemberCount > 0)
      parts.push(`${callMemberCount} member${callMemberCount === 1 ? '' : 's'} in call`);
    announce(parts.join(', '));
    setTimeout(() => document.getElementById('cinny-timeline')?.focus(), 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const permissions = useRoomPermissions(creators, powerLevels);
  const canMessage = permissions.event(EventType.RoomMessage, mx.getSafeUserId());

  const setSearchModal = useSetAtom(searchModalAtom);

  useKeyDown(
    window,
    useCallback(
      (evt) => {
        if (editableActiveElement()) return;
        const portalContainer = document.getElementById('portalContainer');
        if (portalContainer && portalContainer.children.length > 0) {
          return;
        }
        if (shouldFocusMessageField(evt) || isKeyHotkey('mod+v', evt)) {
          ReactEditor.focus(editor);
          // Also insert the typed character so it isn't swallowed
          if (evt.key.length === 1 && !evt.ctrlKey && !evt.altKey && !evt.metaKey) {
            Transforms.insertText(editor, evt.key);
          }
        }
      },
      [editor]
    )
  );

  useKeyDown(
    window,
    useCallback(
      (evt) => {
        const active = document.activeElement;
        if (!active?.closest('[role="log"]')) return;
        // Don't intercept keys while typing in the message editor or any other contenteditable
        if ((active as HTMLElement)?.isContentEditable) return;
        const noMod = !evt.ctrlKey && !evt.altKey && !evt.metaKey && !evt.shiftKey;

        if (evt.key === 'Escape' && noMod) {
          evt.preventDefault();
          ReactEditor.focus(editor);
          return;
        }

        if (evt.key === '/' && noMod) {
          evt.preventDefault();
          setSearchModal(true);
          return;
        }

        if ((evt.key === 'ArrowDown' || evt.key === 'ArrowUp') && noMod) {
          const scrollEl = document.getElementById('cinny-timeline');
          if (!scrollEl) return;
          const messages = Array.from(
            scrollEl.querySelectorAll('[data-timeline-message]')
          ) as HTMLElement[];
          if (messages.length === 0) return;
          evt.preventDefault();
          const currentIdx = messages.findIndex(
            (m) => m === active || m.contains(active as Node)
          );
          let next: HTMLElement | undefined;
          if (currentIdx < 0) {
            next = messages[messages.length - 1];
          } else if (evt.key === 'ArrowDown') {
            next = messages[Math.min(currentIdx + 1, messages.length - 1)];
          } else {
            next = messages[Math.max(currentIdx - 1, 0)];
          }
          if (next && next !== active) {
            next.focus({ preventScroll: true });
            next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            // Announce message content for screen readers
            const evtId = next.getAttribute('data-event-id');
            if (evtId) {
              const mxEvent = room.findEventById(evtId);
              if (mxEvent) {
                const sender = room.getMember(mxEvent.getSender() ?? '')?.name ?? mxEvent.getSender() ?? '';
                const content = mxEvent.getContent() as Record<string, unknown>;
                const body = (content.body as string | undefined) ?? '';
                const replyRel = (content['m.relates_to'] as Record<string, unknown> | undefined)?.['m.in_reply_to'] as Record<string, unknown> | undefined;
                const replyId = replyRel?.event_id as string | undefined;
                const ts = mxEvent.getDate()?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? '';
                const parts: string[] = [sender, body];
                // Reactions on this message
                const relations = room.getUnfilteredTimelineSet()
                  .getRelationsForEvent?.(evtId, 'm.annotation', 'm.reaction');
                if (relations && relations.getRelations().length > 0) {
                  playReactionSound();
                  parts.push('has reactions');
                }
                if (replyId) {
                  const replyEvt = room.findEventById(replyId);
                  if (replyEvt) {
                    const replySender = room.getMember(replyEvt.getSender() ?? '')?.name ?? replyEvt.getSender() ?? '';
                    const replyBody = (replyEvt.getContent().body as string | undefined) ?? '';
                    if (replyBody) parts.push(`In reply to ${replySender}: ${replyBody.slice(0, 80)}`);
                    // Reply to my own message
                    if (replyEvt.getSender() === mx.getUserId()) {
                      playReplyToMeSound();
                    }
                  }
                }
                if (ts) parts.push(ts);
                announce(parts.filter(Boolean).join('. '));
              }
            }
          }
          return;
        }

        if ((evt.key === 'PageDown' || evt.key === 'PageUp') && noMod) {
          const scrollEl = document.getElementById('cinny-timeline');
          if (!scrollEl) return;
          evt.preventDefault();
          scrollEl.scrollBy({
            top: evt.key === 'PageDown' ? scrollEl.clientHeight * 0.9 : -scrollEl.clientHeight * 0.9,
            behavior: 'smooth',
          });
        }
      },
      [setSearchModal, room]
    )
  );

  return (
    <Page
      ref={roomViewRef}
    >
        <Box grow="Yes" direction="Column">
          <RoomTimeline
            key={roomId}
            room={room}
            eventId={eventId}
            roomInputRef={roomInputRef}
            editor={editor}
          />
          <RoomViewTyping room={room} />
        </Box>
        <Box shrink="No" direction="Column">
          <div style={{ padding: `0 ${config.space.S400}` }}>
            {tombstoneEvent ? (
              <RoomTombstone
                roomId={roomId}
                body={tombstoneEvent.getContent().body}
                replacementRoomId={tombstoneEvent.getContent().replacement_room}
              />
            ) : (
              <>
                {canMessage && (
                  <RoomInput
                    room={room}
                    editor={editor}
                    roomId={roomId}
                    fileDropContainerRef={roomViewRef}
                    ref={roomInputRef}
                  />
                )}
                {!canMessage && (
                  <RoomInputPlaceholder
                    style={{ padding: config.space.S200 }}
                    alignItems="Center"
                    justifyContent="Center"
                  >
                    <Text align="Center">You do not have permission to post in this room</Text>
                  </RoomInputPlaceholder>
                )}
              </>
            )}
          </div>
          {perMessageProfiles && activePersona ? (
            <Box
              className={followingCss.RoomViewFollowing({ clickable: false })}
              alignItems="Center"
              gap="200"
            >
              <Text size="T300" truncate>
                {'Sending as '}
                <b>{activePersona.displayname}</b>
                {'…'}
              </Text>
            </Box>
          ) : hideActivity ? <RoomViewFollowingPlaceholder /> : <RoomViewFollowing room={room} />}
        </Box>
      </Page>
  );
}
