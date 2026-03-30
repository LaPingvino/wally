import React, { useContext } from 'react';
import { Icon, Icons } from 'folds';
import { useNavigate } from 'react-router-dom';
import { SidebarItem, SidebarItemTooltip, SidebarAvatar, SidebarItemBadge } from '../../../components/sidebar';
import { useCallStateSafe } from '../call/CallProvider';
import { LiveKitRoomContext } from '../call/PersistentCallContainer';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useSelectedRoom } from '../../../hooks/router/useSelectedRoom';
import { useRoomNavigate } from '../../../hooks/useRoomNavigate';

/**
 * Sidebar item that appears when an active call is running.
 * Shows a phone icon with participant count badge.
 * Click navigates to the call room. Long-press/right-click could hang up.
 */
export function ActiveCallTab() {
  const callState = useCallStateSafe();
  const lkCtx = useContext(LiveKitRoomContext);
  const mx = useMatrixClient();
  const selectedRoom = useSelectedRoom();
  const { navigateRoom } = useRoomNavigate();

  if (!callState?.activeCallRoomId || !callState.lkConnected) return null;

  const { activeCallRoomId, hangUp } = callState;
  // Don't highlight when already viewing the call room
  const isViewing = activeCallRoomId === selectedRoom;
  const room = mx.getRoom(activeCallRoomId);
  const roomName = room?.name ?? activeCallRoomId;
  const participantCount = (lkCtx?.remoteParticipants.length ?? 0) + (lkCtx?.localParticipant ? 1 : 0);

  const handleClick = () => {
    navigateRoom(activeCallRoomId);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    hangUp();
  };

  return (
    <SidebarItem active={isViewing}>
      <SidebarItemTooltip tooltip={`${roomName} — ${participantCount} in call (right-click to hang up)`}>
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            style={{
              position: 'relative',
              // Pulsing green ring when in active call
              boxShadow: isViewing ? undefined : '0 0 0 2px var(--mx-positive)',
            }}
          >
            <Icon src={Icons.Phone} filled />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
      {participantCount > 0 && (
        <SidebarItemBadge hasCount>
          <span style={{ fontSize: '0.7rem', fontWeight: 600 }}>{participantCount}</span>
        </SidebarItemBadge>
      )}
    </SidebarItem>
  );
}
