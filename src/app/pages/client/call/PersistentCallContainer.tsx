import React, {
  createContext,
  ReactNode,
  useEffect,
  useRef,
  useCallback,
  useState,
  useMemo,
} from 'react';
import { MatrixClient } from 'matrix-js-sdk';
import { UnsupportedDelayedEventsEndpointError } from 'matrix-js-sdk/lib/errors';
import { MatrixRTCSession, MatrixRTCSessionEvent } from 'matrix-js-sdk/lib/matrixrtc/MatrixRTCSession';
import { ConnectionState } from 'livekit-client';
import { useCallState } from './CallProvider';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useAutoDiscoveryInfo } from '../../../hooks/useAutoDiscoveryInfo';
import { callDebug } from '../../../features/call/callDebug';
import { homeSfuByIdentity, mergeParticipants, useRemoteSfus } from '../../../features/call/useRemoteSfus';
import { discoverOwnLivekitServiceUrl, fetchSfuToken } from '../../../hooks/useSfuToken';
import { useLiveKitRoom } from '../../../hooks/useLiveKitRoom';
import { MatrixKeyProvider } from '../../../features/call/MatrixKeyProvider';

/**
 * Disable MSC4140 delayed events on the MatrixClient if the server doesn't
 * properly support them.  The MembershipManager's fallback path (regular state
 * events with client-side expiry) works fine — delayed events are only an
 * optimisation for auto-cleanup of stale memberships.
 *
 * Without this, Continuwuity (which advertises org.matrix.msc4140 but has a
 * broken `restart` endpoint) causes MembershipManager to retry 10×, timeout,
 * and report "Connection lost".
 */
async function disableDelayedEventsIfUnsupported(mx: MatrixClient): Promise<void> {
  try {
    const info = await mx.getVersions();
    const supported =
      info.unstable_features?.['org.matrix.msc4157'] === true ||
      info.unstable_features?.['org.matrix.msc4140'] === true;
    if (supported) {
      // Server claims support — probe the endpoint to be sure
      try {
        // Try to update a nonexistent delayed event; a functioning server
        // returns 404 (delay_id not found).  A broken server times out.
        await (mx as any)._unstable_updateDelayedEvent('probe-nonexistent', 'cancel');
      } catch (e: any) {
        if (e instanceof UnsupportedDelayedEventsEndpointError) {
          // Feature flag was true but the endpoint doesn't exist — disable
          patchDelayedEvents(mx);
          return;
        }
        // 404 / M_NOT_FOUND = endpoint exists and works, just no such delay_id.
        // That's the expected response — delayed events are fine.
        if (e?.errcode === 'M_NOT_FOUND' || e?.httpStatus === 404) return;
        // Any other error (timeout, 500, etc.) = endpoint is broken
        callDebug('sfu', 'Delayed events endpoint probe failed, disabling', e?.message);
        patchDelayedEvents(mx);
      }
    }
  } catch {
    // getVersions failed — can't check, leave as-is
  }
}

function patchDelayedEvents(mx: MatrixClient): void {
  const err = () => Promise.reject(
    new UnsupportedDelayedEventsEndpointError('Disabled: server delayed events are broken', 'updateDelayedEvent')
  );
  (mx as any)._unstable_sendDelayedStateEvent = err;
  (mx as any)._unstable_updateDelayedEvent = err;
  callDebug('sfu', 'Delayed events disabled — MembershipManager will use fallback path');
}

