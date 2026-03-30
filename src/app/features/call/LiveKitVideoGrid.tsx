import React, { useEffect, useRef, useCallback } from 'react';
import { RemoteParticipant, LocalParticipant, Track, TrackPublication } from 'livekit-client';
import { Box, Text } from 'folds';

interface VideoTileProps {
  participant: RemoteParticipant | LocalParticipant;
  isLocal?: boolean;
}

function VideoTile({ participant, isLocal }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const attachTracks = useCallback(() => {
    const camPub = participant.getTrackPublication(Track.Source.Camera)
      ?? participant.getTrackPublication(Track.Source.ScreenShare);

    if (camPub?.track && videoRef.current) {
      camPub.track.attach(videoRef.current);
    } else if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    if (!isLocal) {
      const micPub = participant.getTrackPublication(Track.Source.Microphone);
      if (micPub?.track && audioRef.current) {
        micPub.track.attach(audioRef.current);
      }
    }
  }, [participant, isLocal]);

  useEffect(() => {
    attachTracks();
    // Re-attach when tracks change
    const interval = setInterval(attachTracks, 1000);
    return () => {
      clearInterval(interval);
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
}

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
