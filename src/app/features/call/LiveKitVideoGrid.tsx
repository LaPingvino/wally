import React, { useEffect, useRef, useCallback, useState, memo } from 'react';
import {
  RemoteParticipant,
  LocalParticipant,
  Track,
  TrackPublication,
  ParticipantEvent,
} from 'livekit-client';
import { Room } from 'matrix-js-sdk';
import { Box, Text } from 'folds';
import { getMemberDisplayName } from '../../utils/room';

/**
 * Resolve a readable display name from a LiveKit participant.
 * Priority: participant.name > parsed identity > 'Unknown'
 *
 * Identity format is "userId:deviceId" (e.g. "@alice:example.com:ABCD1234").
 * For guests, deviceId starts with "GUEST_".
 */
function resolveDisplayName(
  participant: RemoteParticipant | LocalParticipant,
  matrixRoom?: Room,
): { name: string; isGuest: boolean } {
  const identity = participant.identity || '';
  // Identity format: @user:server:deviceId — split on last colon
  const lastColon = identity.lastIndexOf(':');
  const userId = lastColon > 0 ? identity.substring(0, lastColon) : '';
  const deviceId = lastColon > 0 ? identity.substring(lastColon + 1) : '';
  const isGuest = deviceId.startsWith('GUEST_');

  // 1. participant.name from JWT claims (guests get their chosen name here)
  if (participant.name) {
    const suffix = isGuest ? ' (Guest)' : '';
    return { name: participant.name + suffix, isGuest };
  }

  // 2. Matrix room member display name (for authenticated users)
  if (matrixRoom && userId.startsWith('@')) {
    const memberName = getMemberDisplayName(matrixRoom, userId);
    if (memberName) return { name: memberName, isGuest: false };
  }

  // 3. Fallback: localpart from userId
  if (userId) {
    const localpart = userId.startsWith('@') ? userId.slice(1).split(':')[0] : userId;
    const suffix = isGuest ? ' (Guest)' : '';
    return { name: (localpart || userId) + suffix, isGuest };
  }

  return { name: identity || 'Unknown', isGuest: false };
}

interface VideoTileProps {
  participant: RemoteParticipant | LocalParticipant;
  isLocal?: boolean;
  /** Which video source to show. Defaults to Camera. */
  trackSource?: Track.Source;
  matrixRoom?: Room;
}

