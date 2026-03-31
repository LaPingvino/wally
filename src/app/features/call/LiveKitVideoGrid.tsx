import React, { useEffect, useRef, useCallback, useState, memo } from 'react';
import {
  RemoteParticipant,
  LocalParticipant,
  Track,
  TrackPublication,
  ParticipantEvent,
  Participant,
  RoomEvent,
  Room as LKRoom,
} from 'livekit-client';
import { Room } from 'matrix-js-sdk';
import { Box, Text } from 'folds';
import { getMemberDisplayName } from '../../utils/room';

export type GridLayout = 'equal' | 'spotlight';

function resolveDisplayName(
  participant: RemoteParticipant | LocalParticipant,
  matrixRoom?: Room,
): { name: string; isGuest: boolean } {
  const identity = participant.identity || '';
  const lastColon = identity.lastIndexOf(':');
  const userId = lastColon > 0 ? identity.substring(0, lastColon) : '';
  const deviceId = lastColon > 0 ? identity.substring(lastColon + 1) : '';
  const isGuest = deviceId.startsWith('GUEST_');

  if (participant.name) {
    return { name: participant.name + (isGuest ? ' (Guest)' : ''), isGuest };
  }
  if (matrixRoom && userId.startsWith('@')) {
    const memberName = getMemberDisplayName(matrixRoom, userId);
    if (memberName) return { name: memberName, isGuest: false };
  }
  if (userId) {
    const localpart = userId.startsWith('@') ? userId.slice(1).split(':')[0] : userId;
    return { name: (localpart || userId) + (isGuest ? ' (Guest)' : ''), isGuest };
  }
  return { name: identity || 'Unknown', isGuest: false };
}

/** Detect video aspect from track dimensions. Returns CSS aspect-ratio string. */
function detectAspect(participant: RemoteParticipant | LocalParticipant, source: Track.Source): string {
  const pub = participant.getTrackPublication(source);
  const dims = pub?.dimensions;
  if (dims && dims.width && dims.height) {
    return dims.height > dims.width ? '3/4' : '16/9';
  }
  return '16/9'; // default landscape
}

interface VideoTileProps {
  participant: RemoteParticipant | LocalParticipant;
  isLocal?: boolean;
  trackSource?: Track.Source;
  matrixRoom?: Room;
  isSpotlight?: boolean;
  isPip?: boolean;
  onClick?: () => void;
}

