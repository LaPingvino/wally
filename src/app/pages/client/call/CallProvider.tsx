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
import { useParams } from 'react-router-dom';
import { MatrixRTCSession } from 'matrix-js-sdk/lib/matrixrtc/MatrixRTCSession';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { callDebug } from '../../../features/call/callDebug';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';

interface CallContextState {
  // Room state
  activeCallRoomId: string | null;
  setActiveCallRoomId: (roomId: string | null, isVoiceRoom?: boolean) => void;
  viewedCallRoomId: string | null;
  setViewedCallRoomId: (roomId: string | null) => void;

  // LiveKit connection
  lkUrl: string;
  lkToken: string;
  lkConnected: boolean;
  setLkCredentials: (url: string, token: string) => void;
  setLkConnected: (connected: boolean) => void;

  // Call actions
  hangUp: () => void;

  // Media state
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  setAudioEnabled: (enabled: boolean) => void;
  setVideoEnabled: (enabled: boolean) => void;
  toggleAudio: () => Promise<void>;
  toggleVideo: () => Promise<void>;

  // UI state
  isChatOpen: boolean;
  isCallViewOpen: boolean;
  toggleChat: () => Promise<void>;
  toggleCallView: () => void;

  // Pre-join
  pendingJoin: boolean;
  joinConfirmedRef: React.MutableRefObject<boolean>;
  confirmJoin: () => void;
}

const CallContext = createContext<CallContextState | undefined>(undefined);

interface CallProviderProps {
  children: ReactNode;
}

const DEFAULT_AUDIO_ENABLED = false;
const DEFAULT_VIDEO_ENABLED = false;
const DEFAULT_CHAT_OPENED = false;
const SESSION_KEY = 'wally_active_call';

interface PersistedCallState {
  roomId: string;
  audio: boolean;
  video: boolean;
  isVoiceRoom: boolean;
}

function loadPersistedCall(): PersistedCallState | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function persistCall(state: PersistedCallState | null): void {
  if (state) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } else {
    sessionStorage.removeItem(SESSION_KEY);
  }
}

