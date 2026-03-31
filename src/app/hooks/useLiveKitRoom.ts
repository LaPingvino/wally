import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Room,
  RoomEvent,
  ConnectionState,
  RemoteParticipant,
  RemoteTrackPublication,
  TrackPublication,
  RemoteTrack,
  LocalParticipant,
  Track,
  Participant,
} from 'livekit-client';
import type { BaseKeyProvider } from 'livekit-client';
import { callDebug } from '../features/call/callDebug';

function createRoom(e2eeKeyProvider?: BaseKeyProvider): Room {
  const opts: ConstructorParameters<typeof Room>[0] = { adaptiveStream: true, dynacast: true };
  if (e2eeKeyProvider) {
    opts.e2ee = {
      keyProvider: e2eeKeyProvider,
      worker: new Worker(new URL('livekit-client/e2ee-worker', import.meta.url), { type: 'module' }),
    };
    callDebug('sfu', 'Room created WITH E2EE key provider');
  } else {
    callDebug('sfu', 'Room created WITHOUT E2EE (no key provider)');
  }
  return new Room(opts);
}

export interface LiveKitRoomState {
  room: Room | null;
  connectionState: ConnectionState;
  remoteParticipants: RemoteParticipant[];
  localParticipant: LocalParticipant | null;
  error: string | null;
}

export interface UseLiveKitRoomOptions {
  url: string;
  token: string;
  connect: boolean; // only connect when true (allows pre-join)
  onDisconnected?: () => void;
  /** Initial microphone state from pre-join screen. Default: false (off). */
  initialAudio?: boolean;
  /** Initial camera state from pre-join screen. Default: false (off). */
  initialVideo?: boolean;
  /** E2EE key provider for encrypted rooms */
  e2eeKeyProvider?: import('livekit-client').BaseKeyProvider;
}

/**
 * Manages a LiveKit Room connection lifecycle.
 *
 * When `connect` is true and url+token are provided, connects to the LK room.
 * Returns room state, participants, and control functions.
 */
