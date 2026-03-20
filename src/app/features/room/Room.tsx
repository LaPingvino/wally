import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box } from 'folds';
import { useParams } from 'react-router-dom';
import { isKeyHotkey } from 'is-hotkey';
import { useAtomValue } from 'jotai';
import { RoomView } from './RoomView';
import { MembersDrawer } from './MembersDrawer';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { PowerLevelsContextProvider, usePowerLevels } from '../../hooks/usePowerLevels';
import { useIsDirectRoom, useRoom } from '../../hooks/useRoom';
import { useRoomName } from '../../hooks/useRoomMeta';
import { useKeyDown } from '../../hooks/useKeyDown';
import { markAsRead } from '../../utils/notifications';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomMembers } from '../../hooks/useRoomMembers';
import { CallView } from '../call/CallView';
import { RoomViewHeader } from './RoomViewHeader';
import { useCallState } from '../../pages/client/call/CallProvider';
import { IssueBoard } from '../issues/IssueBoard';
import { ThreadsDrawer, openThreadIdAtom } from './ThreadsDrawer';
import { WidgetsDrawer } from './WidgetsDrawer';
import { useAtom } from 'jotai';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { useToolbarConfig } from '../../hooks/useToolbarConfig';

const PANEL_DIVIDER_STYLE: React.CSSProperties = {
  width: '6px',
  cursor: 'col-resize',
  flexShrink: 0,
  background: 'var(--bg-surface-border)',
};

