import React, { useCallback, useRef } from 'react';
import { Box, Text, config } from 'folds';
import { EventType, Room } from 'matrix-js-sdk';
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
import { Page } from '../../components/page';
import { useSetAtom } from 'jotai';
import { useKeyDown } from '../../hooks/useKeyDown';
import { editableActiveElement } from '../../utils/dom';
import { searchModalAtom } from '../../state/searchModal';
import { settingsAtom } from '../../state/settings';
import { useSetting } from '../../state/hooks/settings';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useRoomCreators } from '../../hooks/useRoomCreators';

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

export function RoomView({ room, eventId }: { room: Room; eventId?: string }) {
  const roomInputRef = useRef<HTMLDivElement>(null);
  const roomViewRef = useRef<HTMLDivElement>(null);

  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');

  const { roomId } = room;
  const editor = useEditor();

  const mx = useMatrixClient();

  const tombstoneEvent = useStateEvent(room, StateEvent.RoomTombstone);
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);

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
        const noMod = !evt.ctrlKey && !evt.altKey && !evt.metaKey && !evt.shiftKey;

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
      [setSearchModal]
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
          {hideActivity ? <RoomViewFollowingPlaceholder /> : <RoomViewFollowing room={room} />}
        </Box>
      </Page>
  );
}
