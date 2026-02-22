import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { IssueBoard } from '../issues/IssueBoard';
import { ThreadsDrawer, openThreadIdAtom } from './ThreadsDrawer';
import { useAtom } from 'jotai';

export function Room() {
  const { eventId } = useParams();
  const room = useRoom();
  const mx = useMatrixClient();

  const [isDrawer, setPeopleDrawer] = useSetting(settingsAtom, 'isPeopleDrawer');
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const screenSize = useScreenSizeContext();
  const powerLevels = usePowerLevels(room);
  const members = useRoomMembers(mx, room?.roomId);

  const { activeCallRoomId, isCallViewOpen, isChatOpen } = useCallState();
  const isActiveCall = activeCallRoomId === room?.roomId;

  const [isIssueBoard, setIsIssueBoard] = useState(false);
  const [isThreadsDrawer, setIsThreadsDrawer] = useState(false);
  const [openThreadId] = useAtom(openThreadIdAtom);

  // Reset all panel views when navigating to a different room.
  useEffect(() => {
    setIsIssueBoard(false);
    setIsThreadsDrawer(false);
  }, [room.roomId]);

  // When something (e.g. a timeline thread indicator) requests a thread to be opened,
  // ensure the threads drawer is visible. ThreadsDrawer itself handles resetting the atom.
  useEffect(() => {
    if (openThreadId) {
      setIsThreadsDrawer(true);
      setPeopleDrawer(false);
    }
  }, [openThreadId, setPeopleDrawer]);

  const handleThreadDividerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = threadWidthRef.current;
    const onMove = (me: PointerEvent) => {
      // Divider is on the LEFT of the thread panel, so dragging left = wider thread
      const newWidth = Math.max(200, Math.min(600, startWidth - (me.clientX - startX)));
      threadWidthRef.current = newWidth;
      setThreadPanelWidth(newWidth);
    };
    const onUp = () => {
      localStorage.setItem(THREAD_WIDTH_KEY, String(threadWidthRef.current));
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  const handleToggleThreadsDrawer = useCallback(() => {
    setIsThreadsDrawer((open) => {
      const opening = !open;
      // Close members drawer when opening threads to avoid two sidebars
      if (opening) setPeopleDrawer(false);
      return opening;
    });
  }, [setPeopleDrawer]);

  useEffect(() => {
    const name = room.name || room.roomId;
    document.title = `${name} – Cinny`;
    return () => {
      document.title = 'Cinny';
    };
  }, [room.name, room.roomId]);

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

  // Thread panel width — persisted in localStorage
  const THREAD_WIDTH_KEY = 'cinny_thread_panel_width';
  const getStoredThreadWidth = () => {
    const stored = localStorage.getItem(THREAD_WIDTH_KEY);
    return stored ? Math.max(200, Math.min(600, Number(stored))) : 320;
  };
  const threadWidthRef = useRef<number>(getStoredThreadWidth());
  const [threadPanelWidth, setThreadPanelWidth] = useState<number>(threadWidthRef.current);

  const handleDividerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const container = containerRef.current;
    if (!container) return;
    const startX = e.clientX;
    const startRatio = splitRatioRef.current;
    const totalWidth = container.getBoundingClientRect().width;
    const onMove = (me: PointerEvent) => {
      const ratio = Math.max(0.2, Math.min(0.8, startRatio + (me.clientX - startX) / totalWidth));
      splitRatioRef.current = ratio;
      setSplitRatio(ratio);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
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
          <RoomViewHeader
            isIssueBoard={isIssueBoard}
            onToggleIssueBoard={() => setIsIssueBoard((b) => !b)}
            isThreadsDrawer={isThreadsDrawer}
            onToggleThreadsDrawer={handleToggleThreadsDrawer}
          />
          <Box grow="Yes" ref={containerRef}>
            {isIssueBoard ? (
              <IssueBoard room={room} />
            ) : (
              <>
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
                    onPointerDown={handleDividerPointerDown}
                  />
                )}
                <Box
                  grow={showChatPanel ? 'Yes' : undefined}
                  direction="Column"
                  style={{ display: showChatPanel ? 'flex' : 'none' }}
                >
                  <RoomView room={room} eventId={eventId} />
                </Box>
              </>
            )}
          </Box>
        </Box>
        {screenSize === ScreenSize.Desktop && isDrawer && (
          <>
            <Line variant="Background" direction="Vertical" size="300" />
            <MembersDrawer key={room.roomId} room={room} members={members} />
          </>
        )}
        {screenSize === ScreenSize.Desktop && isThreadsDrawer && (
          <>
            <div
              role="separator"
              style={{
                width: '6px',
                cursor: 'col-resize',
                flexShrink: 0,
                background: 'var(--bg-surface-border)',
              }}
              onPointerDown={handleThreadDividerPointerDown}
            />
            <ThreadsDrawer
              key={room.roomId}
              room={room}
              onClose={handleToggleThreadsDrawer}
              width={threadPanelWidth}
            />
          </>
        )}
      </Box>
    </PowerLevelsContextProvider>
  );
}
