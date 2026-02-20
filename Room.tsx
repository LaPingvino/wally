import React, { useCallback, useRef, useState } from 'react';
import { Box, Line } from 'folds';
import { useParams } from 'react-router-dom';
import { isKeyHotkey } from 'is-hotkey';
import { RoomView } from './RoomView';
import { MembersDrawer } from './MembersDrawer';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { PowerLevelsContextProvider, usePowerLevels } from '../../hooks/usePowerLevels';
import { useRoom } from '../../hooks/useRoom';
import { useKeyDown } from '../../hooks/useKeyDown';
import { markAsRead } from '../../utils/notifications';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomMembers } from '../../hooks/useRoomMembers';
import { CallView } from '../call/CallView';
import { RoomViewHeader } from './RoomViewHeader';
import { useCallState } from '../../pages/client/call/CallProvider';

export function Room() {
  const { eventId } = useParams();
  const room = useRoom();
  const mx = useMatrixClient();

  const [isDrawer] = useSetting(settingsAtom, 'isPeopleDrawer');
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const screenSize = useScreenSizeContext();
  const powerLevels = usePowerLevels(room);
  const members = useRoomMembers(mx, room?.roomId);

  const { activeCallRoomId, isCallViewOpen, isChatOpen } = useCallState();
  const isActiveCall = activeCallRoomId === room?.roomId;
  const isVoiceRoom = room.isCallRoom();
  const isCallLayout = isVoiceRoom || isActiveCall;
  const showCallPanel = isCallLayout && isCallViewOpen;
  // Voice rooms: show chat by default when call panel is closed (no isChatOpen state needed).
  // Regular rooms with call: only show chat when explicitly toggled (isChatOpen).
  const showChatPanel = !isCallLayout || isChatOpen || (isVoiceRoom && !isCallViewOpen);
  const showBoth = showCallPanel && showChatPanel && screenSize === ScreenSize.Desktop;

  const containerRef = useRef<HTMLDivElement>(null);
  const splitRatioRef = useRef(0.5);
  const [splitRatio, setSplitRatio] = useState(0.5);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const startX = e.clientX;
    const startRatio = splitRatioRef.current;
    const totalWidth = container.getBoundingClientRect().width;
    const onMove = (me: MouseEvent) => {
      const ratio = Math.max(0.2, Math.min(0.8, startRatio + (me.clientX - startX) / totalWidth));
      splitRatioRef.current = ratio;
      setSplitRatio(ratio);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  useKeyDown(
    window,
    useCallback(
      (evt) => {
        if (isKeyHotkey('escape', evt)) {
          markAsRead(mx, room.roomId, hideActivity);
        }
      },
      [mx, room.roomId, hideActivity]
    )
  );

  return (
    <PowerLevelsContextProvider value={powerLevels}>
      <Box grow="Yes">
        <Box grow="Yes" direction="Column">
          <RoomViewHeader />
          <Box grow="Yes" ref={containerRef}>
            {isCallLayout && (
              <Box
                grow={showBoth ? undefined : showCallPanel ? 'Yes' : undefined}
                direction="Column"
                style={
                  showBoth
                    ? { flexBasis: `${splitRatio * 100}%`, flexShrink: 0, overflow: 'hidden' }
                    : { display: showCallPanel ? 'flex' : 'none' }
                }
              >
                <CallView room={room} />
              </Box>
            )}
            {showBoth && (
              <div
                role="separator"
                style={{
                  width: '6px',
                  cursor: 'col-resize',
                  flexShrink: 0,
                  background: 'var(--bg-surface-border)',
                }}
                onMouseDown={handleDividerMouseDown}
              />
            )}
            <Box
              grow={showChatPanel ? 'Yes' : undefined}
              direction="Column"
              style={{ display: showChatPanel ? 'flex' : 'none' }}
            >
              <RoomView room={room} eventId={eventId} />
            </Box>
          </Box>
        </Box>
        {screenSize === ScreenSize.Desktop && isDrawer && (
          <>
            <Line variant="Background" direction="Vertical" size="300" />
            <MembersDrawer key={room.roomId} room={room} members={members} />
          </>
        )}
      </Box>
    </PowerLevelsContextProvider>
  );
}
