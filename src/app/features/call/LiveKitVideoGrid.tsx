import React, { useEffect, useRef, useCallback, useState, memo } from 'react';
import {
  RemoteParticipant,
  LocalParticipant,
  Track,
  TrackPublication,
  ParticipantEvent,
} from 'livekit-client';
import { Box, Text } from 'folds';

interface VideoTileProps {
  participant: RemoteParticipant | LocalParticipant;
  isLocal?: boolean;
}

const VideoTile = memo(function VideoTile({ participant, isLocal }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  // Force re-render when tracks change so hasVideo/isMuted update
  const [, setTrackVersion] = useState(0);

  const attachTracks = useCallback(() => {
    const camPub = participant.getTrackPublication(Track.Source.Camera)
      ?? participant.getTrackPublication(Track.Source.ScreenShare);

    if (camPub?.track && videoRef.current) {
      // Only attach if not already attached to this element
      if (videoRef.current.srcObject !== camPub.track.mediaStream) {
        camPub.track.attach(videoRef.current);
      }
    } else if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    if (!isLocal) {
      const micPub = participant.getTrackPublication(Track.Source.Microphone);
      if (micPub?.track && audioRef.current) {
        if (audioRef.current.srcObject !== micPub.track.mediaStream) {
          micPub.track.attach(audioRef.current);
        }
      }
    }
  }, [participant, isLocal]);

  useEffect(() => {
    attachTracks();

    // Listen to participant track events instead of polling
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
      // Detach tracks on unmount
      participant.trackPublications.forEach((pub: TrackPublication) => {
        if (pub.track) {
          pub.track.detach();
        }
      });
    };
  }, [participant, attachTracks]);

  const hasVideo = !!participant.getTrackPublication(Track.Source.Camera)?.track
    || !!participant.getTrackPublication(Track.Source.ScreenShare)?.track;

  const displayName = participant.name || participant.identity || 'Guest';
  const initial = displayName.charAt(0).toUpperCase();

  const isMuted = !participant.getTrackPublication(Track.Source.Microphone)?.track
    || participant.getTrackPublication(Track.Source.Microphone)?.isMuted;

  return (
    <div
      role="group"
      aria-label={`${displayName}${isLocal ? ' (You)' : ''}${isMuted ? ', muted' : ''}`}
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
        aria-label={`${displayName}'s video`}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: hasVideo ? 'block' : 'none',
          transform: isLocal ? 'scaleX(-1)' : undefined,
        }}
      />
      {!isLocal && <audio ref={audioRef} autoPlay aria-hidden="true" />}
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
        {displayName}{isLocal ? ' (You)' : ''}
      </div>
    </div>
  );
});

interface LiveKitVideoGridProps {
  localParticipant: LocalParticipant | null;
  remoteParticipants: RemoteParticipant[];
}

export function LiveKitVideoGrid({ localParticipant, remoteParticipants }: LiveKitVideoGridProps) {
  const count = remoteParticipants.length + (localParticipant ? 1 : 0);
  let cols = 1;
  if (count >= 2) cols = 2;
  if (count >= 5) cols = 3;
  if (count >= 10) cols = 4;

  return (
    <div
      role="region"
      aria-label={`Call with ${count} participant${count !== 1 ? 's' : ''}`}
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
      {localParticipant && (
        <VideoTile key="local" participant={localParticipant} isLocal />
      )}
      {remoteParticipants.map((p) => (
        <VideoTile key={p.sid} participant={p} />
      ))}
      {count === 0 && (
        <Box justifyContent="Center" alignItems="Center" style={{ padding: '2rem', color: 'var(--text-muted)' }}>
          <Text size="T300">Waiting for participants...</Text>
        </Box>
      )}
    </div>
  );
}
