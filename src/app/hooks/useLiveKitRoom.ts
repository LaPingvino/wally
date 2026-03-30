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
import { callDebug } from '../features/call/callDebug';

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
}

/**
 * Manages a LiveKit Room connection lifecycle.
 *
 * When `connect` is true and url+token are provided, connects to the LK room.
 * Returns room state, participants, and control functions.
 */
export function useLiveKitRoom({ url, token, connect, onDisconnected }: UseLiveKitRoomOptions): LiveKitRoomState & {
  toggleMicrophone: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  disconnect: () => void;
  isMicEnabled: boolean;
  isCamEnabled: boolean;
  isScreenShareEnabled: boolean;
} {
  const [room] = useState(() => new Room({ adaptiveStream: true, dynacast: true }));
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [remoteParticipants, setRemoteParticipants] = useState<RemoteParticipant[]>([]);
  const [localParticipant, setLocalParticipant] = useState<LocalParticipant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isCamEnabled, setIsCamEnabled] = useState(false);
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
        callDebug('sfu', 'Connected to LiveKit room', { name: room.name });

        // Enable microphone by default
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
        } catch (e) {
          callDebug('error', 'Failed to enable microphone', e);
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
    await room.localParticipant.setMicrophoneEnabled(next);
    setIsMicEnabled(next);
  }, [room]);

  const toggleCamera = useCallback(async () => {
    const next = !room.localParticipant.isCameraEnabled;
    await room.localParticipant.setCameraEnabled(next);
    setIsCamEnabled(next);
  }, [room]);

  const toggleScreenShare = useCallback(async () => {
    try {
      const next = !room.localParticipant.isScreenShareEnabled;
      await room.localParticipant.setScreenShareEnabled(next);
      setIsScreenShareEnabled(next);
    } catch (e) {
      callDebug('error', 'Screen share error', e);
      setIsScreenShareEnabled(false);
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
