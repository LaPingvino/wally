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
import { MAX_TILES_PER_PAGE } from './layout';
import { useParticipantDimensions } from '../../hooks/useParticipantDimensions';
import { packTiles, PackerTile } from './packer';

export type GridLayout = 'equal' | 'spotlight';

// ── Display name resolution ──

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

function detectAspect(participant: RemoteParticipant | LocalParticipant, source: Track.Source): string {
  const pub = participant.getTrackPublication(source);
  const dims = pub?.dimensions;
  if (dims && dims.width && dims.height) {
    return dims.height > dims.width ? '3/4' : '16/9';
  }
  return '16/9';
}

// ── VideoTile ──

interface VideoTileProps {
  participant: RemoteParticipant | LocalParticipant;
  isLocal?: boolean;
  trackSource?: Track.Source;
  matrixRoom?: Room;
  isLarge?: boolean;
  isPip?: boolean;
  onClick?: () => void;
  gridArea?: { col: string; row: string };
}

const VideoTile = memo(function VideoTile({
  participant,
  isLocal,
  trackSource = Track.Source.Camera,
  matrixRoom,
  isLarge,
  isPip,
  onClick,
  gridArea,
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

  return (
    <div
      role="group"
      aria-label={label}
      onClick={onClick}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        borderRadius: isPip ? '12px' : '8px',
        overflow: 'hidden',
        background: 'var(--bg-surface-low, #16213e)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 0,
        minWidth: 0,
        cursor: onClick ? 'pointer' : undefined,
        ...(gridArea ? { gridColumn: gridArea.col, gridRow: gridArea.row } : {}),
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
          objectFit: 'contain',
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
            fontSize: isLarge ? '4rem' : isPip ? '1.5rem' : '2.5rem',
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

// ── Grid component ──

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

  // Source dimensions per participant — wired for the packer introduced in the
  // next commit. Not yet consumed for rendering decisions.
  const participantDims = useParticipantDimensions(lkRoom ?? null);

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

  // Container size drives the packer's cell math.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  useEffect(() => {
    if (!containerEl) return;
    const obs = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      setContainerSize((prev) =>
        Math.abs(prev.width - rect.width) < 0.5 && Math.abs(prev.height - rect.height) < 0.5
          ? prev
          : { width: rect.width, height: rect.height }
      );
    });
    obs.observe(containerEl);
    return () => obs.disconnect();
  }, [containerEl]);

  const spotlightSid = pinnedParticipantSid ?? activeSpeakerSid;
  let spotlightParticipant: RemoteParticipant | LocalParticipant | null = spotlightSid
    ? allParticipants.find((p) => p.sid === spotlightSid) ?? null
    : null;
  // In spotlight mode, never fall back to the equal grid — default to the
  // first remote (or local if nobody else) so the layout stays stable when
  // nobody is actively speaking and nothing is pinned.
  if (layout === 'spotlight' && !spotlightParticipant) {
    spotlightParticipant = remoteParticipants[0] ?? localParticipant ?? null;
  }

  const handleTileClick = useCallback((sid: string) => {
    if (!onPinParticipant) return;
    onPinParticipant(pinnedParticipantSid === sid ? null : sid);
  }, [onPinParticipant, pinnedParticipantSid]);

  // Pagination
  const [page, setPage] = useState(0);

  // ── Spotlight layout ──
  if (layout === 'spotlight' && spotlightParticipant) {
    // Local goes in the sidebar when PiP is off (unless local is the spotlight itself).
    const sideParticipants = allParticipants.filter(
      (p) => p.sid !== spotlightParticipant.sid
        && !(showPip && p === localParticipant)
    );
    return (
      <div
        ref={setContainerEl}
        role="region"
        aria-label="Call — spotlight mode"
        aria-live="polite"
        style={{ flex: 1, display: 'flex', gap: '4px', padding: '4px', overflow: 'hidden', position: 'relative' }}
      >
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, minHeight: 0 }}>
          {screenSharers.length > 0 && (
            <div style={{ display: 'flex', gap: '4px', maxHeight: '40%' }}>
              {screenSharers.map((p) => (
                <VideoTile key={`ss-${p.sid}`} participant={p} isLocal={p === localParticipant}
                  trackSource={Track.Source.ScreenShare} matrixRoom={matrixRoom} isLarge />
              ))}
            </div>
          )}
          <VideoTile
            key={`spot-${spotlightParticipant.sid}`}
            participant={spotlightParticipant}
            isLocal={spotlightParticipant === localParticipant}
            matrixRoom={matrixRoom} isLarge
            onClick={() => handleTileClick(spotlightParticipant.sid)}
          />
        </div>
        {sideParticipants.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '160px', flexShrink: 0, overflowY: 'auto' }}>
            {sideParticipants.map((p) => (
              <VideoTile key={p.sid} participant={p} isLocal={p === localParticipant}
                matrixRoom={matrixRoom} onClick={() => handleTileClick(p.sid)} />
            ))}
          </div>
        )}
        {showPip && localParticipant && spotlightParticipant !== localParticipant && (
          <div style={{ position: 'absolute', bottom: '8px', right: sideParticipants.length > 0 ? '176px' : '8px',
            width: '140px', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.4)', zIndex: 5 }}>
            <VideoTile participant={localParticipant} isLocal isPip matrixRoom={matrixRoom}
              onClick={() => handleTileClick(localParticipant.sid)} />
          </div>
        )}
      </div>
    );
  }

  // ── Equal grid layout with predefined layouts ──
  const hasRemotes = remoteParticipants.length > 0;
  const pipActive = showPip && hasRemotes;
  const gridLocal = pipActive ? null : localParticipant;

  // Build ordered tile list: screenshares first, then local, then remotes
  const allTiles: { key: string; participant: RemoteParticipant | LocalParticipant; isLocal: boolean; trackSource: Track.Source }[] = [];
  for (const p of screenSharers) {
    allTiles.push({ key: `ss-${p.sid}`, participant: p, isLocal: p === localParticipant, trackSource: Track.Source.ScreenShare });
  }
  if (gridLocal) {
    allTiles.push({ key: 'local', participant: gridLocal, isLocal: true, trackSource: Track.Source.Camera });
  }
  for (const p of remoteParticipants) {
    allTiles.push({ key: p.sid, participant: p, isLocal: false, trackSource: Track.Source.Camera });
  }

  const totalTiles = allTiles.length;
  const totalPages = Math.max(1, Math.ceil(totalTiles / MAX_TILES_PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const pageTiles = totalTiles <= MAX_TILES_PER_PAGE
    ? allTiles
    : allTiles.slice(safePage * MAX_TILES_PER_PAGE, (safePage + 1) * MAX_TILES_PER_PAGE);

  // Packer: picks cell shapes per tile to minimize letterbox, given each
  // source's real aspect and the current container size. Replaces the old
  // hardcoded pickLayout lookup table.
  const packerTiles: PackerTile[] = pageTiles.map((tile) => {
    const d = participantDims.get(tile.participant.sid);
    const sourceAspect = d && d.height > 0
      ? d.width / d.height
      : tile.trackSource === Track.Source.ScreenShare ? 16 / 10 : 16 / 9;
    return { sid: tile.participant.sid, sourceAspect };
  });
  // 8px subtracted for the 4px padding on each side of the grid wrapper.
  const packerResult = packTiles(packerTiles, {
    width: Math.max(0, containerSize.width - 8),
    height: Math.max(0, containerSize.height - 8),
    gap: 4,
  });

  return (
    <div
      ref={setContainerEl}
      role="region"
      aria-label={`Call with ${allParticipants.length} participant${allParticipants.length !== 1 ? 's' : ''}`}
      aria-live="polite"
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}
    >
      {/* Grid — tiles absolute-positioned from packer rects */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          padding: '4px',
          overflow: 'hidden',
        }}
      >
        {pageTiles.map((tile, i) => {
          const rect = packerResult.rects[i];
          if (!rect) return null;
          return (
            <div
              key={tile.key}
              style={{
                position: 'absolute',
                left: `${rect.left + 4}px`,
                top: `${rect.top + 4}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`,
              }}
            >
              <VideoTile
                participant={tile.participant}
                isLocal={tile.isLocal}
                trackSource={tile.trackSource}
                matrixRoom={matrixRoom}
                isLarge={pageTiles.length === 1}
                onClick={() => handleTileClick(tile.participant.sid)}
              />
            </div>
          );
        })}
        {totalTiles === 0 && (
          <Box justifyContent="Center" alignItems="Center" style={{ padding: '2rem', color: 'var(--text-muted)', width: '100%', height: '100%' }}>
            <Text size="T300">Waiting for participants...</Text>
          </Box>
        )}
      </div>
      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', padding: '4px' }}>
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            aria-label="Previous page"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: safePage === 0 ? 'default' : 'pointer', fontSize: '1.2rem', opacity: safePage === 0 ? 0.3 : 1 }}
          >
            ‹
          </button>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {safePage + 1}/{totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={safePage >= totalPages - 1}
            aria-label="Next page"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: safePage >= totalPages - 1 ? 'default' : 'pointer', fontSize: '1.2rem', opacity: safePage >= totalPages - 1 ? 0.3 : 1 }}
          >
            ›
          </button>
        </div>
      )}
      {/* Layout indicator */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          background: 'rgba(0,0,0,0.5)',
          color: '#aaa',
          padding: '2px 6px',
          borderRadius: '4px',
          fontSize: '0.65rem',
          pointerEvents: 'none',
        }}
      >
        [{packerResult.rows}×{packerResult.cols}] {participantDims.size}d
      </div>
      {/* PiP */}
      {pipActive && localParticipant && (
        <div style={{ position: 'absolute', bottom: totalPages > 1 ? '32px' : '8px', right: '8px',
          width: '140px', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.4)', zIndex: 5 }}>
          <VideoTile participant={localParticipant} isLocal isPip matrixRoom={matrixRoom}
            onClick={() => handleTileClick(localParticipant.sid)} />
        </div>
      )}
    </div>
  );
}
