import React, {
  createContext,
  ReactNode,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import { EventType } from 'matrix-js-sdk';
import { ConnectionState } from 'livekit-client';
import { useCallState } from './CallProvider';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useAutoDiscoveryInfo } from '../../../hooks/useAutoDiscoveryInfo';
import { callDebug } from '../../../features/call/callDebug';
import { fetchSfuToken } from '../../../hooks/useSfuToken';
import { useLiveKitRoom } from '../../../hooks/useLiveKitRoom';

// Context to pass LK room state to CallView
export interface LiveKitRoomContextValue {
  localParticipant: import('livekit-client').LocalParticipant | null;
  remoteParticipants: import('livekit-client').RemoteParticipant[];
  connectionState: ConnectionState;
  isMicEnabled: boolean;
  isCamEnabled: boolean;
  isScreenShareEnabled: boolean;
  toggleMicrophone: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  error: string | null;
}

export const LiveKitRoomContext = createContext<LiveKitRoomContextValue | null>(null);

interface PersistentCallContainerProps {
  children: ReactNode;
}

export function PersistentCallContainer({ children }: PersistentCallContainerProps) {
  const {
    activeCallRoomId,
    pendingJoin,
    joinConfirmedRef,
    setLkCredentials,
    setLkConnected,
    lkUrl,
    lkToken,
    hangUp,
  } = useCallState();
  const mx = useMatrixClient();
  const autoDiscoveryInfo = useAutoDiscoveryInfo();

  // Track whether we've fetched token for this room to avoid re-fetching
  const tokenFetchedForRef = useRef<string | null>(null);

  // ── Fetch SFU token when call room becomes active ──
  useEffect(() => {
    if (!activeCallRoomId || !mx?.getUserId()) return;
    if (pendingJoin && !joinConfirmedRef.current) return;
    if (tokenFetchedForRef.current === activeCallRoomId) return;

    tokenFetchedForRef.current = activeCallRoomId;

    // Find lk-jwt-service URL from .well-known
    const rtcFoci = autoDiscoveryInfo['org.matrix.msc4143.rtc_foci'] as Array<{ type: string; livekit_service_url?: string }> | undefined;
    const lkFocus = rtcFoci?.find((f) => f.type === 'livekit' && f.livekit_service_url);

    if (!lkFocus?.livekit_service_url) {
      callDebug('error', 'No livekit_service_url in .well-known rtc_foci', rtcFoci);
      return;
    }

    const serviceUrl = lkFocus.livekit_service_url;
    const roomId = activeCallRoomId;

    callDebug('sfu', 'Fetching SFU token', { serviceUrl, roomId });

    let cancelled = false;
    fetchSfuToken(mx, serviceUrl, roomId, mx.getDeviceId() ?? 'UNKNOWN')
      .then((result) => {
        if (!cancelled) {
          callDebug('sfu', 'Got SFU credentials', { url: result.url });
          setLkCredentials(result.url, result.jwt);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          callDebug('error', 'SFU token fetch failed', err);
        }
      });

    return () => { cancelled = true; };
  }, [activeCallRoomId, pendingJoin, mx, autoDiscoveryInfo, setLkCredentials, joinConfirmedRef]);

  // Reset token fetch ref when call ends
  useEffect(() => {
    if (!activeCallRoomId) {
      tokenFetchedForRef.current = null;
    }
  }, [activeCallRoomId]);

  // ── LiveKit room connection ──
  const shouldConnect = !!(activeCallRoomId && lkUrl && lkToken && (!pendingJoin || joinConfirmedRef.current));

  // Track intentional disconnects to avoid re-triggering hangUp
  const intentionalDisconnectRef = useRef(false);
  useEffect(() => {
    if (!shouldConnect && activeCallRoomId === null) {
      // hangUp() was called — mark disconnect as intentional
      intentionalDisconnectRef.current = true;
    } else {
      intentionalDisconnectRef.current = false;
    }
  }, [shouldConnect, activeCallRoomId]);

  const lkRoom = useLiveKitRoom({
    url: lkUrl,
    token: lkToken,
    connect: shouldConnect,
    onDisconnected: useCallback(() => {
      if (intentionalDisconnectRef.current) {
        callDebug('sfu', 'LiveKit disconnected (intentional, skipping hangUp)');
        return;
      }
      callDebug('sfu', 'LiveKit disconnected unexpectedly, hanging up');
      hangUp();
    }, [hangUp]),
  });

  // Sync LK connected state to CallProvider
  const prevConnected = useRef(false);
  useEffect(() => {
    const isConnected = lkRoom.connectionState === ConnectionState.Connected;
    if (isConnected !== prevConnected.current) {
      prevConnected.current = isConnected;
      setLkConnected(isConnected);
    }
  }, [lkRoom.connectionState, setLkConnected]);

  // ── Send call.member state event when connected ──
  const callMemberSentRef = useRef<string | null>(null);
  useEffect(() => {
    if (lkRoom.connectionState !== ConnectionState.Connected || !activeCallRoomId || !mx) return;
    if (callMemberSentRef.current === activeCallRoomId) return;

    callMemberSentRef.current = activeCallRoomId;
    const userId = mx.getUserId()!;
    const deviceId = mx.getDeviceId()!;
    // State key format must match what matrix-js-sdk's MembershipManager uses:
    // _userId_deviceId_applicationcall_id (prefixed with _ for non-MSC3757 rooms)
    const stateKey = `_${userId}_${deviceId}_m.call`;

    // Find service URL from .well-known
    const rtcFoci = autoDiscoveryInfo['org.matrix.msc4143.rtc_foci'] as Array<{ type: string; livekit_service_url?: string }> | undefined;
    const lkServiceUrl = rtcFoci?.find((f) => f.type === 'livekit')?.livekit_service_url ?? '';

    const joinedAt = Date.now();
    const EXPIRE_DURATION = 14_400_000; // 4 hours (matches SDK default)
    const RENEW_INTERVAL = 30 * 60 * 1000; // 30 minutes

    const sendMembership = (expires: number) => {
      const content = {
        application: 'm.call',
        call_id: '',
        scope: 'm.room',
        device_id: deviceId,
        expires,
        created_ts: joinedAt,
        focus_active: {
          type: 'livekit',
          focus_selection: 'oldest_membership',
        },
        foci_preferred: [{
          type: 'livekit',
          livekit_alias: activeCallRoomId,
          livekit_service_url: lkServiceUrl,
        }],
      };
      callDebug('sfu', 'Sending call.member state event', { stateKey, deviceId, expires });
      mx.sendStateEvent(activeCallRoomId, EventType.GroupCallMemberPrefix, content, stateKey)
        .catch((err: unknown) => callDebug('error', 'Failed to send call.member', err));
    };

    // Initial membership event
    sendMembership(EXPIRE_DURATION);

    // Renew periodically so long calls don't expire
    let renewCount = 1;
    const renewTimer = setInterval(() => {
      renewCount += 1;
      sendMembership(EXPIRE_DURATION * renewCount);
      callDebug('sfu', 'Renewed call.member expiry', { renewCount });
    }, RENEW_INTERVAL);

    // Clear on unmount/call end
    return () => {
      clearInterval(renewTimer);
      if (callMemberSentRef.current === activeCallRoomId) {
        callMemberSentRef.current = null;
        // Send empty content to signal departure
        mx.sendStateEvent(activeCallRoomId, EventType.GroupCallMemberPrefix, {}, stateKey)
          .catch(() => {});
      }
    };
  }, [lkRoom.connectionState, activeCallRoomId, mx, autoDiscoveryInfo]);

  const contextValue: LiveKitRoomContextValue = {
    localParticipant: lkRoom.localParticipant,
    remoteParticipants: lkRoom.remoteParticipants,
    connectionState: lkRoom.connectionState,
    isMicEnabled: lkRoom.isMicEnabled,
    isCamEnabled: lkRoom.isCamEnabled,
    isScreenShareEnabled: lkRoom.isScreenShareEnabled,
    toggleMicrophone: lkRoom.toggleMicrophone,
    toggleCamera: lkRoom.toggleCamera,
    toggleScreenShare: lkRoom.toggleScreenShare,
    error: lkRoom.error,
  };

  return (
    <LiveKitRoomContext.Provider value={contextValue}>
      {children}
    </LiveKitRoomContext.Provider>
  );
}
