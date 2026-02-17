import {
  Box,
  Chip,
  Icon,
  IconButton,
  Icons,
  Line,
  Spinner,
  Text,
  Tooltip,
  TooltipProvider,
  color,
} from 'folds';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MatrixRTCSessionManagerEvents } from 'matrix-js-sdk/lib/matrixrtc/MatrixRTCSessionManager';
import { MatrixRTCSession } from 'matrix-js-sdk/lib/matrixrtc/MatrixRTCSession';
import { useCallState } from '../../pages/client/call/CallProvider';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import * as css from './RoomCallNavStatus.css';

interface IncomingCall {
  roomId: string;
}

export function CallNavStatus() {
  const mx = useMatrixClient();
  const {
    activeCallRoomId,
    isActiveCallReady,
    isAudioEnabled,
    isVideoEnabled,
    toggleAudio,
    toggleVideo,
    hangUp,
    setActiveCallRoomId,
  } = useCallState();
  const { navigateRoom } = useRoomNavigate();

  const [incomingCalls, setIncomingCalls] = useState<IncomingCall[]>([]);
  const dismissedRef = useRef<Set<string>>(new Set());

  const hasActiveCall = Boolean(activeCallRoomId);
  const isConnected = hasActiveCall && isActiveCallReady;

  const handleGoToCallRoom = () => {
    if (activeCallRoomId) navigateRoom(activeCallRoomId);
  };

  useEffect(() => {
    const myUserId = mx.getUserId();

    const addCall = (roomId: string, session: MatrixRTCSession) => {
      if (roomId === activeCallRoomId) return;
      if (dismissedRef.current.has(roomId)) return;
      const otherMembers = session.memberships.filter((m) => m.sender !== myUserId);
      if (otherMembers.length === 0) return;
      setIncomingCalls((prev) => {
        if (prev.some((c) => c.roomId === roomId)) return prev;
        return [...prev, { roomId }];
      });
    };

    for (const room of mx.getRooms()) {
      const memberships = MatrixRTCSession.callMembershipsForRoom(room);
      if (memberships.filter((m) => m.sender !== myUserId).length > 0) {
        const session = mx.matrixRTC.getRoomSession(room);
        addCall(room.roomId, session);
      }
    }

    const handleSessionStarted = (roomId: string, session: MatrixRTCSession) => {
      dismissedRef.current.delete(roomId);
      addCall(roomId, session);
    };

    const handleSessionEnded = (roomId: string) => {
      dismissedRef.current.delete(roomId);
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
      setActiveCallRoomId(roomId, true);
      navigateRoom(roomId);
      setIncomingCalls((prev) => prev.filter((c) => c.roomId !== roomId));
    },
    [setActiveCallRoomId, navigateRoom]
  );

  const handleDismiss = useCallback((roomId: string) => {
    dismissedRef.current.add(roomId);
    setIncomingCalls((prev) => prev.filter((c) => c.roomId !== roomId));
  }, []);

  // Nothing to show — render nothing (no bar, no line)
  if (!hasActiveCall && incomingCalls.length === 0) return null;

  // Incoming call(s) — no active call yet
  if (!hasActiveCall) {
    return (
      <Box direction="Column" shrink="No">
        <Line variant="Surface" size="300" />
        {incomingCalls.map(({ roomId }) => {
          const room = mx.getRoom(roomId);
          return (
            <Box
              key={roomId}
              className={css.Actions}
              direction="Row"
              alignItems="Center"
              gap="100"
            >
              <Box className={css.RoomButtonWrap} grow="Yes">
                <TooltipProvider
                  position="Top"
                  offset={4}
                  tooltip={
                    <Tooltip>
                      <Text>Join call</Text>
                    </Tooltip>
                  }
                >
                  {(triggerRef) => (
                    <Chip
                      size="500"
                      fill="Soft"
                      as="button"
                      onClick={() => handleJoin(roomId)}
                      ref={triggerRef}
                      className={css.RoomButton}
                    >
                      <Icon size="300" src={Icons.Phone} style={{ color: color.Warning.Main }} />
                      <Text as="span" size="L400" style={{ color: color.Warning.Main }} truncate>
                        {room?.name ?? roomId}
                      </Text>
                    </Chip>
                  )}
                </TooltipProvider>
              </Box>
              <TooltipProvider
                position="Top"
                offset={4}
                tooltip={
                  <Tooltip>
                    <Text>Dismiss</Text>
                  </Tooltip>
                }
              >
                {(triggerRef) => (
                  <IconButton
                    fill="None"
                    size="300"
                    ref={triggerRef}
                    onClick={() => handleDismiss(roomId)}
                  >
                    <Icon src={Icons.Cross} />
                  </IconButton>
                )}
              </TooltipProvider>
            </Box>
          );
        })}
      </Box>
    );
  }

  // Active call
  return (
    <Box direction="Column" shrink="No">
      <Line variant="Surface" size="300" />
      <Box className={css.Actions} direction="Row" alignItems="Center" gap="100">
        <Box className={css.RoomButtonWrap} grow="Yes">
          <TooltipProvider
            position="Top"
            offset={4}
            tooltip={
              <Tooltip>
                <Text>Go to Room</Text>
              </Tooltip>
            }
          >
            {(triggerRef) => (
              <Chip
                size="500"
                fill="Soft"
                as="button"
                onClick={handleGoToCallRoom}
                ref={triggerRef}
                className={css.RoomButton}
              >
                {isConnected ? (
                  <Icon size="300" src={Icons.VolumeHigh} style={{ color: color.Success.Main }} />
                ) : (
                  <Spinner size="300" variant="Secondary" />
                )}
                <Text
                  as="span"
                  size="L400"
                  style={{ color: isConnected ? color.Success.Main : color.Warning.Main }}
                >
                  {isConnected ? 'Connected' : 'Connecting'}
                </Text>
              </Chip>
            )}
          </TooltipProvider>
        </Box>
        <TooltipProvider
          position="Top"
          offset={4}
          tooltip={
            <Tooltip>
              <Text>Hang Up</Text>
            </Tooltip>
          }
        >
          {(triggerRef) => (
            <IconButton fill="None" size="300" ref={triggerRef} onClick={hangUp}>
              <Icon src={Icons.Phone} />
            </IconButton>
          )}
        </TooltipProvider>
        <TooltipProvider
          position="Top"
          offset={4}
          tooltip={
            <Tooltip>
              <Text>{!isAudioEnabled ? 'Unmute' : 'Mute'}</Text>
            </Tooltip>
          }
        >
          {(triggerRef) => (
            <IconButton fill="None" size="300" ref={triggerRef} onClick={toggleAudio}>
              <Icon src={!isAudioEnabled ? Icons.MicMute : Icons.Mic} />
            </IconButton>
          )}
        </TooltipProvider>
        <TooltipProvider
          position="Top"
          offset={4}
          tooltip={
            <Tooltip>
              <Text>{!isVideoEnabled ? 'Video On' : 'Video Off'}</Text>
            </Tooltip>
          }
        >
          {(triggerRef) => (
            <IconButton fill="None" size="300" ref={triggerRef} onClick={toggleVideo}>
              <Icon src={!isVideoEnabled ? Icons.VideoCameraMute : Icons.VideoCamera} />
            </IconButton>
          )}
        </TooltipProvider>
      </Box>
    </Box>
  );
}
