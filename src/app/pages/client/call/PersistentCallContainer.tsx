import React, {
  createContext,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { MatrixRTCSession } from 'matrix-js-sdk/lib/matrixrtc/MatrixRTCSession';
import { ClientWidgetApi } from 'matrix-widget-api';
import { useCallState } from './CallProvider';
import {
  createVirtualWidget,
  SmallWidget,
  getWidgetData,
  getWidgetUrl,
  getCallIntentParams,
} from '../../../features/call/SmallWidget';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { callDebug } from '../../../features/call/callDebug';
import { useClientConfig } from '../../../hooks/useClientConfig';
import { ScreenSize, useScreenSizeContext } from '../../../hooks/useScreenSize';
import { useTheme } from '../../../hooks/useTheme';

interface PersistentCallContainerProps {
  children: ReactNode;
}

export const CallRefContext =
  createContext<React.MutableRefObject<HTMLIFrameElement | null> | null>(null);

export function PersistentCallContainer({ children }: PersistentCallContainerProps) {
  const callIframeRef = useRef<HTMLIFrameElement | null>(null);
  const callWidgetApiRef = useRef<ClientWidgetApi | null>(null);
  const callSmallWidgetRef = useRef<SmallWidget | null>(null);

  const {
    activeCallRoomId,
    isChatOpen,
    isActiveCallReady,
    isCallViewOpen,
    registerActiveClientWidgetApi,
    activeClientWidget,
    pendingJoin,
    joinConfirmedRef,
  } = useCallState();
  const mx = useMatrixClient();
  const clientConfig = useClientConfig();
  const screenSize = useScreenSizeContext();
  const theme = useTheme();
  const isMobile = screenSize === ScreenSize.Mobile;

  // ── Cleanup: clear stale widget ref when the call ends ─────────────
  useEffect(() => {
    if (!activeCallRoomId && callSmallWidgetRef.current) {
      callDebug('state', 'Cleanup: tearing down widget (call ended)');
      callSmallWidgetRef.current.stopMessaging();
      callSmallWidgetRef.current = null;
      callWidgetApiRef.current = null;
    }
  }, [activeCallRoomId]);

  // ── Widget setup: load EC when a call room is active ──────────────
  // Respects the callAutoJoin setting: if off, pendingJoin=true until the
  // user confirms via the pre-join screen (joinConfirmedRef).
  useEffect(() => {
    if (!activeCallRoomId || !mx?.getUserId() || isActiveCallReady) return;
    if (pendingJoin && !joinConfirmedRef.current) return;

    const iframeElement = callIframeRef.current;
    if (!iframeElement) return;

    // Skip if already set up for this room AND the iframe is actually loaded
    // (not about:blank). After hangup, callSmallWidgetRef keeps the old widget
    // but the iframe navigates to about:blank — the ref is stale and must not
    // block re-creation.
    if (
      callSmallWidgetRef.current?.roomId &&
      callSmallWidgetRef.current.roomId === activeCallRoomId &&
      iframeElement.src !== 'about:blank' &&
      iframeElement.src !== ''
    ) {
      return;
    }

    // Tear down any previous widget instance cleanly.
    if (callSmallWidgetRef.current) {
      callSmallWidgetRef.current.stopMessaging();
      callSmallWidgetRef.current = null;
    }

    const roomId = activeCallRoomId;
    const room = mx.getRoom(roomId);
    const { intent: intentParam, callIntentParam } = getCallIntentParams(room);
    const hasOngoingCall = room
      ? MatrixRTCSession.callMembershipsForRoom(room).length > 0
      : false;

    callDebug('widget', 'Widget setup start', { roomId, intent: hasOngoingCall ? 'join_existing' : intentParam, hasOngoingCall, elementCallUrl: clientConfig.elementCallUrl ?? '(bundled)' });

    const widgetId = `element-call-${roomId}-${Date.now()}`;
    const url = getWidgetUrl(
      mx,
      roomId,
      clientConfig.elementCallUrl ?? '',
      widgetId,
      {
        intent: hasOngoingCall ? 'join_existing' : intentParam,
        skipLobby: true,
        returnToLobby: 'true',
        perParticipantE2EE: 'false',
        theme: theme.kind,
        callIntent: callIntentParam,
      },
    );

    const userId = mx.getUserId() ?? '';
    const app = createVirtualWidget(
      mx, widgetId, userId, 'Element Call', 'm.call', url,
      false, // waitForIframeLoad — EC sends ContentLoaded when ready
      getWidgetData(mx, roomId, {}, { callIntent: callIntentParam }),
      roomId,
    );

    const smallWidget = new SmallWidget(app);
    callSmallWidgetRef.current = smallWidget;

    // Navigate iframe FIRST — PostmessageTransport needs a valid contentWindow.
    iframeElement.src = url.toString();

    // Start widget API messaging AFTER src is set (same tick — the page load
    // is async so the listener is ready long before EC sends ContentLoaded).
    const widgetApi = smallWidget.startMessaging(iframeElement);
    callDebug('widget', 'Widget API created', { widgetId });
    callWidgetApiRef.current = widgetApi;
    registerActiveClientWidgetApi(roomId, widgetApi, smallWidget, iframeElement);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCallRoomId, isActiveCallReady, pendingJoin, mx, theme.kind, clientConfig.elementCallUrl, registerActiveClientWidgetApi]);

  // ── Health check: reload EC if widget channel fails to establish ───
  useEffect(() => {
    const iframe = callIframeRef.current;
    if (!activeClientWidget || isActiveCallReady || !iframe) return;

    let reloaded = false;
    const reload = () => {
      if (reloaded) return;
      reloaded = true;
      callDebug('error', 'Health check: reloading EC iframe');
      const el = callIframeRef.current;
      if (el && el.src && el.src !== 'about:blank') {
        // eslint-disable-next-line no-self-assign
        el.src = el.src;
      }
    };

    activeClientWidget.once('error:preparing', reload);
    const timer = setTimeout(reload, 8000);
    const onReady = () => clearTimeout(timer);
    activeClientWidget.once('ready', onReady);

    return () => {
      clearTimeout(timer);
      activeClientWidget.off('error:preparing', reload);
      activeClientWidget.off('ready', onReady);
    };
  }, [activeClientWidget, isActiveCallReady]);

  // ── Resize nudge: tell EC to re-layout when iframe becomes visible ─
  const iframeVisible = !!(activeCallRoomId && !pendingJoin && isCallViewOpen && !(isMobile && isChatOpen));
  useEffect(() => {
    if (!iframeVisible) return;
    const iframe = callIframeRef.current;
    if (!iframe) return;
    const timer = setTimeout(() => {
      try { iframe.contentWindow?.dispatchEvent(new Event('resize')); } catch { /* cross-origin */ }
    }, 150);
    return () => clearTimeout(timer);
  }, [iframeVisible, isActiveCallReady]);

  const memoizedIframeRef = useMemo(() => callIframeRef, [callIframeRef]);

  return (
    <CallRefContext.Provider value={memoizedIframeRef}>
      <iframe
        ref={callIframeRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          border: 'none',
          // Visible as soon as the call room is active and call view is open.
          // EC's own lobby is the join screen — no need to wait for pendingJoin.
          display: iframeVisible ? 'block' : 'none',
        }}
        title="Element Call"
        sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-modals allow-downloads"
        allow="microphone; camera; display-capture; autoplay; clipboard-write;"
        src="about:blank"
      />
      {children}
    </CallRefContext.Provider>
  );
}
