import React, { useContext } from 'react';
import { Box, Button, Icon, Icons, Text, config } from 'folds';
import { useCallState, useCallStateSafe } from './client/call/CallProvider';
import { LiveKitRoomContext } from './client/call/PersistentCallContainer';
import { useSelectedRoom } from '../hooks/router/useSelectedRoom';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { MicrophoneButton, VideoButton } from '../features/call/Controls';

/**
 * Renders a compact call status bar when the user is in a call but viewing a different room.
 * Shows room name, participant count, mic/cam toggles, and return/hangup buttons.
 */
export function CallStatusRenderer() {
  const callState = useCallStateSafe();
  const selectedRoom = useSelectedRoom();

  if (!callState) return null;

  const { activeCallRoomId, lkConnected } = callState;

  // Don't show if no active call or we're viewing the call room
  if (!activeCallRoomId || !lkConnected) return null;
  if (activeCallRoomId === selectedRoom) return null;

  return <ActiveCallStatusBar />;
}

function ActiveCallStatusBar() {
  const mx = useMatrixClient();
  const {
    activeCallRoomId,
    hangUp,
    isCallViewOpen,
    toggleCallView,
  } = useCallState();
  const lkCtx = useContext(LiveKitRoomContext);

  const room = activeCallRoomId ? mx.getRoom(activeCallRoomId) : undefined;
  const roomName = room ? room.name : activeCallRoomId;
  const participantCount = (lkCtx?.remoteParticipants.length ?? 0) + (lkCtx?.localParticipant ? 1 : 0);

  const handleReturn = () => {
    // Navigate to the call room
    if (activeCallRoomId) {
      // Use history to navigate back to the call room
      window.location.hash = `#/rooms/${activeCallRoomId}`;
    }
  };

  return (
    <Box
      shrink="No"
      alignItems="Center"
      gap="300"
      style={{
        padding: `${config.space.S200} ${config.space.S400}`,
        borderBottom: '1px solid var(--bg-surface-border)',
        background: 'var(--bg-surface-low)',
      }}
    >
      {/* Live indicator */}
      <Box
        alignItems="Center"
        gap="100"
        style={{
          background: 'var(--mx-positive)',
          color: 'white',
          padding: '2px 8px',
          borderRadius: '10px',
          fontSize: '0.75rem',
          fontWeight: 600,
        }}
      >
        <Text size="L400">LIVE</Text>
      </Box>

      {/* Room name + count */}
      <Box grow="Yes" alignItems="Center" gap="200" style={{ minWidth: 0 }}>
        <Text size="T300" truncate>
          {roomName ?? activeCallRoomId}
        </Text>
        <Text size="T200" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {participantCount} participant{participantCount !== 1 ? 's' : ''}
        </Text>
      </Box>

      {/* Controls */}
      {lkCtx && (
        <Box alignItems="Center" gap="100" shrink="No">
          <MicrophoneButton enabled={lkCtx.isMicEnabled} onToggle={lkCtx.toggleMicrophone} />
          <VideoButton enabled={lkCtx.isCamEnabled} onToggle={lkCtx.toggleCamera} />
        </Box>
      )}

      {/* Return / Hangup */}
      <Box alignItems="Center" gap="100" shrink="No">
        <Button
          variant="Secondary"
          fill="Soft"
          size="300"
          onClick={handleReturn}
          aria-label="Return to call"
        >
          <Text size="B300">Return</Text>
        </Button>
        <Button
          variant="Critical"
          fill="Solid"
          size="300"
          onClick={hangUp}
          aria-label="End call"
        >
          <Icon src={Icons.PhoneDown} size="100" />
        </Button>
      </Box>
    </Box>
  );
}
