import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, Header, Icon, IconButton, Icons, Spinner, Text, Tooltip, TooltipProvider } from 'folds';
import { ConnectionState } from 'livekit-client';
import { useLiveKitRoom } from '../../hooks/useLiveKitRoom';
import { LiveKitVideoGrid, GridLayout } from './LiveKitVideoGrid';
import { MicrophoneButton, VideoButton, ScreenShareButton } from './Controls';

/**
 * Native LiveKit call view for non-Matrix guests.
 *
 * Guests reach a call through the Wally Conference bot, which mints a plain
 * LiveKit JWT (identity `…:GUEST_<id>`, display name in the token). They have
 * no Matrix client and no room, so this view deliberately reuses ONLY the
 * Matrix-agnostic call pieces: `useLiveKitRoom` (url+token), `LiveKitVideoGrid`
 * (works without a `matrixRoom` — falls back to the participant's LiveKit name,
 * which the bot sets from the entered display name), and the presentational
 * `Controls` buttons. No E2EE: this matches the prior Element-Call guest path,
 * which also fed EC a bare JWT and skipped registration/key exchange.
 */
function PreJoinVideoPreview({ isVideoEnabled }: { isVideoEnabled: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!isVideoEnabled) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
      return undefined;
    }

    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => {
        // Camera not available — silently ignore
      });

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [isVideoEnabled]);

  useEffect(
    () => () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    },
    []
  );

  return (
    <div
      style={{
        width: '100%',
        aspectRatio: '16/9',
        borderRadius: '8px',
        overflow: 'hidden',
        background: 'var(--bg-surface-low, #16213e)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {isVideoEnabled ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          aria-label="Camera preview"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: 'scaleX(-1)',
          }}
        />
      ) : (
        <Icon src={Icons.VideoCameraMute} size="600" />
      )}
    </div>
  );
}

export type GuestCallViewProps = {
  livekitUrl: string;
  token: string;
  displayName: string;
  onLeave: () => void;
};

