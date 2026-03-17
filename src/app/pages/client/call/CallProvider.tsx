import React, {
  createContext,
  useState,
  useContext,
  useMemo,
  useCallback,
  ReactNode,
  useEffect,
  useRef,
} from 'react';
import {
  WidgetApiToWidgetAction,
  WidgetApiAction,
  ClientWidgetApi,
  IWidgetApiRequestData,
} from 'matrix-widget-api';
import { useParams } from 'react-router-dom';
import { MatrixRTCSession } from 'matrix-js-sdk/lib/matrixrtc/MatrixRTCSession';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { SmallWidget } from '../../../features/call/SmallWidget';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';

interface MediaStatePayload {
  data?: {
    audio_enabled?: boolean;
    video_enabled?: boolean;
  };
}

const WIDGET_MEDIA_STATE_UPDATE_ACTION = 'io.element.device_mute';
const WIDGET_HANGUP_ACTION = 'im.vector.hangup';
const WIDGET_JOIN_ACTION = 'io.element.join';
const WIDGET_TILE_UPDATE = 'io.element.tile_layout';
// NOTE: set_always_on_screen is handled by SmallWidget.ts (stickyPromise support).

interface CallContextState {
  activeCallRoomId: string | null;
  setActiveCallRoomId: (roomId: string | null, isVoiceRoom?: boolean) => void;
  viewedCallRoomId: string | null;
  setViewedCallRoomId: (roomId: string | null) => void;
  hangUp: () => void;
  activeClientWidgetApi: ClientWidgetApi | null;
  activeClientWidget: SmallWidget | null;
  registerActiveClientWidgetApi: (
    roomId: string | null,
    clientWidgetApi: ClientWidgetApi | null,
    clientWidget: SmallWidget | null,
    activeClientIframeRef: HTMLIFrameElement | null
  ) => void;
  sendWidgetAction: <T extends IWidgetApiRequestData = IWidgetApiRequestData>(
    action: WidgetApiToWidgetAction | string,
    data: T
  ) => Promise<void>;
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  setAudioEnabled: (enabled: boolean) => void;
  setVideoEnabled: (enabled: boolean) => void;
  isChatOpen: boolean;
  isCallViewOpen: boolean;
  isActiveCallReady: boolean;
  resetActiveCallReady: () => void;
  toggleAudio: () => Promise<void>;
  toggleVideo: () => Promise<void>;
  toggleChat: () => Promise<void>;
  toggleCallView: () => void;
  pendingJoin: boolean;
  joinConfirmedRef: React.MutableRefObject<boolean>;
  confirmJoin: () => void;
}

const CallContext = createContext<CallContextState | undefined>(undefined);

interface CallProviderProps {
  children: ReactNode;
}

const DEFAULT_AUDIO_ENABLED = true;
const DEFAULT_VIDEO_ENABLED = false;
const DEFAULT_CHAT_OPENED = false;

