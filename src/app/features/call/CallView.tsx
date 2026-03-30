import { EventType, Room } from 'matrix-js-sdk';
import React, {
  useContext,
  useCallback,
  useEffect,
  useId,
  MouseEventHandler,
  useState,
  ReactNode,
} from 'react';
import { Box, Button, config, Icon, IconButton, Icons, Spinner, Text, Tooltip, TooltipProvider } from 'folds';
import { ConnectionState } from 'livekit-client';
import { useCallState } from '../../pages/client/call/CallProvider';
import { useCallMembers } from '../../hooks/useCallMemberships';
import { MicrophoneButton, VideoButton, ScreenShareButton } from './Controls';

import { LiveKitRoomContext } from '../../pages/client/call/PersistentCallContainer';
import { LiveKitVideoGrid } from './LiveKitVideoGrid';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { CallViewUser } from './CallViewUser';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { getMemberDisplayName } from '../../utils/room';
import { getMxIdLocalPart } from '../../utils/matrix';
import * as css from './CallView.css';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { useRoomName } from '../../hooks/useRoomMeta';
import { useWallyConference } from '../../hooks/useWallyConference';

/**
 * Global keyboard shortcuts for active calls.
 * M = toggle mic, V = toggle camera, Escape = end call.
 * Only active when not focused on an input/textarea.
 */
function CallKeyboardShortcuts({
  toggleMic,
  toggleCam,
  hangUp,
}: {
  toggleMic: () => void;
  toggleCam: () => void;
  hangUp: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;

      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMic();
      } else if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        toggleCam();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hangUp();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleMic, toggleCam, hangUp]);

  return null;
}

export function CallViewUserGrid({ children }: { children: ReactNode }) {
  return (
    <Box
      className={css.CallViewUserGrid}
      style={{
        maxWidth: React.Children.count(children) === 4 ? '336px' : '503px',
      }}
    >
      {children}
    </Box>
  );
}