const VideoTile = memo(function VideoTile({
  participant,
  isLocal,
  trackSource = Track.Source.Camera,
  matrixRoom,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const isScreenShare = trackSource === Track.Source.ScreenShare;
  // Force re-render when tracks change so hasVideo/isMuted update
  const [, setTrackVersion] = useState(0);

  const attachTracks = useCallback(() => {
    const videoPub = participant.getTrackPublication(trackSource);

    if (videoPub?.track && videoRef.current) {
      if (videoRef.current.srcObject !== videoPub.track.mediaStream) {
        videoPub.track.attach(videoRef.current);
      }
    } else if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    // Only attach audio on the camera tile (not screenshare) to avoid double audio
    if (!isLocal && !isScreenShare) {
      const micPub = participant.getTrackPublication(Track.Source.Microphone);
      if (micPub?.track && audioRef.current) {
        if (audioRef.current.srcObject !== micPub.track.mediaStream) {
          micPub.track.attach(audioRef.current);
        }
      }
    }
  }, [participant, isLocal, isScreenShare, trackSource]);

  useEffect(() => {
    attachTracks();

    const onTrackChange = () => {
      attachTracks();
      setTrackVersion((v) => v + 1);
    };

    participant.on(ParticipantEvent.TrackPublished, onTrackChange);
    participant.on(ParticipantEvent.TrackUnpublished, onTrackChange);
    participant.on(ParticipantEvent.TrackSubscribed, onTrackChange);
    participant.on(ParticipantEvent.TrackUnsubscribed, onTrackChange);
    participant.on(ParticipantEvent.TrackMuted, onTrackChange);
    participant.on(ParticipantEvent.TrackUnmuted, onTrackChange);
    participant.on(ParticipantEvent.LocalTrackPublished, onTrackChange);
    participant.on(ParticipantEvent.LocalTrackUnpublished, onTrackChange);

    return () => {
      participant.off(ParticipantEvent.TrackPublished, onTrackChange);
      participant.off(ParticipantEvent.TrackUnpublished, onTrackChange);
      participant.off(ParticipantEvent.TrackSubscribed, onTrackChange);
      participant.off(ParticipantEvent.TrackUnsubscribed, onTrackChange);
      participant.off(ParticipantEvent.TrackMuted, onTrackChange);
      participant.off(ParticipantEvent.TrackUnmuted, onTrackChange);
      participant.off(ParticipantEvent.LocalTrackPublished, onTrackChange);
      participant.off(ParticipantEvent.LocalTrackUnpublished, onTrackChange);
      // Only detach the specific track source on unmount
      const pub = participant.getTrackPublication(trackSource);
      if (pub?.track) pub.track.detach();
      if (!isScreenShare) {
        const micPub = participant.getTrackPublication(Track.Source.Microphone);
        if (micPub?.track) micPub.track.detach();
      }
    };
  }, [participant, attachTracks, trackSource, isScreenShare]);

  const hasVideo = !!participant.getTrackPublication(trackSource)?.track;

  const { name: displayName } = resolveDisplayName(participant, matrixRoom);
  const initial = displayName.replace(/[^a-zA-Z0-9]/, '').charAt(0).toUpperCase() || '?';

  const isMuted = !participant.getTrackPublication(Track.Source.Microphone)?.track
    || participant.getTrackPublication(Track.Source.Microphone)?.isMuted;

  const label = isScreenShare
    ? `${displayName}'s screen share`
    : `${displayName}${isLocal ? ' (You)' : ''}${isMuted ? ', muted' : ''}`;

  const nameLabel = isScreenShare
    ? `${displayName} (Screen)`
    : `${displayName}${isLocal ? ' (You)' : ''}`;

  return (
    <div
      role="group"
      aria-label={label}
      style={{
        position: 'relative',
        borderRadius: '8px',
        overflow: 'hidden',
        background: 'var(--bg-surface-low, #16213e)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 0,
        aspectRatio: '16/9',
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        aria-label={`${displayName}'s ${isScreenShare ? 'screen share' : 'video'}`}
        style={{
          width: '100%',
          height: '100%',
          objectFit: isScreenShare ? 'contain' : 'cover',
          display: hasVideo ? 'block' : 'none',
          transform: isLocal && !isScreenShare ? 'scaleX(-1)' : undefined,
        }}
      />
      {!isLocal && !isScreenShare && <audio ref={audioRef} autoPlay aria-hidden="true" />}
      {!hasVideo && (
        <div
          role="img"
          aria-label={`${displayName}'s avatar`}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            fontSize: '2.5rem',
            color: 'var(--text-muted, #aaa)',
            background: 'var(--bg-surface, #0f3460)',
          }}
        >
          {initial}
        </div>
      )}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          bottom: '6px',
          left: '6px',
          background: 'rgba(0,0,0,0.6)',
          color: '#eee',
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '0.8rem',
          maxWidth: 'calc(100% - 12px)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {nameLabel}
      </div>
    </div>
  );
});

interface LiveKitVideoGridProps {
  localParticipant: LocalParticipant | null;
  remoteParticipants: RemoteParticipant[];
  /** Pass-through to force re-render when local screenshare toggles */
  isScreenShareEnabled?: boolean;
  matrixRoom?: Room;
}

/**
 * Collect participants that have an active screenshare track.
 * These get rendered as separate tiles in addition to their camera tile.
 */
function getScreenShareParticipants(
  local: LocalParticipant | null,
  remotes: RemoteParticipant[]
): (RemoteParticipant | LocalParticipant)[] {
  const result: (RemoteParticipant | LocalParticipant)[] = [];
  if (local?.getTrackPublication(Track.Source.ScreenShare)?.track) {
    result.push(local);
  }
  for (const p of remotes) {
    if (p.getTrackPublication(Track.Source.ScreenShare)?.track) {
      result.push(p);
    }
  }
  return result;
}

export function LiveKitVideoGrid({ localParticipant, remoteParticipants, isScreenShareEnabled: _ssHint, matrixRoom }: LiveKitVideoGridProps) {
  const screenSharers = getScreenShareParticipants(localParticipant, remoteParticipants);
  const tileCount =
    remoteParticipants.length + (localParticipant ? 1 : 0) + screenSharers.length;

  let cols = 1;
  if (tileCount >= 2) cols = 2;
  if (tileCount >= 5) cols = 3;
  if (tileCount >= 10) cols = 4;

  return (
    <div
      role="region"
      aria-label={`Call with ${tileCount} tile${tileCount !== 1 ? 's' : ''}`}
      aria-live="polite"
      style={{
        flex: 1,
        display: 'grid',
        gap: '4px',
        padding: '4px',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        overflow: 'hidden',
      }}
    >
      {/* Screenshare tiles first (most prominent) */}
      {screenSharers.map((p) => (
        <VideoTile
          key={`ss-${p.sid}`}
          participant={p}
          isLocal={p === localParticipant}
          trackSource={Track.Source.ScreenShare}
          matrixRoom={matrixRoom}
        />
      ))}
      {/* Camera tiles */}
      {localParticipant && (
        <VideoTile key="local" participant={localParticipant} isLocal matrixRoom={matrixRoom} />
      )}
      {remoteParticipants.map((p) => (
        <VideoTile key={p.sid} participant={p} matrixRoom={matrixRoom} />
      ))}
      {tileCount === 0 && (
        <Box justifyContent="Center" alignItems="Center" style={{ padding: '2rem', color: 'var(--text-muted)' }}>
          <Text size="T300">Waiting for participants...</Text>
        </Box>
      )}
    </div>
  );
}