export function CallProvider({ children }: CallProviderProps) {
  const mx = useMatrixClient();
  const [activeCallRoomId, setActiveCallRoomIdState] = useState<string | null>(null);
  const [viewedCallRoomId, setViewedCallRoomIdState] = useState<string | null>(null);

  const [activeClientWidgetApi, setActiveClientWidgetApiState] = useState<ClientWidgetApi | null>(
    null
  );
  const [activeClientWidget, setActiveClientWidget] = useState<SmallWidget | null>(null);
  const [activeClientWidgetApiRoomId, setActiveClientWidgetApiRoomId] = useState<string | null>(
    null
  );
  const [activeClientWidgetIframeRef, setActiveClientWidgetIframeRef] =
    useState<HTMLIFrameElement | null>(null);

  const [isAudioEnabled, setIsAudioEnabledState] = useState<boolean>(DEFAULT_AUDIO_ENABLED);
  const [isVideoEnabled, setIsVideoEnabledState] = useState<boolean>(DEFAULT_VIDEO_ENABLED);
  const [isChatOpen, setIsChatOpenState] = useState<boolean>(DEFAULT_CHAT_OPENED);
  const [isCallViewOpen, setIsCallViewOpenState] = useState<boolean>(false);
  const [isActiveCallReady, setIsActiveCallReady] = useState<boolean>(false);
  // Tracks whether m.call.notify has been sent for the current call session
  const callNotifySentRef = useRef<boolean>(false);

  const [callAutoJoin] = useSetting(settingsAtom, 'callAutoJoin');
  const [pendingJoin, setPendingJoin] = useState(false);
  // Ref avoids a one-render race: when activeCallRoomId first becomes non-null,
  // the pendingJoin state update hasn't flushed yet. PersistentCallContainer's
  // setupWidget effect checks this ref so it doesn't load the iframe too early.
  const joinConfirmedRef = useRef(false);

  // Reset pending-join state whenever the active call room changes.
  // callAutoJoin is intentionally read as a snapshot (not in deps) so that
  // changing the setting mid-call doesn't reset pending state unexpectedly.
  useEffect(() => {
    joinConfirmedRef.current = false;
    setPendingJoin(activeCallRoomId ? !callAutoJoin : false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCallRoomId]);

  const confirmJoin = useCallback(() => {
    joinConfirmedRef.current = true;
    setPendingJoin(false);
  }, []);

  const { roomIdOrAlias: viewedRoomId } = useParams<{ roomIdOrAlias: string }>();

  const setActiveCallRoomId = useCallback((roomId: string | null, isVoiceRoom = false) => {
    setActiveCallRoomIdState(roomId);
    callNotifySentRef.current = false;
    if (roomId !== null) {
      // Voice rooms: show call by default. Regular/DM rooms: show chat by default.
      setIsCallViewOpenState(isVoiceRoom);
      setIsChatOpenState(!isVoiceRoom);
      // Reset A/V state to defaults for each new call so a previously muted call
      // doesn't carry over into the pre-join screen of the next one.
      setIsAudioEnabledState(DEFAULT_AUDIO_ENABLED);
      setIsVideoEnabledState(DEFAULT_VIDEO_ENABLED);
    }
  }, []);

  const setViewedCallRoomId = useCallback(
    (roomId: string | null) => {
      setViewedCallRoomIdState(roomId);
    },
    [setViewedCallRoomIdState]
  );

  const setActiveClientWidgetApi = useCallback(
    (
      clientWidgetApi: ClientWidgetApi | null,
      clientWidget: SmallWidget | null,
      roomId: string | null,
      clientWidgetIframeRef: HTMLIFrameElement | null
    ) => {
      setActiveClientWidgetApiState(clientWidgetApi);
      setActiveClientWidget(clientWidget);
      setActiveClientWidgetApiRoomId(roomId);
      setActiveClientWidgetIframeRef(clientWidgetIframeRef);
    },
    []
  );

  const registerActiveClientWidgetApi = useCallback(
    (
      roomId: string | null,
      clientWidgetApi: ClientWidgetApi | null,
      clientWidget: SmallWidget | null,
      clientWidgetIframeRef: HTMLIFrameElement | null
    ) => {
      if (roomId && clientWidgetApi) {
        setActiveClientWidgetApi(clientWidgetApi, clientWidget, roomId, clientWidgetIframeRef);
      } else if (roomId === activeClientWidgetApiRoomId || roomId === null) {
        setActiveClientWidgetApi(null, null, null, null);
      }
    },
    [activeClientWidgetApiRoomId, setActiveClientWidgetApi]
  );

  const hangUp = useCallback(() => {
    // Capture iframe ref before clearing state, then blank it after a short delay
    // so EC has time to stop its own MediaStreamTracks before we navigate away.
    const iframeToBlank = activeClientWidgetIframeRef;
    setActiveClientWidgetApi(null, null, null, null);
    setActiveCallRoomIdState(null);
    activeClientWidgetApi?.transport.send(`${WIDGET_HANGUP_ACTION}`, {});
    setIsActiveCallReady(false);
    setIsCallViewOpenState(false);
    setPendingJoin(false);
    if (iframeToBlank) {
      setTimeout(() => { iframeToBlank.src = 'about:blank'; }, 300);
    }
  }, [activeClientWidgetApi?.transport, activeClientWidgetIframeRef, setActiveClientWidgetApi]);

  const sendWidgetAction = useCallback(
    async <T extends IWidgetApiRequestData = IWidgetApiRequestData>(
      action: WidgetApiToWidgetAction | string,
      data: T
    ): Promise<void> => {
      if (!activeClientWidgetApi) {
        return Promise.reject(new Error('No active call clientWidgetApi'));
      }
      if (!activeClientWidgetApiRoomId || activeClientWidgetApiRoomId !== activeCallRoomId) {
        return Promise.reject(new Error('Mismatched active call clientWidgetApi'));
      }

      await activeClientWidgetApi.transport.send(action as WidgetApiAction, data);

      return Promise.resolve();
    },
    [activeClientWidgetApi, activeCallRoomId, activeClientWidgetApiRoomId]
  );

  const toggleAudio = useCallback(async () => {
    const newState = !isAudioEnabled;
    setIsAudioEnabledState(newState);

    if (isActiveCallReady) {
      try {
        await sendWidgetAction(WIDGET_MEDIA_STATE_UPDATE_ACTION, {
          audio_enabled: newState,
          video_enabled: isVideoEnabled,
        });
      } catch (error) {
        setIsAudioEnabledState(!newState);
        throw error;
      }
    }
  }, [isAudioEnabled, isVideoEnabled, sendWidgetAction, isActiveCallReady]);

  const toggleVideo = useCallback(async () => {
    const newState = !isVideoEnabled;
    setIsVideoEnabledState(newState);

    if (isActiveCallReady) {
      try {
        await sendWidgetAction(WIDGET_MEDIA_STATE_UPDATE_ACTION, {
          audio_enabled: isAudioEnabled,
          video_enabled: newState,
        });
      } catch (error) {
        setIsVideoEnabledState(!newState);
        throw error;
      }
    }
  }, [isVideoEnabled, isAudioEnabled, sendWidgetAction, isActiveCallReady]);

  useEffect(() => {
    if (!activeCallRoomId && !viewedCallRoomId) {
      return;
    }

    if (!activeClientWidgetApi) {
      return;
    }

    const handleHangup = (ev: CustomEvent) => {
      ev.preventDefault();
      if (isActiveCallReady && ev.detail.widgetId === activeClientWidgetApi.widget.id) {
        activeClientWidgetApi.transport.reply(ev.detail, {});
        const iframeToBlank = activeClientWidgetIframeRef;
        setActiveCallRoomIdState(null);
        setActiveClientWidgetApi(null, null, null, null);
        setIsActiveCallReady(false);
        setIsCallViewOpenState(false);
        if (iframeToBlank) {
          setTimeout(() => { iframeToBlank.src = 'about:blank'; }, 300);
        }
      }
    };

    const handleMediaStateUpdate = (ev: CustomEvent<MediaStatePayload>) => {
      if (!isActiveCallReady) return;
      ev.preventDefault();

      /* eslint-disable camelcase */
      const { audio_enabled, video_enabled } = ev.detail.data ?? {};

      if (typeof audio_enabled === 'boolean' && audio_enabled !== isAudioEnabled) {
        setIsAudioEnabledState(audio_enabled);
      }
      if (typeof video_enabled === 'boolean' && video_enabled !== isVideoEnabled) {
        setIsVideoEnabledState(video_enabled);
      }
      /* eslint-enable camelcase */
    };

    // NOTE: set_always_on_screen is intentionally NOT handled here.
    // SmallWidget.ts handles it (with stickyPromise support + single reply).
    // Having a handler here too causes a double-reply after EC joins the lobby.

    const handleOnTileLayout = (ev: CustomEvent) => {
      ev.preventDefault();

      activeClientWidgetApi.transport.reply(ev.detail, {});
    };

    const handleJoin = (ev: CustomEvent) => {
      ev.preventDefault();

      activeClientWidgetApi.transport.reply(ev.detail, {});

      // Wrap iframe access in try-catch to prevent cross-origin errors
      // when Element Call is hosted on a different domain
      try {
        const iframeDoc =
          activeClientWidgetIframeRef?.contentWindow?.document ||
          activeClientWidgetIframeRef?.contentDocument;

        if (iframeDoc) {
          const observer = new MutationObserver(() => {
            const button = iframeDoc.querySelector('[data-testid="incall_leave"]');
            if (button) {
              button.addEventListener('click', () => {
                hangUp();
              });
            }
            observer.disconnect();
          });
          observer.observe(iframeDoc, { childList: true, subtree: true });
        }
      } catch (error) {
        // Ignore cross-origin errors - they're expected when Element Call is on a different domain
      }

      // Send m.call.notify (MSC4075) once per call session so other clients ring.
      // Triggered here (on io.element.join) rather than on setActiveCallRoomId because
      // all call starts pass isVoiceRoom=true, making the setActiveCallRoomId path unreachable.
      if (activeCallRoomId && !callNotifySentRef.current) {
        callNotifySentRef.current = true;
        const room = mx.getRoom(activeCallRoomId);
        if (room && MatrixRTCSession.callMembershipsForRoom(room).filter(
          (m) => m.sender !== mx.getUserId()
        ).length === 0) {
          const isDm = room.currentState.getJoinedMemberCount() <= 2;
          const otherMembers = room.getJoinedMembers()
            .map((m) => m.userId)
            .filter((id) => id !== mx.getUserId());
          mx.sendEvent(activeCallRoomId, 'm.call.notify', {
            call_id: '',
            application: 'm.call',
            'm.mentions': isDm ? { room: false, user_ids: otherMembers } : { room: true },
            notify_type: 'ring',
          }).catch(() => undefined);
        }
      }

      setIsActiveCallReady(true);
    };

    void sendWidgetAction(WIDGET_MEDIA_STATE_UPDATE_ACTION, {
      audio_enabled: isAudioEnabled,
      video_enabled: isVideoEnabled,
    }).catch(() => {
      // Widget transport may reject while call/session setup is still in progress.
    });

    activeClientWidgetApi.on(`action:${WIDGET_HANGUP_ACTION}`, handleHangup);
    activeClientWidgetApi.on(`action:${WIDGET_MEDIA_STATE_UPDATE_ACTION}`, handleMediaStateUpdate);
    activeClientWidgetApi.on(`action:${WIDGET_TILE_UPDATE}`, handleOnTileLayout);
    activeClientWidgetApi.on(`action:${WIDGET_JOIN_ACTION}`, handleJoin);

    return () => {
      activeClientWidgetApi.off(`action:${WIDGET_HANGUP_ACTION}`, handleHangup);
      activeClientWidgetApi.off(`action:${WIDGET_MEDIA_STATE_UPDATE_ACTION}`, handleMediaStateUpdate);
      activeClientWidgetApi.off(`action:${WIDGET_TILE_UPDATE}`, handleOnTileLayout);
      activeClientWidgetApi.off(`action:${WIDGET_JOIN_ACTION}`, handleJoin);
    };
  }, [
    activeClientWidgetIframeRef,
    activeClientWidgetApi,
    activeCallRoomId,
    activeClientWidgetApiRoomId,
    hangUp,
    isChatOpen,
    isAudioEnabled,
    isVideoEnabled,
    isActiveCallReady,
    viewedRoomId,
    viewedCallRoomId,
    setViewedCallRoomId,
    activeClientWidget?.iframe?.contentDocument,
    activeClientWidget?.iframe?.contentWindow?.document,
    sendWidgetAction,
  ]);

  const toggleChat = useCallback(async () => {
    const newState = !isChatOpen;
    setIsChatOpenState(newState);
  }, [isChatOpen]);

  const setAudioEnabled = useCallback((enabled: boolean) => {
    setIsAudioEnabledState(enabled);
  }, []);

  const setVideoEnabled = useCallback((enabled: boolean) => {
    setIsVideoEnabledState(enabled);
  }, []);

  const resetActiveCallReady = useCallback(() => {
    setIsActiveCallReady(false);
  }, []);

  const toggleCallView = useCallback(() => {
    setIsCallViewOpenState((prev) => !prev);
  }, []);

  const contextValue = useMemo<CallContextState>(
    () => ({
      activeCallRoomId,
      setActiveCallRoomId,
      viewedCallRoomId,
      setViewedCallRoomId,
      hangUp,
      activeClientWidgetApi,
      registerActiveClientWidgetApi,
      activeClientWidget,
      sendWidgetAction,
      isChatOpen,
      isCallViewOpen,
      isAudioEnabled,
      isVideoEnabled,
      setAudioEnabled,
      setVideoEnabled,
      isActiveCallReady,
      resetActiveCallReady,
      toggleAudio,
      toggleVideo,
      toggleChat,
      toggleCallView,
      pendingJoin,
      joinConfirmedRef,
      confirmJoin,
    }),
    [
      activeCallRoomId,
      setActiveCallRoomId,
      viewedCallRoomId,
      setViewedCallRoomId,
      hangUp,
      activeClientWidgetApi,
      registerActiveClientWidgetApi,
      activeClientWidget,
      sendWidgetAction,
      isChatOpen,
      isCallViewOpen,
      isAudioEnabled,
      isVideoEnabled,
      setAudioEnabled,
      setVideoEnabled,
      isActiveCallReady,
      resetActiveCallReady,
      toggleAudio,
      toggleVideo,
      toggleChat,
      toggleCallView,
      pendingJoin,
      joinConfirmedRef,
      confirmJoin,
    ]
  );

  return <CallContext.Provider value={contextValue}>{children}</CallContext.Provider>;
}

export function useCallState(): CallContextState {
  const context = useContext(CallContext);
  if (context === undefined) {
    throw new Error('useCallState must be used within a CallProvider');
  }
  return context;
}