export function CallView({ room }: { room: Room }) {
  const lkCtx = useContext(LiveKitRoomContext);

  const mx = useMatrixClient();

  const [visibleCallNames, setVisibleCallNames] = useState('');
  const joinHeadingId = useId();

  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);

  const roomName = useRoomName(room);
  const wallyConference = useWallyConference(room);
  const [guestLinkCopied, setGuestLinkCopied] = useState(false);
  const permissions = useRoomPermissions(creators, powerLevels);
  const canJoin = permissions.event(EventType.GroupCallMemberPrefix, mx.getSafeUserId());

  const {
    activeCallRoomId,
    lkConnected,
    isCallViewOpen,
    setActiveCallRoomId,
    hangUp,
    setViewedCallRoomId,
    pendingJoin,
    confirmJoin,
    isAudioEnabled,
    isVideoEnabled,
    setAudioEnabled,
    setVideoEnabled,
  } = useCallState();

  const isActiveCallRoom = activeCallRoomId === room.roomId;
  const callIsCurrentAndReady = isActiveCallRoom && lkConnected;
  const callMembers = useCallMembers(mx, room.roomId);

  const getName = (userId: string) =>
    getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId);

  const memberDisplayNames = callMembers.map((callMembership) =>
    getName(callMembership.sender ?? '')
  );

  const { navigateRoom } = useRoomNavigate();
  const screenSize = useScreenSizeContext();
  const isMobile = screenSize === ScreenSize.Mobile;

  const handleJoinVCClick: MouseEventHandler<HTMLElement> = (evt) => {
    if (!canJoin) return;

    if (isMobile) {
      evt.stopPropagation();
      setViewedCallRoomId(room.roomId);
      navigateRoom(room.roomId);
    }
    if (!callIsCurrentAndReady) {
      hangUp();
      setActiveCallRoomId(room.roomId, true);
    }
  };

  // NOTE: Visibility is driven by isCallViewOpen (set in CallProvider when call starts).
  // For voice rooms isCallViewOpen=true by default; for regular rooms isCallViewOpen=false.
  const isCallViewVisible = (room.isCallRoom() || isActiveCallRoom) && isCallViewOpen;

  useEffect(() => {
    if (memberDisplayNames.length <= 2) {
      setVisibleCallNames(memberDisplayNames.join(' and '));
    } else {
      const visible = memberDisplayNames.slice(0, 2);
      const remaining = memberDisplayNames.length - 2;

      setVisibleCallNames(
        `${visible.join(', ')}, and ${remaining} other${remaining > 1 ? 's' : ''}`
      );
    }
  }, [memberDisplayNames]);

  return (
    <Box
      grow="Yes"
      direction="Column"
      style={{ display: isCallViewVisible ? 'flex' : 'none', position: 'relative', overflow: 'hidden' }}
    >
      {/* Pre-join screen — fills this call panel only (position: relative on parent) */}
      {isActiveCallRoom && pendingJoin && (
        <Box
          role="dialog"
          aria-labelledby={joinHeadingId}
          grow="Yes"
          direction="Column"
          alignItems="Center"
          justifyContent="Center"
          gap="400"
        >
          <Box
            direction="Column"
            alignItems="Center"
            gap="400"
            style={{ padding: '32px', maxWidth: '280px', width: '100%' }}
          >
            <Icon src={Icons.Phone} size="600" />
            <Text id={joinHeadingId} size="H4" style={{ textAlign: 'center' }}>
              {roomName}
            </Text>
            <Box direction="Row" gap="300">
              <MicrophoneButton
                enabled={isAudioEnabled}
                onToggle={() => setAudioEnabled(!isAudioEnabled)}
              />
              <VideoButton
                enabled={isVideoEnabled}
                onToggle={() => setVideoEnabled(!isVideoEnabled)}
              />
            </Box>
            <Box direction="Row" gap="200">
              <Button
                variant="Critical"
                fill="Soft"
                onClick={hangUp}
                aria-label="Cancel joining call"
              >
                <Text size="B400">Cancel</Text>
              </Button>
              <Button
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                variant="Success"
                fill="Solid"
                before={<Icon src={Icons.Phone} size="200" filled />}
                onClick={confirmJoin}
                aria-label={`Join call in ${roomName}`}
              >
                <Text size="B400">Join</Text>
              </Button>
            </Box>
          </Box>
        </Box>
      )}

      {/* Keyboard shortcuts for call controls */}
      {isActiveCallRoom && !pendingJoin && lkCtx && (
        <CallKeyboardShortcuts
          toggleMic={lkCtx.toggleMicrophone}
          toggleCam={lkCtx.toggleCamera}
          hangUp={hangUp}
        />
      )}

      {/* Active call: LK video grid + controls */}
      {isActiveCallRoom && !pendingJoin && (
        <Box grow="Yes" direction="Column" style={{ position: 'relative' }}>
          {/* Connection status overlay */}
          {lkCtx && lkCtx.connectionState !== ConnectionState.Connected && (
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
                  {lkCtx.connectionState === ConnectionState.Reconnecting ? 'Reconnecting...' : 'Connecting...'}
                </Text>
              </Box>
            </Box>
          )}
          {/* Video grid */}
          {lkCtx && (
            <LiveKitVideoGrid
              localParticipant={lkCtx.localParticipant}
              remoteParticipants={lkCtx.remoteParticipants}
            />
          )}
          {/* Call controls */}
          {lkCtx && (
            <Box role="toolbar" aria-label="Call controls" justifyContent="Center" alignItems="Center" gap="200" style={{ padding: '8px' }}>
              <MicrophoneButton enabled={lkCtx.isMicEnabled} onToggle={lkCtx.toggleMicrophone} />
              <VideoButton enabled={lkCtx.isCamEnabled} onToggle={lkCtx.toggleCamera} />
              <ScreenShareButton enabled={lkCtx.isScreenShareEnabled} onToggle={lkCtx.toggleScreenShare} />
              {wallyConference.available && wallyConference.endpoint && (
                <TooltipProvider
                  position="Top"
                  delay={500}
                  tooltip={
                    <Tooltip>
                      <Text size="T200">{guestLinkCopied ? 'Link Copied!' : 'Invite Guest'}</Text>
                    </Tooltip>
                  }
                >
                  {(anchorRef) => (
                    <IconButton
                      ref={anchorRef}
                      variant={guestLinkCopied ? 'Success' : 'Surface'}
                      fill="Soft"
                      radii="400"
                      size="400"
                      outlined
                      aria-label={guestLinkCopied ? 'Guest link copied' : 'Invite guest to call'}
                      onClick={() => {
                        const joinUrl = `${wallyConference.endpoint}/${encodeURIComponent(room.roomId)}`;
                        navigator.clipboard.writeText(joinUrl);
                        setGuestLinkCopied(true);
                        setTimeout(() => setGuestLinkCopied(false), 2000);
                      }}
                    >
                      <Icon size="400" src={Icons.Link} filled={guestLinkCopied} />
                    </IconButton>
                  )}
                </TooltipProvider>
              )}
              <Button variant="Critical" fill="Solid" onClick={hangUp} aria-label="End call">
                <Text size="B400">End</Text>
              </Button>
            </Box>
          )}
          {/* Error display */}
          {lkCtx?.error && (
            <Box role="alert" justifyContent="Center" style={{ padding: '8px' }}>
              <Text size="T200" style={{ color: 'var(--mx-critical)' }}>{lkCtx.error}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Not in call: member avatars + join button */}
      {!isActiveCallRoom && (
        <Box
          grow="Yes"
          justifyContent="Center"
          alignItems="Center"
          direction="Column"
          gap="300"
        >
          <CallViewUserGrid>
            {callMembers.slice(0, 6).map((callMember) => (
              <CallViewUser key={callMember.membershipID} room={room} callMembership={callMember} />
            ))}
          </CallViewUserGrid>

          <Box
            direction="Column"
            alignItems="Center"
            style={{
              paddingBlock: config.space.S200,
            }}
          >
            <Text
              size="H1"
              as="h2"
              style={{
                paddingBottom: config.space.S300,
              }}
            >
              {roomName}
            </Text>
            <Text size="T200">
              {visibleCallNames !== '' ? visibleCallNames : 'No one'}{' '}
              {memberDisplayNames.length > 1 ? 'are' : 'is'} currently in voice
            </Text>
          </Box>
          <Button
            variant="Secondary"
            disabled={!canJoin || isActiveCallRoom}
            onClick={handleJoinVCClick}
          >
            {isActiveCallRoom ? (
              <Box justifyContent="Center" alignItems="Center" gap="200">
                <Spinner />
                <Text size="B500">{activeCallRoomId === room.roomId ? `Joining` : 'Join Voice'}</Text>
              </Box>
            ) : (
              <Text size="B500">{canJoin ? 'Join Voice' : 'Channel Locked'}</Text>
            )}
          </Button>
        </Box>
      )}
    </Box>
  );
}
