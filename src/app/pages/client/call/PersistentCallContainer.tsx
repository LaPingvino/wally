import React, {
  createContext,
  ReactNode,
  useCallback,
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
import { useClientConfig } from '../../../hooks/useClientConfig';
import { ScreenSize, useScreenSizeContext } from '../../../hooks/useScreenSize';
import { ThemeKind, useTheme } from '../../../hooks/useTheme';

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
    viewedCallRoomId,
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

  /* eslint-disable no-param-reassign */

  const setupWidget = useCallback(
    (
      widgetApiRef: React.MutableRefObject<ClientWidgetApi | null>,
      smallWidgetRef: React.MutableRefObject<SmallWidget | null>,
      iframeRef: React.MutableRefObject<HTMLIFrameElement | null>,
      themeKind: ThemeKind | null,
    ) => {
      if (mx?.getUserId()) {
        if (activeCallRoomId && !isActiveCallReady) {
          const roomIdToSet = activeCallRoomId;

          if (
            callSmallWidgetRef.current?.roomId &&
            activeClientWidget?.roomId &&
            activeClientWidget.roomId === callSmallWidgetRef.current?.roomId
          ) {
            return;
          }

          // Stop any previous widget instance before creating a new one.
          // Without this, the old ClientWidgetApi keeps waiting for ContentLoaded
          // indefinitely, producing a timeout warning in the console.
          if (callSmallWidgetRef.current) {
            callSmallWidgetRef.current.stopMessaging();
            callSmallWidgetRef.current = null;
          }

          const iframeElement = iframeRef.current;
          if (!iframeElement) {
            return;
          }

          // Determine room type and intent dynamically at load time.
          // If others are already in the call, use join_existing; otherwise start_call.
          // This avoids any iframe reload after io.element.join — a reload regenerates
          // EC's E2EE keys, making our media undecryptable to existing participants
          // (MissingKey errors at index 0) until the new keys are distributed.
          const room = mx.getRoom(roomIdToSet);
          const { intent: intentParam, callIntentParam } = getCallIntentParams(room);
          const hasOngoingCall = room
            ? MatrixRTCSession.callMembershipsForRoom(room).length > 0
            : false;
          const effectiveIntent = hasOngoingCall ? 'join_existing' : intentParam;
          const widgetId = `element-call-${roomIdToSet}-${Date.now()}`;
          const newUrl = getWidgetUrl(
            mx,
            roomIdToSet,
            clientConfig.elementCallUrl ?? '',
            widgetId,
            {
              intent: effectiveIntent,
              // Always skip EC's own lobby — we show our own pre-join screen instead.
              // skipLobby=true also means EC goes straight to the in-call grid with no
              // intermediate states that would otherwise require a reload.
              skipLobby: true,
              returnToLobby: 'true',
              // Per-participant E2EE requires the LiveKit SFU to be configured for it.
              // Passing 'true' on a non-E2EE SFU causes EC to throw "e2ee not configured".
              // Always pass 'false' here; the SFU/JWT service controls E2EE at the room level.
              perParticipantE2EE: 'false',
              theme: themeKind,
              callIntent: callIntentParam,
            },
          );

          const userId = mx.getUserId() ?? '';
          const app = createVirtualWidget(
            mx,
            widgetId,
            userId,
            'Element Call',
            'm.call',
            newUrl,
            // waitForIframeLoad: false — EC sends ContentLoaded when its React app is ready,
            // which triggers capabilities negotiation at the right time. With true, capabilities
            // are negotiated on iframe load (before EC is ready) and ContentLoaded gets an error
            // reply, leaving the widget channel partially broken and causing blank screen on join.
            false,
            getWidgetData(mx, roomIdToSet, {}, { callIntent: callIntentParam }),
            roomIdToSet,
          );

          const smallWidget = new SmallWidget(app);
          smallWidgetRef.current = smallWidget;

          // Set iframe.src BEFORE startMessaging — PostmessageTransport captures
          // iframe.contentWindow at construction time. If src is still "about:blank"
          // when ClientWidgetApi is constructed, the transport permanently targets the
          // dead about:blank window and EC never receives the ContentLoaded reply.
          if (!iframeElement.src || iframeElement.src !== newUrl.toString()) {
            iframeElement.src = newUrl.toString();
          }

          const widgetApiInstance = smallWidget.startMessaging(iframeElement);
          widgetApiRef.current = widgetApiInstance;
          registerActiveClientWidgetApi(
            roomIdToSet,
            widgetApiRef.current,
            smallWidget,
            iframeElement,
          );
        }
      }
    },
    [
      mx,
      activeCallRoomId,
      isActiveCallReady,
      clientConfig.elementCallUrl,
      activeClientWidget,
      registerActiveClientWidgetApi,
    ],
  );

  useEffect(() => {
    // Load EC when: autoJoin is on (pendingJoin=false from the start), OR when the user
    // has explicitly confirmed via the pre-join screen (joinConfirmedRef). Checking the
    // ref rather than pendingJoin alone avoids a one-render race where pendingJoin is
    // still false on the first render after activeCallRoomId is set (before the
    // pendingJoin effect in CallProvider runs).
    if (activeCallRoomId && (!pendingJoin || joinConfirmedRef.current)) {
      setupWidget(callWidgetApiRef, callSmallWidgetRef, callIframeRef, theme.kind);
    }
  }, [
    theme,
    setupWidget,
    callWidgetApiRef,
    callSmallWidgetRef,
    callIframeRef,
    registerActiveClientWidgetApi,
    activeCallRoomId,
    viewedCallRoomId,
    isActiveCallReady,
    pendingJoin,
    joinConfirmedRef,
  ]);

  // If EC has been loading for 15 seconds without becoming ready (isActiveCallReady=false),
  // reload the iframe. This recovers from the case where the widget API channel (ContentLoaded
  // → capabilities negotiation) fails to establish on the first load — EC can't get OpenID
  // credentials without a working channel, so it stays "Not connected yet" indefinitely.
  // The reload resets EC cleanly; the existing ClientWidgetApi instance stays and picks up the
  // new ContentLoaded after reload. Fires at most once per widget instance.
  useEffect(() => {
    const iframe = callIframeRef.current;
    if (!activeClientWidget || isActiveCallReady || !iframe) return;

    const timer = setTimeout(() => {
      const currentIframe = callIframeRef.current;
      if (currentIframe && currentIframe.src && currentIframe.src !== 'about:blank') {
        // Force EC to reload — same URL/widgetId so the existing ClientWidgetApi handles it.
        // eslint-disable-next-line no-self-assign
        currentIframe.src = currentIframe.src;
      }
    }, 15000);

    return () => clearTimeout(timer);
  }, [activeClientWidget, isActiveCallReady, callIframeRef]);

  const memoizedIframeRef = useMemo(() => callIframeRef, [callIframeRef]);

  return (
    <CallRefContext.Provider value={memoizedIframeRef}>
      {/* The iframe lives here (outside the room component tree) so it persists
          across room navigation. CallView positions it via fixed-position overlay. */}
      <iframe
        ref={callIframeRef}
        style={{
          position: 'fixed',
          // Hidden by default; CallView's applyFixedPositioningToIframe moves it
          // into the correct position and makes it visible when a call is active.
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          border: 'none',
          display: activeCallRoomId && !pendingJoin && isCallViewOpen && !(isMobile && isChatOpen) ? 'block' : 'none',
        }}
        title="Persistent Element Call"
        sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-modals allow-downloads"
        allow="microphone; camera; display-capture; autoplay; clipboard-write;"
        src="about:blank"
      />
      {children}
    </CallRefContext.Provider>
  );
}