export function CallProvider({ children }: CallProviderProps) {
  const mx = useMatrixClient();
  const restored = useRef(loadPersistedCall());

  // Validate restored call — don't rejoin if we left the room or it was deleted
  if (restored.current?.roomId) {
    const restoredRoom = mx.getRoom(restored.current.roomId);
    if (!restoredRoom || restoredRoom.getMyMembership() !== 'join') {
      callDebug('state', 'Discarding stale session restore — room not joined', { roomId: restored.current.roomId });
      persistCall(null);
      restored.current = null;
    }
  }

  const [activeCallRoomId, setActiveCallRoomIdState] = useState<string | null>(restored.current?.roomId ?? null);
  const [viewedCallRoomId, setViewedCallRoomIdState] = useState<string | null>(null);

  // LiveKit connection state
  const [lkUrl, setLkUrl] = useState<string>('');
  const [lkToken, setLkToken] = useState<string>('');
  const [lkConnected, setLkConnectedState] = useState<boolean>(false);

  const [isAudioEnabled, setIsAudioEnabledState] = useState<boolean>(restored.current?.audio ?? DEFAULT_AUDIO_ENABLED);
  const [isVideoEnabled, setIsVideoEnabledState] = useState<boolean>(restored.current?.video ?? DEFAULT_VIDEO_ENABLED);
  const [isChatOpen, setIsChatOpenState] = useState<boolean>(DEFAULT_CHAT_OPENED);
  const [isCallViewOpen, setIsCallViewOpenState] = useState<boolean>(restored.current?.isVoiceRoom ?? false);

  // Refs keep handler closures up-to-date without being effect dependencies.
  const activeCallRoomIdRef = useRef(activeCallRoomId);
  activeCallRoomIdRef.current = activeCallRoomId;
  // Tracks whether m.call.notify has been sent for the current call session
  const callNotifySentRef = useRef<boolean>(false);

  const [callAutoJoin] = useSetting(settingsAtom, 'callAutoJoin');
  // On restore from sessionStorage, skip pre-join — go straight to connecting
  const isRestored = !!restored.current;
  const [pendingJoin, setPendingJoin] = useState(false);
  const joinConfirmedRef = useRef(isRestored);

  // Clear restored state after first render so it doesn't affect future calls
  useEffect(() => { restored.current = null; }, []);

  const confirmJoin = useCallback(() => {
    joinConfirmedRef.current = true;
    setPendingJoin(false);
  }, []);

  const { roomIdOrAlias: viewedRoomId } = useParams<{ roomIdOrAlias: string }>();

  const setActiveCallRoomId = useCallback((roomId: string | null, isVoiceRoom = false) => {
    setActiveCallRoomIdState(roomId);
    callDebug('state', 'setActiveCallRoomId', { roomId, isVoiceRoom, callAutoJoin, pendingJoin: roomId ? !callAutoJoin : false });
    callNotifySentRef.current = false;
    joinConfirmedRef.current = false;
    setPendingJoin(roomId ? !callAutoJoin : false);
    if (roomId !== null) {
      setIsCallViewOpenState(isVoiceRoom);
      setIsChatOpenState(!isVoiceRoom);
      setIsAudioEnabledState(DEFAULT_AUDIO_ENABLED);
      setIsVideoEnabledState(DEFAULT_VIDEO_ENABLED);
      persistCall({ roomId, audio: DEFAULT_AUDIO_ENABLED, video: DEFAULT_VIDEO_ENABLED, isVoiceRoom });
    } else {
      persistCall(null);
    }
  }, [callAutoJoin]);

  const setViewedCallRoomId = useCallback(
    (roomId: string | null) => {
      setViewedCallRoomIdState(roomId);
    },
    [setViewedCallRoomIdState]
  );

  const setLkCredentials = useCallback((url: string, token: string) => {
    callDebug('livekit', 'setLkCredentials', { url: url.substring(0, 30) + '...' });
    setLkUrl(url);
    setLkToken(token);
  }, []);

  const setLkConnected = useCallback((connected: boolean) => {
    callDebug('livekit', 'setLkConnected', { connected });
    setLkConnectedState(connected);
  }, []);

  const hangUp = useCallback(() => {
    callDebug('state', 'hangUp');
    setActiveCallRoomIdState(null);
    setLkUrl('');
    setLkToken('');
    setLkConnectedState(false);
    setIsCallViewOpenState(false);
    setPendingJoin(false);
    persistCall(null);
  }, []);

  // Persist current media state on page unload so refresh reconnects with same settings
  useEffect(() => {
    const onBeforeUnload = () => {
      const roomId = activeCallRoomIdRef.current;
      if (roomId) {
        persistCall({ roomId, audio: isAudioEnabled, video: isVideoEnabled, isVoiceRoom: isCallViewOpen });
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isAudioEnabled, isVideoEnabled, isCallViewOpen]);

  // Send m.call.notify (MSC4075) when LK connects, so other clients ring.
  useEffect(() => {
    if (!lkConnected) return;

    const currentRoomId = activeCallRoomIdRef.current;
    if (!currentRoomId || callNotifySentRef.current) return;

    callNotifySentRef.current = true;
    const room = mx.getRoom(currentRoomId);
    if (room && MatrixRTCSession.callMembershipsForRoom(room).filter(
      (m) => m.sender !== mx.getUserId()
    ).length === 0) {
      // Priority-load the full roster before deciding who to ring. Under sliding sync the live roster
      // is $LAZY-only, so getJoinedMembers() can omit a DM partner (→ ring nobody) or under-count a
      // group (→ misclassify as a DM and ring only the loaded few). Starting a call is a one-shot
      // user action, exactly where an on-demand member fetch belongs.
      (async () => {
        const forceable = room as unknown as { forceLoadMembers?: () => Promise<unknown> };
        try {
          await forceable.forceLoadMembers?.();
        } catch {
          /* fall back to whatever roster we have */
        }
        const isDm = room.currentState.getJoinedMemberCount() <= 2;
        const otherMembers = room.getJoinedMembers()
          .map((m) => m.userId)
          .filter((id) => id !== mx.getUserId());
        callDebug('notify', 'Sending m.call.notify', { roomId: currentRoomId, isDm });
        mx.sendEvent(currentRoomId, 'm.call.notify' as any, {
          call_id: '',
          application: 'm.call',
          'm.mentions': isDm ? { room: false, user_ids: otherMembers } : { room: true },
          notify_type: 'ring',
        }).catch(() => undefined);
      })();
    }
  }, [lkConnected, mx]);

  const toggleAudio = useCallback(async () => {
    const newState = !isAudioEnabled;
    setIsAudioEnabledState(newState);
    callDebug('media', 'toggleAudio', { newState });
  }, [isAudioEnabled]);

  const toggleVideo = useCallback(async () => {
    const newState = !isVideoEnabled;
    setIsVideoEnabledState(newState);
    callDebug('media', 'toggleVideo', { newState });
  }, [isVideoEnabled]);

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

  const toggleCallView = useCallback(() => {
    setIsCallViewOpenState((prev) => !prev);
  }, []);

  const contextValue = useMemo<CallContextState>(
    () => ({
      activeCallRoomId,
      setActiveCallRoomId,
      viewedCallRoomId,
      setViewedCallRoomId,
      lkUrl,
      lkToken,
      lkConnected,
      setLkCredentials,
      setLkConnected,
      hangUp,
      isAudioEnabled,
      isVideoEnabled,
      setAudioEnabled,
      setVideoEnabled,
      toggleAudio,
      toggleVideo,
      isChatOpen,
      isCallViewOpen,
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
      lkUrl,
      lkToken,
      lkConnected,
      setLkCredentials,
      setLkConnected,
      hangUp,
      isAudioEnabled,
      isVideoEnabled,
      setAudioEnabled,
      setVideoEnabled,
      toggleAudio,
      toggleVideo,
      isChatOpen,
      isCallViewOpen,
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

/** Safe version that returns undefined when outside CallProvider. */
export function useCallStateSafe(): CallContextState | undefined {
  return useContext(CallContext);
}
