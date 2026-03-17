import { EventType, Room } from 'matrix-js-sdk';
import React, {
  useContext,
  useCallback,
  useEffect,
  useId,
  useRef,
  MouseEventHandler,
  useState,
  ReactNode,
} from 'react';
import { Box, Button, config, Icon, Icons, Spinner, Text } from 'folds';
import { useCallState } from '../../pages/client/call/CallProvider';
import { useCallMembers } from '../../hooks/useCallMemberships';
import { MicrophoneButton, VideoButton } from './Controls';

import { CallRefContext } from '../../pages/client/call/PersistentCallContainer';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { useDebounce } from '../../hooks/useDebounce';
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

type OriginalStyles = {
  position?: string;
  top?: string;
  left?: string;
  width?: string;
  height?: string;
  zIndex?: string;
  display?: string;
  visibility?: string;
  pointerEvents?: string;
  border?: string;
};

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
  const callIframeRef = useContext(CallRefContext);
  const iframeHostRef = useRef<HTMLDivElement>(null);

  const originalIframeStylesRef = useRef<OriginalStyles | null>(null);
  const mx = useMatrixClient();

  const [visibleCallNames, setVisibleCallNames] = useState('');
  const joinHeadingId = useId();

  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);

  const roomName = useRoomName(room);
  const permissions = useRoomPermissions(creators, powerLevels);
  const canJoin = permissions.event(EventType.GroupCallMemberPrefix, mx.getSafeUserId());

  const {
    isActiveCallReady,
    activeCallRoomId,
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
  const callIsCurrentAndReady = isActiveCallRoom && isActiveCallReady;
  const callMembers = useCallMembers(mx, room.roomId);

  const getName = (userId: string) =>
    getMemberDisplayName(room, userId) ?? getMxIdLocalPart(userId);

  const memberDisplayNames = callMembers.map((callMembership) =>
    getName(callMembership.sender ?? '')
  );

  const { navigateRoom } = useRoomNavigate();
  const screenSize = useScreenSizeContext();
  const isMobile = screenSize === ScreenSize.Mobile;

  const activeIframeDisplayRef = callIframeRef;

  // When no call is active, signal Element Call to stop its tracks, then navigate away.
  // Sending the Widget API terminate action first gives EC a chance to call track.stop()
  // on its own MediaStreamTracks — needed on Firefox which doesn't release them on src change.
  useEffect(() => {
    if (!activeCallRoomId && activeIframeDisplayRef?.current) {
      const iframe = activeIframeDisplayRef.current;
      try {
        iframe.contentWindow?.postMessage(
          JSON.stringify({ api: 'toWidget', action: 'terminate', requestId: `hangup-${Date.now()}`, widgetId: 'element-call' }),
          '*'
        );
      } catch {
        // ignore — contentWindow access itself is safe cross-origin for postMessage
      }
      // Give EC ~300ms to stop its own tracks before we navigate the iframe away
      const timer = setTimeout(() => {
        if (activeIframeDisplayRef.current) {
          activeIframeDisplayRef.current.src = 'about:blank';
        }
      }, 300);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [activeCallRoomId, activeIframeDisplayRef]);

  const applyFixedPositioningToIframe = useCallback(() => {
    const iframeElement = activeIframeDisplayRef?.current;
    const hostElement = iframeHostRef?.current;

    if (iframeElement && hostElement) {
      if (!originalIframeStylesRef.current) {
        const computed = window.getComputedStyle(iframeElement);
        originalIframeStylesRef.current = {
          position: iframeElement.style.position || computed.position,
          top: iframeElement.style.top || computed.top,
          left: iframeElement.style.left || computed.left,
          width: iframeElement.style.width || computed.width,
          height: iframeElement.style.height || computed.height,
          zIndex: iframeElement.style.zIndex || computed.zIndex,
          display: iframeElement.style.display || computed.display,
          visibility: iframeElement.style.visibility || computed.visibility,
          pointerEvents: iframeElement.style.pointerEvents || computed.pointerEvents,
          border: iframeElement.style.border || computed.border,
        };
      }

      const hostRect = hostElement.getBoundingClientRect();

      iframeElement.style.position = 'fixed';
      iframeElement.style.top = `${hostRect.top}px`;
      iframeElement.style.left = `${hostRect.left}px`;
      iframeElement.style.width = `${hostRect.width}px`;
      iframeElement.style.height = `${hostRect.height}px`;
      iframeElement.style.border = 'none';
      iframeElement.style.zIndex = '1000';
      iframeElement.style.display = (room.isCallRoom() || isActiveCallRoom) && isCallViewOpen ? 'block' : 'none';
      iframeElement.style.visibility = 'visible';
      iframeElement.style.pointerEvents = 'auto';
    }
  }, [activeIframeDisplayRef, room, isActiveCallRoom, isCallViewOpen]);

  const debouncedApplyFixedPositioning = useDebounce(applyFixedPositioningToIframe, {
    wait: 50,
    immediate: false,
  });
  useEffect(() => {
    const iframeElement = activeIframeDisplayRef?.current;
    const hostElement = iframeHostRef?.current;

    // Show the iframe as soon as the call is active (not just when ready) so that
    // the Element Call lobby is visible and interactive when callAutoJoin is off.
    if (room.isCallRoom() || (isActiveCallRoom && iframeElement && hostElement)) {
      applyFixedPositioningToIframe();

      const resizeObserver = new ResizeObserver(debouncedApplyFixedPositioning);
      if (hostElement) resizeObserver.observe(hostElement);
      window.addEventListener('scroll', debouncedApplyFixedPositioning, true);

      return () => {
        resizeObserver.disconnect();
        window.removeEventListener('scroll', debouncedApplyFixedPositioning, true);

        if (iframeElement && originalIframeStylesRef.current) {
          const originalStyles = originalIframeStylesRef.current;
          (Object.keys(originalStyles) as Array<keyof OriginalStyles>).forEach((key) => {
            if (key in iframeElement.style) {
              iframeElement.style[key as any] = originalStyles[key] || '';
            }
          });
        }
        originalIframeStylesRef.current = null;
      };
    }

    return undefined;
  }, [
    activeIframeDisplayRef,
    applyFixedPositioningToIframe,
    debouncedApplyFixedPositioning,
    isActiveCallRoom,
    room,
  ]);

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
      style={{ display: isCallViewVisible ? 'flex' : 'none' }}
    >
      {/* iframe host: reserves space for the fixed-position EC iframe */}
      <div
        ref={iframeHostRef}
        style={{
          height: '100%',
          width: '100%',
          position: 'relative',
          pointerEvents: 'none',
          // Show once the call is active and the pre-join screen has been dismissed.
          display: isActiveCallRoom && !pendingJoin ? 'flex' : 'none',
        }}
      />
      {/* Pre-join screen: shown after the user clicks "Join Voice" but before confirming */}
      {isActiveCallRoom && pendingJoin && (
        <Box
          role="dialog"
          aria-modal="true"
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
      <Box
        grow="Yes"
        justifyContent="Center"
        alignItems="Center"
        direction="Column"
        gap="300"
        style={{
          // Show cinny's own join UI only when no call is active yet.
          display: isActiveCallRoom ? 'none' : 'flex',
        }}
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
    </Box>
  );
}