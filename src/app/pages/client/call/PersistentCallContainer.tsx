import React, {
  createContext,
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { MatrixRTCSession } from 'matrix-js-sdk/lib/matrixrtc/MatrixRTCSession';
import { ClientWidgetApi } from 'matrix-widget-api';
import { Box, Button, Icon, Icons, Text } from 'folds';
import { useCallState } from './CallProvider';
import {
  createVirtualWidget,
  SmallWidget,
  getWidgetData,
  getWidgetUrl,
  getCallIntentParams,
} from '../../../features/call/SmallWidget';
import { MicrophoneButton, VideoButton } from '../../../features/call/Controls';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useClientConfig } from '../../../hooks/useClientConfig';
import { ScreenSize, useScreenSizeContext } from '../../../hooks/useScreenSize';
import { ThemeKind, useTheme } from '../../../hooks/useTheme';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';

interface PersistentCallContainerProps {
  children: ReactNode;
}

export const CallRefContext =
  createContext<React.MutableRefObject<HTMLIFrameElement | null> | null>(null);

export function PersistentCallContainer({ children }: PersistentCallContainerProps) {
  const callIframeRef = useRef<HTMLIFrameElement | null>(null);
  const callWidgetApiRef = useRef<ClientWidgetApi | null>(null);
  const callSmallWidgetRef = useRef<SmallWidget | null>(null);
  // When autoJoin is off, hold at the pre-join screen until the user confirms.
  const [pendingJoin, setPendingJoin] = useState(false);
  // Tracks whether the user explicitly clicked Join (vs. pendingJoin=false from initialization).
  // Without this, the setupWidget effect fires on the very first render where activeCallRoomId
  // becomes non-null — pendingJoin hasn't updated yet (React state is one render behind), so
  // the effect would call setupWidget before the pre-join screen has even appeared.
  const joinConfirmedRef = useRef(false);
  const joinHeadingId = useId();

  const {
    activeCallRoomId,
    viewedCallRoomId,
    isChatOpen,
    isActiveCallReady,
    isAudioEnabled,
    isVideoEnabled,
    setAudioEnabled,
    setVideoEnabled,
    registerActiveClientWidgetApi,
    activeClientWidget,
    hangUp,
  } = useCallState();
  const mx = useMatrixClient();
  const clientConfig = useClientConfig();
  const screenSize = useScreenSizeContext();
  const theme = useTheme();
  const isMobile = screenSize === ScreenSize.Mobile;
  const [callAutoJoin] = useSetting(settingsAtom, 'callAutoJoin');

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
          // Only use per-participant E2EE if the room has Matrix encryption enabled.
          // Like gomuks: passing false overrides EC's own default of true for unencrypted rooms.
          const isRoomEncrypted = !!room?.currentState.getStateEvents('m.room.encryption', '');

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
              perParticipantE2EE: isRoomEncrypted ? 'true' : 'false',
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

  // When a call starts and autoJoin is off, show the pre-join screen.
  // Reset join confirmation and pending state whenever activeCallRoomId changes.
  useEffect(() => {
    joinConfirmedRef.current = false;
    setPendingJoin(activeCallRoomId ? !callAutoJoin : false);
  // Only run when activeCallRoomId changes (new call) — callAutoJoin is intentionally
  // read as a snapshot so its current value is used without re-triggering on setting changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCallRoomId]);

  useEffect(() => {
    // Load EC when: autoJoin is on, OR when autoJoin is off and the user has explicitly
    // confirmed via the pre-join screen (joinConfirmedRef). Checking the ref rather than
    // pendingJoin alone avoids a one-render race where pendingJoin is still false on the
    // first render after activeCallRoomId is set (before the pendingJoin effect runs).
    if (activeCallRoomId && (callAutoJoin || joinConfirmedRef.current)) {
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
    callAutoJoin,
  ]);

  const memoizedIframeRef = useMemo(() => callIframeRef, [callIframeRef]);

  const roomName = activeCallRoomId
    ? (mx?.getRoom(activeCallRoomId)?.name ?? 'Call')
    : 'Call';

  return (
    <CallRefContext.Provider value={memoizedIframeRef}>
      <Box grow="No">
        <Box
          direction="Column"
          style={{
            position: 'relative',
            zIndex: 0,
            display: isMobile && isChatOpen ? 'none' : 'flex',
            width: isMobile && isChatOpen ? '0%' : '100%',
            height: isMobile && isChatOpen ? '0%' : '100%',
          }}
        >
          <Box grow="Yes" style={{ position: 'relative' }}>
            <iframe
              ref={callIframeRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                display: pendingJoin ? 'none' : 'flex',
                width: '100%',
                height: '100%',
                border: 'none',
              }}
              title="Persistent Element Call"
              sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-modals allow-downloads"
              allow="microphone; camera; display-capture; autoplay; clipboard-write;"
              src="about:blank"
            />
            {pendingJoin && activeCallRoomId && (
              <Box
                role="dialog"
                aria-modal="true"
                aria-labelledby={joinHeadingId}
                direction="Column"
                alignItems="Center"
                justifyContent="Center"
                style={{ position: 'absolute', inset: 0, gap: '24px' }}
              >
                <Box
                  direction="Column"
                  alignItems="Center"
                  gap="400"
                  style={{ padding: '32px', maxWidth: '280px', width: '100%' }}
                >
                  <Icon src={Icons.Phone} size="600" />
                  <Text id={joinHeadingId} size="H4" style={{ textAlign: 'center' }}>
                    {roomName}
                  </Text>
                  <Box direction="Row" gap="300">
                    <MicrophoneButton
                      enabled={isAudioEnabled}
                      onToggle={() => setAudioEnabled(!isAudioEnabled)}
                    />
                    <VideoButton
                      enabled={isVideoEnabled}
                      onToggle={() => setVideoEnabled(!isVideoEnabled)}
                    />
                  </Box>
                  <Box direction="Row" gap="200">
                    <Button
                      variant="Critical"
                      fill="Soft"
                      onClick={hangUp}
                      aria-label="Cancel joining call"
                    >
                      <Text size="B400">Cancel</Text>
                    </Button>
                    <Button
                      // eslint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus
                      variant="Success"
                      fill="Solid"
                      before={<Icon src={Icons.Phone} size="200" filled />}
                      onClick={() => { joinConfirmedRef.current = true; setPendingJoin(false); }}
                      aria-label={`Join call in ${roomName}`}
                    >
                      <Text size="B400">Join</Text>
                    </Button>
                  </Box>
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      </Box>
      {children}
    </CallRefContext.Provider>
  );
}