export function Room() {
  const { eventId } = useParams();
  const room = useRoom();
  const mx = useMatrixClient();
  const direct = useIsDirectRoom();
  const roomDisplayName = useRoomName(room, direct);

  const [isDrawer, setPeopleDrawer] = useSetting(settingsAtom, 'isPeopleDrawer');
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const screenSize = useScreenSizeContext();
  const powerLevels = usePowerLevels(room);
  const members = useRoomMembers(mx, room?.roomId);

  const { activeCallRoomId, setActiveCallRoomId, hangUp, isCallViewOpen, isChatOpen } = useCallState();
  const isActiveCall = activeCallRoomId === room?.roomId;

  const [isIssueBoard, setIsIssueBoard] = useState(false);
  const [isThreadsDrawer, setIsThreadsDrawer] = useState(false);
  const [isWidgetsDrawer, setIsWidgetsDrawer] = useState(false);
  const [rightPanelFullWidth, setRightPanelFullWidth] = useState(false);
  const [openThreadId] = useAtom(openThreadIdAtom);

  const { getEffective, setItem: setToolbarItem } = useToolbarConfig();

  // Resizable panels
  const { width: threadPanelWidth, onDividerPointerDown: handleThreadDividerPointerDown } =
    useResizablePanel(320, 200, 600, 'cinny_thread_panel_width');
  const { width: widgetPanelWidth, onDividerPointerDown: handleWidgetDividerPointerDown } =
    useResizablePanel(420, 280, 700, 'cinny_widget_panel_width');
  const { width: memberPanelWidth, onDividerPointerDown: handleMemberDividerPointerDown } =
    useResizablePanel(266, 180, 500, 'cinny_member_panel_width');

  // Reset all panel views when navigating to a different room.
  useEffect(() => {
    setIsIssueBoard(false);
    setIsThreadsDrawer(false);
    setIsWidgetsDrawer(false);
    setRightPanelFullWidth(false);
  }, [room.roomId]);

  // When something (e.g. a timeline thread indicator) requests a thread to be opened,
  // ensure the threads drawer is visible. ThreadsDrawer itself handles resetting the atom.
  useEffect(() => {
    if (openThreadId) {
      setIsThreadsDrawer(true);
      setPeopleDrawer(false);
      setIsWidgetsDrawer(false);
    }
  }, [openThreadId, setPeopleDrawer]);

  const handleToggleThreadsDrawer = useCallback(() => {
    setIsThreadsDrawer((open) => {
      const opening = !open;
      if (opening) {
        setPeopleDrawer(false);
        setIsWidgetsDrawer(false);
        if (getEffective('threads').defaultMode === 'fullwidth') setRightPanelFullWidth(true);
        else setRightPanelFullWidth(false);
      } else {
        setRightPanelFullWidth(false);
      }
      return opening;
    });
  }, [setPeopleDrawer, getEffective]);

  const handleToggleWidgetsDrawer = useCallback(() => {
    setIsWidgetsDrawer((open) => {
      const opening = !open;
      if (opening) {
        setPeopleDrawer(false);
        setIsThreadsDrawer(false);
        if (getEffective('widgets').defaultMode === 'fullwidth') setRightPanelFullWidth(true);
        else setRightPanelFullWidth(false);
      } else {
        setRightPanelFullWidth(false);
      }
      return opening;
    });
  }, [setPeopleDrawer, getEffective]);

  const handleTogglePeopleDrawer = useCallback(() => {
    setPeopleDrawer((open) => {
      const opening = !open;
      if (opening) {
        setIsThreadsDrawer(false);
        setIsWidgetsDrawer(false);
        if (getEffective('members').defaultMode === 'fullwidth') setRightPanelFullWidth(true);
        else setRightPanelFullWidth(false);
      } else {
        setRightPanelFullWidth(false);
      }
      return opening;
    });
  }, [setPeopleDrawer, getEffective]);

  useEffect(() => {
    document.title = `${roomDisplayName || room.roomId} – Wally`;
    return () => {
      document.title = 'Wally';
    };
  }, [roomDisplayName, room.roomId]);

  const isVoiceRoom = room.isCallRoom();

  // Auto-join voice rooms on direct navigation (URL navigation or page reload).
  // RoomNavItem handles the click case; this effect covers the URL case where
  // setActiveCallRoomId was never called and isCallViewOpen stays false.
  // Skip if the call is already active for this room (prevents overwriting
  // isChatOpen state set by the chat button click).
  useEffect(() => {
    if (isVoiceRoom && activeCallRoomId !== room.roomId) {
      if (activeCallRoomId) hangUp();
      setActiveCallRoomId(room.roomId, true);
    }
  }, [isVoiceRoom, room.roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  const isCallLayout = isVoiceRoom || isActiveCall;
  const showCallPanel = isCallLayout && isCallViewOpen;
  // Voice rooms: show chat by default when call panel is closed (no isChatOpen state needed).
  // Regular rooms with call: only show chat when explicitly toggled (isChatOpen).
  const showChatPanel = !isCallLayout || isChatOpen || (isVoiceRoom && !isCallViewOpen);
  const showBoth = showCallPanel && showChatPanel && screenSize === ScreenSize.Desktop;

  const containerRef = useRef<HTMLDivElement>(null);
  const splitRatioRef = useRef(0.5);
  const [splitRatio, setSplitRatio] = useState(0.5);

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

  const anyRightPanel = isDrawer || isWidgetsDrawer || isThreadsDrawer;

  return (
    <PowerLevelsContextProvider value={powerLevels}>
      <Box grow="Yes">
        <Box
          grow="Yes"
          direction="Column"
          style={{ display: rightPanelFullWidth && anyRightPanel ? 'none' : 'flex' }}
        >
          <RoomViewHeader
            isIssueBoard={isIssueBoard}
            onToggleIssueBoard={() => setIsIssueBoard((b) => !b)}
            isThreadsDrawer={isThreadsDrawer}
            onToggleThreadsDrawer={handleToggleThreadsDrawer}
            isWidgetsDrawer={isWidgetsDrawer}
            onToggleWidgetsDrawer={handleToggleWidgetsDrawer}
            onTogglePeopleDrawer={handleTogglePeopleDrawer}
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
                  <RoomView eventId={eventId} />
                </Box>
              </>
            )}
          </Box>
        </Box>
        {screenSize === ScreenSize.Desktop && isDrawer && (
          <>
            {!rightPanelFullWidth && (
              <div
                role="separator"
                style={PANEL_DIVIDER_STYLE}
                onPointerDown={handleMemberDividerPointerDown}
              />
            )}
            <MembersDrawer
              key={room.roomId}
              room={room}
              members={members}
              width={memberPanelWidth}
              isFullWidth={rightPanelFullWidth}
              onToggleFullWidth={() => setRightPanelFullWidth((v) => {
                const next = !v;
                setToolbarItem('members', { defaultMode: next ? 'fullwidth' : 'sidebar' });
                return next;
              })}
            />
          </>
        )}
        {screenSize === ScreenSize.Desktop && isWidgetsDrawer && (
          <>
            {!rightPanelFullWidth && (
              <div
                role="separator"
                style={PANEL_DIVIDER_STYLE}
                onPointerDown={handleWidgetDividerPointerDown}
              />
            )}
            <WidgetsDrawer
              key={room.roomId}
              room={room}
              onClose={() => setIsWidgetsDrawer(false)}
              width={widgetPanelWidth}
              isFullWidth={rightPanelFullWidth}
              onToggleFullWidth={() => setRightPanelFullWidth((v) => {
                const next = !v;
                setToolbarItem('widgets', { defaultMode: next ? 'fullwidth' : 'sidebar' });
                return next;
              })}
            />
          </>
        )}
        {screenSize === ScreenSize.Desktop && isThreadsDrawer && (
          <>
            {!rightPanelFullWidth && (
              <div
                role="separator"
                style={PANEL_DIVIDER_STYLE}
                onPointerDown={handleThreadDividerPointerDown}
              />
            )}
            <ThreadsDrawer
              key={room.roomId}
              room={room}
              onClose={handleToggleThreadsDrawer}
              width={threadPanelWidth}
              isFullWidth={rightPanelFullWidth}
              onToggleFullWidth={() => setRightPanelFullWidth((v) => {
                const next = !v;
                setToolbarItem('threads', { defaultMode: next ? 'fullwidth' : 'sidebar' });
                return next;
              })}
            />
          </>
        )}
      </Box>
    </PowerLevelsContextProvider>
  );
}