export function GuestCallView({ livekitUrl, token, displayName, onLeave }: GuestCallViewProps) {
  const [phase, setPhase] = useState<'prejoin' | 'incall' | 'left'>('prejoin');
  // Pre-join media intent, carried into the actual connection.
  const [wantAudio, setWantAudio] = useState(false);
  const [wantVideo, setWantVideo] = useState(false);
  const [gridLayout, setGridLayout] = useState<GridLayout>('equal');
  const [pinnedSid, setPinnedSid] = useState<string | null>(null);

  const lk = useLiveKitRoom({
    url: livekitUrl,
    token,
    connect: phase === 'incall',
    initialAudio: wantAudio,
    initialVideo: wantVideo,
    onDisconnected: () => setPhase('left'),
  });

  if (phase === 'left') {
    return (
      <Box grow="Yes" direction="Column" alignItems="Center" justifyContent="Center" gap="400" style={{ padding: '32px' }}>
        <Text size="H4">You left the call</Text>
        <Button variant="Primary" size="400" onClick={onLeave}>
          <Text size="B400" as="span">
            Back
          </Text>
        </Button>
      </Box>
    );
  }

  if (phase === 'prejoin') {
    return (
      <Box
        grow="Yes"
        direction="Column"
        alignItems="Center"
        justifyContent="Center"
        gap="400"
        style={{ padding: '32px', maxWidth: '480px', width: '100%', margin: '0 auto' }}
      >
        <PreJoinVideoPreview isVideoEnabled={wantVideo} />
        <Text size="H4" style={{ textAlign: 'center' }}>
          {displayName ? `Join as ${displayName}` : 'Join Call'}
        </Text>
        <Box direction="Row" gap="300">
          <MicrophoneButton enabled={wantAudio} onToggle={() => setWantAudio((v) => !v)} />
          <VideoButton enabled={wantVideo} onToggle={() => setWantVideo((v) => !v)} />
        </Box>
        <Button
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          variant="Success"
          fill="Solid"
          size="400"
          before={<Icon src={Icons.Phone} size="200" filled />}
          onClick={() => setPhase('incall')}
          aria-label="Join call"
        >
          <Text size="B400" as="span">
            Join
          </Text>
        </Button>
      </Box>
    );
  }

  // phase === 'incall'
  const connecting = lk.connectionState !== ConnectionState.Connected;
  return (
    <Box grow="Yes" direction="Column" style={{ position: 'relative', height: '100%' }}>
      <Header size="400" variant="Surface" style={{ paddingInline: '12px' }}>
        <Box grow="Yes" alignItems="Center" gap="200">
          <Text size="H6" truncate>
            {displayName ? `${displayName} — Wally Call` : 'Wally Call'}
          </Text>
        </Box>
      </Header>

      <Box grow="Yes" direction="Column" style={{ position: 'relative' }}>
        {lk.error && (
          <Box
            role="alert"
            justifyContent="Center"
            alignItems="Center"
            style={{ position: 'absolute', inset: 0, zIndex: 3, background: 'rgba(0,0,0,0.6)' }}
          >
            <Box direction="Column" alignItems="Center" gap="200" style={{ padding: '24px' }}>
              <Text size="T300" style={{ color: '#eee' }}>
                Failed to connect: {lk.error}
              </Text>
              <Button variant="Secondary" size="300" onClick={onLeave}>
                <Text size="B300" as="span">
                  Back
                </Text>
              </Button>
            </Box>
          </Box>
        )}
        {connecting && !lk.error && (
          <Box
            role="status"
            aria-live="polite"
            justifyContent="Center"
            alignItems="Center"
            style={{ position: 'absolute', inset: 0, zIndex: 2, background: 'rgba(0,0,0,0.5)' }}
          >
            <Box direction="Column" alignItems="Center" gap="200">
              <Spinner aria-hidden="true" />
              <Text size="T300" style={{ color: '#eee' }}>
                {lk.connectionState === ConnectionState.Reconnecting ? 'Reconnecting...' : 'Connecting...'}
              </Text>
            </Box>
          </Box>
        )}
        <LiveKitVideoGrid
          localParticipant={lk.localParticipant}
          remoteParticipants={lk.remoteParticipants}
          isScreenShareEnabled={lk.isScreenShareEnabled}
          layout={gridLayout}
          lkRoom={lk.room}
          pinnedParticipantSid={pinnedSid}
          onPinParticipant={(sid) => {
            setPinnedSid(sid);
            if (sid) setGridLayout('spotlight');
          }}
        />
      </Box>

      <Box
        role="toolbar"
        aria-label="Call controls"
        justifyContent="Center"
        alignItems="Center"
        gap="200"
        style={{ padding: '8px', flexWrap: 'wrap' }}
      >
        <MicrophoneButton enabled={lk.isMicEnabled} onToggle={lk.toggleMicrophone} />
        <VideoButton enabled={lk.isCamEnabled} onToggle={lk.toggleCamera} />
        <ScreenShareButton enabled={lk.isScreenShareEnabled} onToggle={lk.toggleScreenShare} />
        <TooltipProvider
          position="Top"
          delay={500}
          tooltip={
            <Tooltip>
              <Text size="T200">{gridLayout === 'equal' ? 'Spotlight View' : 'Grid View'}</Text>
            </Tooltip>
          }
        >
          {(anchorRef) => (
            <IconButton
              ref={anchorRef}
              variant={gridLayout === 'spotlight' ? 'Success' : 'Surface'}
              fill="Soft"
              radii="400"
              size="400"
              outlined
              aria-label={gridLayout === 'equal' ? 'Switch to spotlight view' : 'Switch to grid view'}
              aria-pressed={gridLayout === 'spotlight'}
              onClick={() => setGridLayout((l) => (l === 'equal' ? 'spotlight' : 'equal'))}
            >
              <Icon size="400" src={gridLayout === 'equal' ? Icons.Pin : Icons.Explore} />
            </IconButton>
          )}
        </TooltipProvider>
        <TooltipProvider
          position="Top"
          delay={500}
          tooltip={
            <Tooltip>
              <Text size="T200">Leave Call</Text>
            </Tooltip>
          }
        >
          {(anchorRef) => (
            <IconButton
              ref={anchorRef}
              variant="Critical"
              fill="Soft"
              radii="400"
              size="400"
              aria-label="Leave call"
              onClick={() => {
                lk.disconnect();
                setPhase('left');
              }}
            >
              <Icon size="400" src={Icons.Phone} filled />
            </IconButton>
          )}
        </TooltipProvider>
      </Box>
    </Box>
  );
}