export function useLiveKitRoom({ url, token, connect, onDisconnected, initialAudio = false, initialVideo = false, e2eeKeyProvider }: UseLiveKitRoomOptions): LiveKitRoomState & {
  toggleMicrophone: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  disconnect: () => void;
  isMicEnabled: boolean;
  isCamEnabled: boolean;
  isScreenShareEnabled: boolean;
} {
  // Always configure E2EE if a key provider exists — the Room is created once
  // via useState, so the provider must be available at construction time.
  // If it's undefined on first render but available later, E2EE would silently
  // be missing for the entire Room lifetime.
  const e2eeKeyProviderRef = useRef(e2eeKeyProvider);
  e2eeKeyProviderRef.current = e2eeKeyProvider;
  const [room, setRoom] = useState(() => createRoom(e2eeKeyProvider));
  // Recreate room if E2EE availability changed (undefined → provider or vice versa)
  const prevHadE2EE = useRef(!!e2eeKeyProvider);
  useEffect(() => {
    const hasE2EE = !!e2eeKeyProvider;
    if (hasE2EE !== prevHadE2EE.current) {
      prevHadE2EE.current = hasE2EE;
      callDebug('sfu', `E2EE availability changed (${hasE2EE}), recreating Room`);
      setRoom(createRoom(e2eeKeyProvider));
    }
  }, [e2eeKeyProvider]);
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [remoteParticipants, setRemoteParticipants] = useState<RemoteParticipant[]>([]);
  const [localParticipant, setLocalParticipant] = useState<LocalParticipant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isMicEnabled, setIsMicEnabled] = useState(initialAudio);
  const [isCamEnabled, setIsCamEnabled] = useState(initialVideo);
  const [isScreenShareEnabled, setIsScreenShareEnabled] = useState(false);
  const onDisconnectedRef = useRef(onDisconnected);
  onDisconnectedRef.current = onDisconnected;
  const connectedRef = useRef(false);

  // Sync remote participants list
  const updateParticipants = useCallback(() => {
    const participants = Array.from(room.remoteParticipants.values());
    setRemoteParticipants([...participants]);
  }, [room]);

  useEffect(() => {
    const onConnectionStateChanged = (state: ConnectionState) => {
      callDebug('sfu', 'Connection state changed', state);
      setConnectionState(state);
      if (state === ConnectionState.Connected) {
        setLocalParticipant(room.localParticipant);
        updateParticipants();
      }
      if (state === ConnectionState.Disconnected && connectedRef.current) {
        connectedRef.current = false;
        onDisconnectedRef.current?.();
      }
    };

    const onParticipantConnected = (p: RemoteParticipant) => {
      callDebug('sfu', 'Participant connected', { identity: p.identity, name: p.name });
      updateParticipants();
    };

    const onParticipantDisconnected = (p: RemoteParticipant) => {
      callDebug('sfu', 'Participant disconnected', { identity: p.identity });
      updateParticipants();
    };

    const onTrackSubscribed = (track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) => {
      callDebug('sfu', 'Track subscribed', { participant: p.identity, source: track.source, kind: track.kind });
      updateParticipants(); // trigger re-render
    };

    const onTrackUnsubscribed = (track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) => {
      callDebug('sfu', 'Track unsubscribed', { participant: p.identity, source: track.source });
      updateParticipants();
    };

    const onTrackMuted = (pub: TrackPublication, p: Participant) => {
      updateParticipants();
      if (p === room.localParticipant) {
        setIsMicEnabled(room.localParticipant.isMicrophoneEnabled);
        setIsCamEnabled(room.localParticipant.isCameraEnabled);
      }
    };

    const onTrackUnmuted = (pub: TrackPublication, p: Participant) => {
      updateParticipants();
      if (p === room.localParticipant) {
        setIsMicEnabled(room.localParticipant.isMicrophoneEnabled);
        setIsCamEnabled(room.localParticipant.isCameraEnabled);
      }
    };

    const onLocalTrackPublished = () => {
      setIsMicEnabled(room.localParticipant.isMicrophoneEnabled);
      setIsCamEnabled(room.localParticipant.isCameraEnabled);
      setIsScreenShareEnabled(room.localParticipant.isScreenShareEnabled);
    };

    room.on(RoomEvent.ConnectionStateChanged, onConnectionStateChanged);
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    room.on(RoomEvent.TrackMuted, onTrackMuted);
    room.on(RoomEvent.TrackUnmuted, onTrackUnmuted);
    room.on(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
    room.on(RoomEvent.LocalTrackUnpublished, onLocalTrackPublished);

    return () => {
      room.off(RoomEvent.ConnectionStateChanged, onConnectionStateChanged);
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
      room.off(RoomEvent.TrackMuted, onTrackMuted);
      room.off(RoomEvent.TrackUnmuted, onTrackUnmuted);
      room.off(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
      room.off(RoomEvent.LocalTrackUnpublished, onLocalTrackPublished);
    };
  }, [room, updateParticipants]);

  // Connect/disconnect based on `connect` flag
  useEffect(() => {
    if (!connect || !url || !token) return;

    let cancelled = false;

    (async () => {
      try {
        callDebug('sfu', 'Connecting to LiveKit', { url });
        await room.connect(url, token);
        if (cancelled) {
          room.disconnect();
          return;
        }
        connectedRef.current = true;
        callDebug('sfu', 'Connected to LiveKit room', { name: room.name, initialAudio, initialVideo });

        // Apply initial media state from pre-join screen
        if (initialAudio) {
          try {
            await room.localParticipant.setMicrophoneEnabled(true);
          } catch (e) {
            callDebug('error', 'Failed to enable microphone', e);
          }
        }
        if (initialVideo) {
          try {
            await room.localParticipant.setCameraEnabled(true);
          } catch (e) {
            callDebug('error', 'Failed to enable camera', e);
          }
        }
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          callDebug('error', 'Failed to connect to LiveKit', msg);
          setError(msg);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (room.state !== ConnectionState.Disconnected) {
        room.disconnect();
        connectedRef.current = false;
      }
    };
  }, [connect, url, token, room]);

  const toggleMicrophone = useCallback(async () => {
    const next = !room.localParticipant.isMicrophoneEnabled;
    setIsMicEnabled(next); // optimistic — update UI immediately
    try {
      await room.localParticipant.setMicrophoneEnabled(next);
    } catch (e) {
      setIsMicEnabled(!next); // revert on failure
      callDebug('error', 'Mic toggle failed', e);
    }
  }, [room]);

  const toggleCamera = useCallback(async () => {
    const next = !room.localParticipant.isCameraEnabled;
    setIsCamEnabled(next); // optimistic
    try {
      await room.localParticipant.setCameraEnabled(next);
    } catch (e) {
      setIsCamEnabled(!next); // revert on failure
      callDebug('error', 'Camera toggle failed', e);
    }
  }, [room]);

  const toggleScreenShare = useCallback(async () => {
    const next = !room.localParticipant.isScreenShareEnabled;
    setIsScreenShareEnabled(next); // optimistic
    try {
      await room.localParticipant.setScreenShareEnabled(next);
    } catch (e) {
      setIsScreenShareEnabled(false); // revert
      callDebug('error', 'Screen share error', e);
    }
  }, [room]);

  const disconnect = useCallback(() => {
    room.disconnect();
    connectedRef.current = false;
  }, [room]);

  return {
    room,
    connectionState,
    remoteParticipants,
    localParticipant,
    error,
    toggleMicrophone,
    toggleCamera,
    toggleScreenShare,
    disconnect,
    isMicEnabled,
    isCamEnabled,
    isScreenShareEnabled,
  };
}
