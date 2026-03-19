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

const MAX_RELOAD_RETRIES = 2;

export function PersistentCallContainer({ children }: PersistentCallContainerProps) {
  const callIframeRef = useRef<HTMLIFrameElement | null>(null);
  const callWidgetApiRef = useRef<ClientWidgetApi | null>(null);
  const callSmallWidgetRef = useRef<SmallWidget | null>(null);
  const reloadCountRef = useRef(0);

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
    // Refs (callWidgetApiRef, callSmallWidgetRef, callIframeRef, joinConfirmedRef) are
    // stable and never change — intentionally excluded from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme.kind, setupWidget, activeCallRoomId, pendingJoin]);

  // Watch the widget channel health and reload EC if it fails to establish.
  // SmallWidget emits 'ready' when ContentLoaded + capabilities negotiation succeed, and
  // 'error:preparing' if the channel errors. Without a working channel EC can't get OpenID
  // credentials and stays "Not connected yet" indefinitely.
  // We reload the same URL/widgetId so the existing ClientWidgetApi picks up the new
  // ContentLoaded without needing to be recreated.
  useEffect(() => {
    const iframe = callIframeRef.current;
    if (!activeClientWidget || isActiveCallReady || !iframe) return;

    // Reset retry counter when a brand-new widget is registered.
    reloadCountRef.current = 0;

    const reload = () => {
      if (reloadCountRef.current >= MAX_RELOAD_RETRIES) return;
      reloadCountRef.current += 1;
      const currentIframe = callIframeRef.current;
      if (currentIframe && currentIframe.src && currentIframe.src !== 'about:blank') {
        // eslint-disable-next-line no-self-assign
        currentIframe.src = currentIframe.src;
      }
    };

    // Reload immediately if the widget API signals a preparation error.
    activeClientWidget.once('error:preparing', reload);

    // Fallback: if 'ready' hasn't fired after 8 seconds the channel is stuck — reload.
    const timer = setTimeout(reload, 8000);

    // Cancel the fallback timer once the widget channel is established ('ready' = ContentLoaded
    // received + capabilities negotiated). LiveKit may still be connecting at this point — that
    // is normal and does not require a reload.
    const onReady = () => clearTimeout(timer);
    activeClientWidget.once('ready', onReady);

    return () => {
      clearTimeout(timer);
      activeClientWidget.off('error:preparing', reload);
      activeClientWidget.off('ready', onReady);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClientWidget, isActiveCallReady]);

  // Poke EC with a resize event when the iframe becomes visible or the call
  // becomes ready. EC lays out its participant grid based on viewport size —
  // if the grid was rendered while the iframe was display:none (0×0), tiles
  // are laid out at zero size and never re-flow when the iframe appears.
  const iframeVisible = !!(activeCallRoomId && !pendingJoin && isCallViewOpen && !(isMobile && isChatOpen));
  useEffect(() => {
    if (!iframeVisible) return;
    const iframe = callIframeRef.current;
    if (!iframe) return;
    // Small delay: the browser needs a frame to apply the display:block and
    // compute the actual dimensions before EC's resize handler can read them.
    const timer = setTimeout(() => {
      try {
        iframe.contentWindow?.dispatchEvent(new Event('resize'));
      } catch {
        // cross-origin — ignore
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [iframeVisible, isActiveCallReady]);

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