const VideoTile = memo(function VideoTile({
  participant,
  isLocal,
  trackSource = Track.Source.Camera,
  matrixRoom,
  isSpotlight,
  isPip,
  onClick,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const isScreenShare = trackSource === Track.Source.ScreenShare;
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
    const onTrackChange = () => { attachTracks(); setTrackVersion((v) => v + 1); };
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

  // Auto-detect aspect from video dimensions
  const aspect = isSpotlight || isPip ? undefined : detectAspect(participant, trackSource);

  return (
    <div
      role="group"
      aria-label={label}
      onClick={onClick}
      style={{
        position: 'relative',
        borderRadius: isPip ? '12px' : '8px',
        overflow: 'hidden',
        background: 'var(--bg-surface-low, #16213e)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 0,
        maxHeight: '100%',
        aspectRatio: aspect,
        cursor: onClick ? 'pointer' : undefined,
        margin: isSpotlight || isPip ? undefined : 'auto',
        ...(isSpotlight ? { flex: 1 } : {}),
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
            fontSize: isSpotlight ? '4rem' : isPip ? '1.5rem' : '2.5rem',
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
          bottom: isPip ? '3px' : '6px',
          left: isPip ? '3px' : '6px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          background: 'rgba(0,0,0,0.6)',
          color: '#eee',
          padding: isPip ? '1px 4px' : '2px 8px',
          borderRadius: '4px',
          fontSize: isPip ? '0.65rem' : '0.8rem',
          maxWidth: 'calc(100% - 12px)',
        }}
      >
        {!isScreenShare && (
          <svg width={isPip ? '10' : '14'} height={isPip ? '10' : '14'} viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0, opacity: isMuted ? 0.5 : 1 }}>
            {isMuted ? (
              <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
            ) : (
              <path d="M12 14a3 3 0 003-3V5a3 3 0 10-6 0v6a3 3 0 003 3zm-1 4.93A7.004 7.004 0 015 12h2a5 5 0 0010 0h2a7.004 7.004 0 01-6 6.93V22h-2v-3.07z"/>
            )}
          </svg>
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {nameLabel}
        </span>
      </div>
    </div>
  );
});

interface LiveKitVideoGridProps {
  localParticipant: LocalParticipant | null;
  remoteParticipants: RemoteParticipant[];
  isScreenShareEnabled?: boolean;
  matrixRoom?: Room;
  layout?: GridLayout;
  lkRoom?: LKRoom | null;
  pinnedParticipantSid?: string | null;
  onPinParticipant?: (sid: string | null) => void;
  showPip?: boolean;
}

function getScreenShareParticipants(
  local: LocalParticipant | null,
  remotes: RemoteParticipant[]
): (RemoteParticipant | LocalParticipant)[] {
  const result: (RemoteParticipant | LocalParticipant)[] = [];
  if (local?.getTrackPublication(Track.Source.ScreenShare)?.track) result.push(local);
  for (const p of remotes) {
    if (p.getTrackPublication(Track.Source.ScreenShare)?.track) result.push(p);
  }
  return result;
}

export function LiveKitVideoGrid({
  localParticipant,
  remoteParticipants,
  isScreenShareEnabled: _ssHint,
  matrixRoom,
  layout = 'equal',
  lkRoom,
  pinnedParticipantSid,
  onPinParticipant,
  showPip = false,
}: LiveKitVideoGridProps) {
  const screenSharers = getScreenShareParticipants(localParticipant, remoteParticipants);
  const allParticipants: (RemoteParticipant | LocalParticipant)[] = [];
  if (localParticipant) allParticipants.push(localParticipant);
  allParticipants.push(...remoteParticipants);

  // Active speaker tracking
  const [activeSpeakerSid, setActiveSpeakerSid] = useState<string | null>(null);
  useEffect(() => {
    if (!lkRoom) return;
    const onActiveSpeakers = (speakers: Participant[]) => {
      const remote = speakers.find((s) => s !== localParticipant);
      setActiveSpeakerSid(remote?.sid ?? speakers[0]?.sid ?? null);
    };
    lkRoom.on(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers);
    return () => { lkRoom.off(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers); };
  }, [lkRoom, localParticipant]);

  const spotlightSid = pinnedParticipantSid ?? activeSpeakerSid;
  const spotlightParticipant = spotlightSid
    ? allParticipants.find((p) => p.sid === spotlightSid) ?? null
    : null;

  const handleTileClick = useCallback((sid: string) => {
    if (!onPinParticipant) return;
    onPinParticipant(pinnedParticipantSid === sid ? null : sid);
  }, [onPinParticipant, pinnedParticipantSid]);

  // ── Equal grid layout — auto-fill flowing grid ──
  if (layout === 'equal' || !spotlightParticipant) {
    const tileCount =
      remoteParticipants.length + (localParticipant ? 1 : 0) + screenSharers.length;

    // Participants to show in grid (exclude local if PiP is on)
    const gridLocal = showPip ? null : localParticipant;

    return (
      <div
        role="region"
        aria-label={`Call with ${tileCount} participant${tileCount !== 1 ? 's' : ''}`}
        aria-live="polite"
        style={{
          flex: 1,
          display: 'grid',
          gap: '4px',
          padding: '4px',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gridAutoRows: '1fr',
          overflow: 'hidden',
          position: 'relative',
          alignContent: 'center',
        }}
      >
        {screenSharers.map((p) => (
          <VideoTile
            key={`ss-${p.sid}`}
            participant={p}
            isLocal={p === localParticipant}
            trackSource={Track.Source.ScreenShare}
            matrixRoom={matrixRoom}
            onClick={() => handleTileClick(p.sid)}
          />
        ))}
        {gridLocal && (
          <VideoTile
            key="local"
            participant={gridLocal}
            isLocal
            matrixRoom={matrixRoom}
            onClick={() => handleTileClick(gridLocal.sid)}
          />
        )}
        {remoteParticipants.map((p) => (
          <VideoTile
            key={p.sid}
            participant={p}
            matrixRoom={matrixRoom}
            onClick={() => handleTileClick(p.sid)}
          />
        ))}
        {tileCount === 0 && (
          <Box justifyContent="Center" alignItems="Center" style={{ padding: '2rem', color: 'var(--text-muted)' }}>
            <Text size="T300">Waiting for participants...</Text>
          </Box>
        )}
        {/* Floating PiP self-view */}
        {showPip && localParticipant && (
          <div
            style={{
              position: 'absolute',
              bottom: '8px',
              right: '8px',
              width: '140px',
              borderRadius: '12px',
              overflow: 'hidden',
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
              zIndex: 5,
            }}
          >
            <VideoTile
              participant={localParticipant}
              isLocal
              isPip
              matrixRoom={matrixRoom}
              onClick={() => handleTileClick(localParticipant.sid)}
            />
          </div>
        )}
      </div>
    );
  }

  // ── Spotlight layout ──
  // Exclude spotlight and local (PiP) from sidebar
  const sideParticipants = allParticipants.filter(
    (p) => p.sid !== spotlightParticipant.sid && p !== localParticipant
  );

  return (
    <div
      role="region"
      aria-label="Call — spotlight mode"
      aria-live="polite"
      style={{
        flex: 1,
        display: 'flex',
        gap: '4px',
        padding: '4px',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Main spotlight */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, minHeight: 0 }}>
        {screenSharers.length > 0 && (
          <div style={{ display: 'flex', gap: '4px', maxHeight: '40%' }}>
            {screenSharers.map((p) => (
              <VideoTile
                key={`ss-${p.sid}`}
                participant={p}
                isLocal={p === localParticipant}
                trackSource={Track.Source.ScreenShare}
                matrixRoom={matrixRoom}
                isSpotlight
              />
            ))}
          </div>
        )}
        <VideoTile
          key={`spot-${spotlightParticipant.sid}`}
          participant={spotlightParticipant}
          isLocal={spotlightParticipant === localParticipant}
          matrixRoom={matrixRoom}
          isSpotlight
          onClick={() => handleTileClick(spotlightParticipant.sid)}
        />
      </div>
      {/* Sidebar strip */}
      {sideParticipants.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            width: '160px',
            flexShrink: 0,
            overflowY: 'auto',
          }}
        >
          {sideParticipants.map((p) => (
            <VideoTile
              key={p.sid}
              participant={p}
              isLocal={p === localParticipant}
              matrixRoom={matrixRoom}
              onClick={() => handleTileClick(p.sid)}
            />
          ))}
        </div>
      )}
      {/* PiP self-view */}
      {localParticipant && spotlightParticipant !== localParticipant && (
        <div
          style={{
            position: 'absolute',
            bottom: '8px',
            right: sideParticipants.length > 0 ? '176px' : '8px',
            width: '140px',
            borderRadius: '12px',
            overflow: 'hidden',
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            zIndex: 5,
          }}
        >
          <VideoTile
            participant={localParticipant}
            isLocal
            isPip
            matrixRoom={matrixRoom}
            onClick={() => handleTileClick(localParticipant.sid)}
          />
        </div>
      )}
    </div>
  );
}