// Context to pass LK room state to CallView
export interface LiveKitRoomContextValue {
  room: import('livekit-client').Room | null;
  /** Subscribe-only connections to other members' SFUs (multi-SFU). */
  extraRooms: import('livekit-client').Room[];
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
    callSession,
    hangUp,
    isAudioEnabled,
    isVideoEnabled,
  } = useCallState();
  const mx = useMatrixClient();
  const autoDiscoveryInfo = useAutoDiscoveryInfo();

  // The call session (room + CallProvider's session counter) whose token we hold, so a re-render
  // doesn't re-fetch. Set only once a token ARRIVED: an effect re-run that cancels an in-flight
  // fetch must be free to fetch again, or the call waits on "Connecting..." forever.
  const tokenFetchedForRef = useRef<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  // Our own SFU's lk-jwt-service (the one we publish on), once discovered.
  const [ownServiceUrl, setOwnServiceUrl] = useState<string | undefined>(undefined);

  // ── Fetch SFU token when call room becomes active ──
  // Uses "oldest_membership" algorithm: find the oldest active call.member event
  // and use its foci_preferred livekit_service_url. Falls back to own .well-known.
  useEffect(() => {
    if (!activeCallRoomId) {
      setTokenError(null);
      return undefined;
    }
    if (!mx?.getUserId()) return undefined;
    if (pendingJoin && !joinConfirmedRef.current) return;
    const sessionKey = `${activeCallRoomId}#${callSession}`;
    if (tokenFetchedForRef.current === sessionKey) return;
    setTokenError(null);

    // Multi-SFU (Element Call's default since v0.21; it dropped "oldest membership" in v0.25):
    // we PUBLISH on our own homeserver's SFU and listen on each other member's (useRemoteSfus).
    // Publishing on the oldest member's SFU instead failed across servers: their lk-jwt-service
    // only gives other servers' users a subscribe-only token, and EC looks for our tracks on the
    // SFU our membership advertises.
    const rtcFoci = autoDiscoveryInfo['org.matrix.msc4143.rtc_foci'] as Array<{ type: string; livekit_service_url?: string }> | undefined;
    const roomId = activeCallRoomId;
    let cancelled = false;
    discoverOwnLivekitServiceUrl(mx, rtcFoci)
      .then((serviceUrl) => {
        if (cancelled) throw new Error('cancelled');
        if (!serviceUrl) {
          callDebug('error', 'No livekit_service_url found', { rtcFoci });
          setTokenError("Calls aren't set up on this server (no LiveKit service advertised).");
          throw new Error('cancelled');
        }
        callDebug('sfu', 'Fetching SFU token (own SFU)', { serviceUrl, roomId });
        setOwnServiceUrl(serviceUrl);
        return fetchSfuToken(mx, serviceUrl, roomId, mx.getDeviceId() ?? 'UNKNOWN');
      })
      .then((result) => {
        if (!cancelled) {
          callDebug('sfu', 'Got SFU credentials', { url: result.url });
          tokenFetchedForRef.current = sessionKey;
          setLkCredentials(result.url, result.jwt);
        }
      })
      .catch((err) => {
        if (err instanceof Error && err.message === 'cancelled') return;
        if (!cancelled) {
          callDebug('error', 'SFU token fetch failed', err);
          const msg = err instanceof Error ? err.message : String(err);
          setTokenError(`Couldn't get access to the call: ${msg}. Hang up and try again.`);
        }
      });

    return () => { cancelled = true; };
  }, [activeCallRoomId, callSession, pendingJoin, mx, autoDiscoveryInfo, setLkCredentials, joinConfirmedRef]);

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

  // ── E2EE key provider (persists across reconnects) ──
  const [keyProvider] = useState(() => new MatrixKeyProvider());

  const callE2EE = activeCallRoomId ? !!mx.getRoom(activeCallRoomId)?.hasEncryptionStateEvent() : false;

  const lkRoom = useLiveKitRoom({
    url: lkUrl,
    token: lkToken,
    connect: shouldConnect,
    initialAudio: isAudioEnabled,
    initialVideo: isVideoEnabled,
    e2eeKeyProvider: callE2EE ? keyProvider : undefined,
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

  // ── Probe delayed event support once per client ──
  const delayedEventsCheckedRef = useRef(false);
  useEffect(() => {
    if (!mx || delayedEventsCheckedRef.current) return;
    delayedEventsCheckedRef.current = true;
    disableDelayedEventsIfUnsupported(mx);
  }, [mx]);

  // ── MatrixRTCSession — manages call.member state events + E2EE keys ──
  // Join the MatrixRTC session as soon as we have an active call room — NOT
  // when LiveKit connects.  This ensures the ToDeviceKeyTransport listener
  // is registered before the other party sends their encryption keys.
  // Keys received early are buffered in the MatrixKeyProvider and picked
  // up when LiveKit connects.
  // Track key exchange for diagnostics
  const keysReceivedRef = useRef(0);
  const rtcJoinedAtRef = useRef(0);
  const lkConnectedAtRef = useRef(0);
  const lkStateRef = useRef(lkRoom.connectionState);
  lkStateRef.current = lkRoom.connectionState;

  const rtcSessionRef = useRef<MatrixRTCSession | null>(null);
  useEffect(() => {
    if (!activeCallRoomId || !mx) return;
    if (pendingJoin && !joinConfirmedRef.current) return;

    const room = mx.getRoom(activeCallRoomId);
    if (!room) return;

    const rtcSession = mx.matrixRTC.getRoomSession(room);
    rtcSessionRef.current = rtcSession;
    keysReceivedRef.current = 0;

    const isEncrypted = room.hasEncryptionStateEvent();
    const lkState = lkRoom.connectionState;

    callDebug('e2ee', '── E2EE KEY TIMING FIX ACTIVE (patch-15) ──');
    callDebug('e2ee', `Room encrypted: ${isEncrypted}, LiveKit state: ${lkState}`);

    // Bridge encryption keys from MatrixRTC to LiveKit's key provider.
    // Keys are stored in the provider immediately — LiveKit reads them
    // when it connects (or right away if already connected).
    const onEncryptionKey = (key: Uint8Array, keyIndex: number, participantId: string) => {
      keysReceivedRef.current++;
      const lkNow = lkStateRef.current;
      callDebug('e2ee', `Key #${keysReceivedRef.current} received from ${participantId} (idx=${keyIndex}, ${key.length}B)`, {
        lkConnected: lkNow === ConnectionState.Connected,
        lkState: lkNow,
        msSinceRtcJoin: rtcJoinedAtRef.current ? Date.now() - rtcJoinedAtRef.current : 'n/a',
        msSinceLkConnect: lkConnectedAtRef.current ? Date.now() - lkConnectedAtRef.current : 'not yet',
      });
      keyProvider.setEncryptionKey(key, keyIndex, participantId);
    };

    if (isEncrypted) {
      rtcSession.on(MatrixRTCSessionEvent.EncryptionKeyChanged, onEncryptionKey);
      callDebug('e2ee', 'EncryptionKeyChanged listener registered');
    } else {
      callDebug('e2ee', 'Room NOT encrypted — skipping key management');
    }

    // Advertise OUR SFU (the one we publish on) with multi_sfu selection: each member publishes
    // on its own SFU, and Element Call (and our useRemoteSfus) listens there.
    const rtcFoci = autoDiscoveryInfo['org.matrix.msc4143.rtc_foci'] as Array<{ type: string; livekit_service_url?: string }> | undefined;
    const callRoomId = activeCallRoomId;
    let joinCancelled = false;
    let joined = false;
    (async () => {
      const ownServiceUrl = await discoverOwnLivekitServiceUrl(mx, rtcFoci);
      if (joinCancelled) return;
      const fociPreferred = ownServiceUrl
        ? [{ type: 'livekit' as const, livekit_service_url: ownServiceUrl, livekit_alias: callRoomId }]
        : [];
      callDebug('sfu', 'Joining MatrixRTCSession (before LiveKit connect)', {
        roomId: callRoomId, isEncrypted, lkState, ownServiceUrl,
        useToDevice: true, manageMediaKeys: isEncrypted,
      });
      rtcJoinedAtRef.current = Date.now();
      rtcSession.joinRoomSession(fociPreferred, {
        type: 'livekit',
        focus_selection: 'multi_sfu',
      } as never, {
        manageMediaKeys: isEncrypted,
        useExperimentalToDeviceTransport: true,
      });
      joined = true;

      // Re-emit our keys so late joiners get them
      if (isEncrypted) {
        callDebug('e2ee', 'Re-emitting our encryption keys (initial)');
        rtcSession.reemitEncryptionKeys();
      }
    })();

    return () => {
      callDebug('sfu', 'Leaving MatrixRTCSession', {
        keysReceived: keysReceivedRef.current,
        sessionDurationMs: Date.now() - rtcJoinedAtRef.current,
      });
      joinCancelled = true;
      rtcSession.off(MatrixRTCSessionEvent.EncryptionKeyChanged, onEncryptionKey);
      if (joined) rtcSession.leaveRoomSession();
      rtcSessionRef.current = null;
      rtcJoinedAtRef.current = 0;
    };
  }, [activeCallRoomId, pendingJoin, mx, autoDiscoveryInfo, keyProvider, joinConfirmedRef]);

  // Re-emit encryption keys when LiveKit connects, so the other party
  // gets our latest keys even if they joined after our MatrixRTC session.
  useEffect(() => {
    if (lkRoom.connectionState !== ConnectionState.Connected) return;
    lkConnectedAtRef.current = Date.now();
    const rtcSession = rtcSessionRef.current;
    const msSinceRtcJoin = rtcJoinedAtRef.current ? Date.now() - rtcJoinedAtRef.current : 'n/a';
    callDebug('e2ee', `LiveKit connected (${msSinceRtcJoin}ms after RTC join, ${keysReceivedRef.current} keys already received)`);
    if (!rtcSession) {
      callDebug('e2ee', 'WARNING: LiveKit connected but no MatrixRTC session — keys will NOT be exchanged');
      return;
    }
    const room = activeCallRoomId ? mx.getRoom(activeCallRoomId) : null;
    if (room?.hasEncryptionStateEvent()) {
      callDebug('e2ee', 'Re-emitting our encryption keys (on LK connect)');
      rtcSession.reemitEncryptionKeys();
    } else {
      callDebug('e2ee', 'Room not encrypted — no keys to re-emit');
    }
  }, [lkRoom.connectionState, activeCallRoomId, mx]);

  // ── Other members' SFUs (multi-SFU): subscribe-only connections ──
  const remoteSfus = useRemoteSfus({
    mx,
    roomId: activeCallRoomId,
    enabled: shouldConnect,
    ownServiceUrl,
    keyProvider: callE2EE ? keyProvider : undefined,
  });
  // Recomputed every render: useRemoteSfus re-renders us on each participant/track change.
  const remoteParticipants = mergeParticipants(
        [
          { serviceUrl: ownServiceUrl, participants: lkRoom.remoteParticipants },
          ...remoteSfus.connections.map((c) => ({
            serviceUrl: c.serviceUrl,
            participants: Array.from(c.room.remoteParticipants.values()),
          })),
        ],
        homeSfuByIdentity(remoteSfus.memberships)
  );

  const extraRooms = useMemo(() => remoteSfus.connections.map((c) => c.room), [remoteSfus.connections]);

  const contextValue: LiveKitRoomContextValue = {
    room: lkRoom.room,
    extraRooms,
    localParticipant: lkRoom.localParticipant,
    remoteParticipants,
    connectionState: lkRoom.connectionState,
    isMicEnabled: lkRoom.isMicEnabled,
    isCamEnabled: lkRoom.isCamEnabled,
    isScreenShareEnabled: lkRoom.isScreenShareEnabled,
    toggleMicrophone: lkRoom.toggleMicrophone,
    toggleCamera: lkRoom.toggleCamera,
    toggleScreenShare: lkRoom.toggleScreenShare,
    error: tokenError ?? lkRoom.error,
  };

  return (
    <LiveKitRoomContext.Provider value={contextValue}>
      {children}
    </LiveKitRoomContext.Provider>
  );
}
