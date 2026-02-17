import React, { useCallback, useEffect, useState } from 'react';
import { Box, Text, IconButton, Icon, Icons, config, toRem } from 'folds';
import { MatrixRTCSessionManagerEvents } from 'matrix-js-sdk/lib/matrixrtc/MatrixRTCSessionManager';
import { MatrixRTCSession } from 'matrix-js-sdk/lib/matrixrtc/MatrixRTCSession';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useCallState } from '../../pages/client/call/CallProvider';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';

interface IncomingCall {
  roomId: string;
}

export function IncomingCallNotification() {
  const mx = useMatrixClient();
  const { activeCallRoomId, setActiveCallRoomId } = useCallState();
  const { navigateRoom } = useRoomNavigate();
  const [incomingCalls, setIncomingCalls] = useState<IncomingCall[]>([]);

  useEffect(() => {
    const handleSessionStarted = (roomId: string, session: MatrixRTCSession) => {
      if (roomId === activeCallRoomId) return;
      const otherMembers = session.memberships.filter((m) => m.sender !== mx.getUserId());
      if (otherMembers.length === 0) return;
      setIncomingCalls((prev) => {
        if (prev.some((c) => c.roomId === roomId)) return prev;
        return [...prev, { roomId }];
      });
    };

    const handleSessionEnded = (roomId: string) => {
      setIncomingCalls((prev) => prev.filter((c) => c.roomId !== roomId));
    };

    mx.matrixRTC.on(MatrixRTCSessionManagerEvents.SessionStarted, handleSessionStarted);
    mx.matrixRTC.on(MatrixRTCSessionManagerEvents.SessionEnded, handleSessionEnded);

    return () => {
      mx.matrixRTC.removeListener(MatrixRTCSessionManagerEvents.SessionStarted, handleSessionStarted);
      mx.matrixRTC.removeListener(MatrixRTCSessionManagerEvents.SessionEnded, handleSessionEnded);
    };
  }, [mx, activeCallRoomId]);

  const handleJoin = useCallback(
    (roomId: string) => {
      const joinRoom = mx.getRoom(roomId);
      setActiveCallRoomId(roomId, joinRoom?.isCallRoom() ?? false);
      navigateRoom(roomId);
      setIncomingCalls((prev) => prev.filter((c) => c.roomId !== roomId));
    },
    [mx, setActiveCallRoomId, navigateRoom]
  );

  const handleDismiss = useCallback((roomId: string) => {
    setIncomingCalls((prev) => prev.filter((c) => c.roomId !== roomId));
  }, []);

  if (incomingCalls.length === 0) return null;

  return (
    <Box
      direction="Column"
      gap="200"
      style={{
        position: 'fixed',
        bottom: config.space.S400,
        right: config.space.S400,
        zIndex: 1000,
      }}
    >
      {incomingCalls.map(({ roomId }) => {
        const room = mx.getRoom(roomId);
        return (
          <Box
            key={roomId}
            direction="Column"
            gap="200"
            style={{
              background: 'var(--bg-surface)',
              border: `1px solid var(--bg-surface-border)`,
              borderRadius: toRem(8),
              padding: config.space.S300,
              minWidth: toRem(220),
              boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
            }}
          >
            <Text size="T300" truncate>
              Incoming call from <b>{room?.name ?? roomId}</b>
            </Text>
            <Box gap="200">
              <IconButton
                variant="Success"
                fill="Solid"
                size="300"
                radii="300"
                onClick={() => handleJoin(roomId)}
                title="Join"
              >
                <Icon size="200" src={Icons.Phone} />
              </IconButton>
              <IconButton
                variant="Critical"
                fill="None"
                size="300"
                radii="300"
                onClick={() => handleDismiss(roomId)}
                title="Dismiss"
              >
                <Icon size="200" src={Icons.Cross} />
              </IconButton>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
