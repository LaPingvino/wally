import {
  Box,
  Chip,
  Icon,
  IconButton,
  Icons,
  type IconSrc,
  Line,
  Spinner,
  Text,
  Tooltip,
  TooltipProvider,
  color,
} from 'folds';
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { EventType } from 'matrix-js-sdk';
import { LiveKitRoomContext } from '../../pages/client/call/PersistentCallContainer';
import { MatrixRTCSessionManagerEvents } from 'matrix-js-sdk/lib/matrixrtc/MatrixRTCSessionManager';
import { MatrixRTCSession } from 'matrix-js-sdk/lib/matrixrtc/MatrixRTCSession';
import { useCallState } from '../../pages/client/call/CallProvider';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { mxcUrlToHttp } from '../../utils/matrix';
import { announce } from '../../utils/announce';
import {
  getRoomNotificationMode,
  RoomNotificationMode,
  useRoomsNotificationPreferences,
} from '../../hooks/useRoomsNotificationPreferences';
import { settingsAtom } from '../../state/settings';
import { playMentionSound } from '../../utils/sounds';
import { useNavigateUnread } from '../../hooks/useNavigateUnread';
import { bottomBarDismissedAtom } from '../../state/bottomBarDismiss';
import { hideReadRoomsAtom } from '../../state/hideReadRooms';
import * as css from './RoomCallNavStatus.css';

/**
 * Priority-ordered nav items for the bottom bar.
 * Rendered in this order; dropped from the end when width is tight.
 * 1. Next mention (until all mentions are gone)
 * 2. Next unread
 * 3. Previous mention
 * 4. Previous unread
 */
type NavItem = {
  key: string;
  ariaLabel: string;
  tooltip: string;
  /** Left-side icon (the direction or the content label, depending on item). */
  leftIcon: IconSrc;
  /** Right-side icon. */
  rightIcon: IconSrc;
  onClick: () => void;
};

const NAV_ITEM_WIDTH = 44; // px per icon button (2-icon composite) including gap
const DISMISS_BTN_WIDTH = 40;

function NavIconButton({ item }: { item: NavItem }) {
  return (
    <TooltipProvider
      position="Top"
      offset={4}
      tooltip={<Tooltip><Text>{item.tooltip}</Text></Tooltip>}
    >
      {(triggerRef) => (
        <IconButton
          fill="None"
          size="300"
          ref={triggerRef}
          aria-label={item.ariaLabel}
          onClick={item.onClick}
        >
          <Box alignItems="Center" style={{ gap: 1 }}>
            <Icon src={item.leftIcon} size="50" />
            <Icon src={item.rightIcon} size="50" />
          </Box>
        </IconButton>
      )}
    </TooltipProvider>
  );
}

// Module-level: persists across tab switches (Direct/Home/Space each mount their own CallNavStatus).
// Stores rooms where the ring timed out so we don't re-ring on remount.
const timedOutCalls = new Set<string>();
// Rooms the user explicitly hung up or dismissed — SessionStarted won't clear these,
// so the call can't re-ring until it truly ends (SessionEnded) and restarts.
const hungUpCalls = new Set<string>();

const RING_TIMEOUT_MS = 30_000;

// Play two short bursts (480Hz + 620Hz, classic POTS ring) then a pause.
function playRingCycle(ctx: AudioContext) {
  const now = ctx.currentTime;
  for (let burst = 0; burst < 2; burst++) {
    const start = now + burst * 0.5;
    const end = start + 0.4;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.15, start + 0.02);
    gain.gain.setValueAtTime(0.15, end - 0.04);
    gain.gain.linearRampToValueAtTime(0, end);
    [480, 620].forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(start);
      osc.stop(end);
    });
  }
}

interface IncomingCall {
  roomId: string;
}

export function CallNavStatus() {
  const mx = useMatrixClient();
  const {
    activeCallRoomId,
    lkConnected,
    hangUp,
    setActiveCallRoomId,
    pendingJoin,
  } = useCallState();
  const lkCtx = useContext(LiveKitRoomContext);
  const { navigateRoom } = useRoomNavigate();

  const [incomingCalls, setIncomingCalls] = useState<IncomingCall[]>([]);
  const [callPage, setCallPage] = useState(0);

  const dismissedRef = useRef<Set<string>>(new Set());
  // Per-call ring timeout handles
  const callTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Track which incoming call we've already announced to avoid re-announcing on re-render
  const announcedCallRef = useRef<string | null>(null);

  // Ringtone
  const audioCtxRef = useRef<AudioContext | null>(null);
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const callRingtoneUrl = useAtomValue(settingsAtom).callRingtoneUrl ?? null;
  const useAuthentication = useMediaAuthentication();

  const stopRingtone = useCallback(() => {
    if (ringTimerRef.current) {
      clearTimeout(ringTimerRef.current);
      ringTimerRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.src = '';
      audioElRef.current = null;
    }
  }, []);

  const scheduleNextCycle = useCallback((ctx: AudioContext) => {
    playRingCycle(ctx);
    ringTimerRef.current = setTimeout(() => {
      if (audioCtxRef.current) scheduleNextCycle(audioCtxRef.current);
    }, 3000);
  }, []);

  const startRingtone = useCallback(() => {
    if (audioCtxRef.current || audioElRef.current) return;

    // Resolve custom ringtone URL (supports mxc:// and https://)
    const resolvedUrl = callRingtoneUrl
      ? callRingtoneUrl.startsWith('mxc://')
        ? mxcUrlToHttp(mx, callRingtoneUrl, useAuthentication)
        : callRingtoneUrl
      : null;

    if (resolvedUrl) {
      const audio = new Audio(resolvedUrl);
      audio.loop = true;
      audioElRef.current = audio;
      audio.play().catch(() => {
        // Playback failed — fall through to synthesized fallback
        audioElRef.current = null;
        try {
          const newCtx = new AudioContext();
          audioCtxRef.current = newCtx;
          newCtx.resume().then(() => scheduleNextCycle(newCtx)).catch(() => scheduleNextCycle(newCtx));
        } catch {
          // Audio blocked or not supported
        }
      });
      return;
    }

    // Fallback: synthesized POTS ring
    try {
      const newCtx = new AudioContext();
      audioCtxRef.current = newCtx;
      // Resume the context — modern browsers start AudioContext in suspended state,
      // which silently prevents oscillators from playing. resume() succeeds when the
      // page has recent user interaction (the typical case for an active chat user).
      newCtx.resume().then(() => scheduleNextCycle(newCtx)).catch(() => scheduleNextCycle(newCtx));
    } catch {
      // Audio blocked or not supported
    }
  }, [callRingtoneUrl, mx, useAuthentication, scheduleNextCycle]);

  const notificationPreferences = useRoomsNotificationPreferences();
  const callRingScope = useAtomValue(settingsAtom).callRingScope ?? 'nonVoice';

  // Don't show the calling indicator during pendingJoin — the user hasn't
  // confirmed they want to join yet. Showing "in call" + hangup prematurely
  // is confusing and the call hasn't actually started.
  const hasActiveCall = Boolean(activeCallRoomId) && !pendingJoin;
  const isConnected = hasActiveCall && lkConnected;

  const clearCallTimeout = useCallback((roomId: string) => {
    const t = callTimeoutsRef.current.get(roomId);
    if (t) {
      clearTimeout(t);
      callTimeoutsRef.current.delete(roomId);
    }
  }, []);

  // Clean up all per-call timeouts on unmount
  useEffect(
    () => () => {
      callTimeoutsRef.current.forEach((t) => clearTimeout(t));
      callTimeoutsRef.current.clear();
      stopRingtone();
    },
    [stopRingtone]
  );

  useEffect(() => {
    const myUserId = mx.getUserId();

    const addCall = (roomId: string, session: MatrixRTCSession) => {
      if (roomId === activeCallRoomId) return;
      if (dismissedRef.current.has(roomId)) return;
      if (timedOutCalls.has(roomId)) return;
      // Voice rooms are persistent channels — skip unless user opted into 'all'
      if (callRingScope !== 'all' && mx.getRoom(roomId)?.isCallRoom()) return;
      // For DM-only scope, skip non-DM rooms
      if (callRingScope === 'dm') {
        const dmContent = mx.getAccountData(EventType.Direct)?.getContent<Record<string, string[]>>();
        const dmRoomIds = new Set(Object.values(dmContent ?? {}).flat());
        if (!dmRoomIds.has(roomId)) return;
      }
      // Respect notification settings — muted rooms get no ring or bar
      if (getRoomNotificationMode(notificationPreferences, roomId) === RoomNotificationMode.Mute) return;
      const otherMembers = session.memberships.filter((m) => m.sender !== myUserId);
      if (otherMembers.length === 0) return;

      setIncomingCalls((prev) => {
        if (prev.some((c) => c.roomId === roomId)) return prev;
        return [...prev, { roomId }];
      });

      // Auto-dismiss after timeout so a missed call doesn't re-ring on tab switch
      if (!callTimeoutsRef.current.has(roomId)) {
        const t = setTimeout(() => {
          timedOutCalls.add(roomId);
          dismissedRef.current.add(roomId);
          callTimeoutsRef.current.delete(roomId);
          setIncomingCalls((prev) => prev.filter((c) => c.roomId !== roomId));
        }, RING_TIMEOUT_MS);
        callTimeoutsRef.current.set(roomId, t);
      }
    };

    for (const room of mx.getRooms()) {
      const memberships = MatrixRTCSession.callMembershipsForRoom(room);
      if (memberships.filter((m) => m.sender !== myUserId).length > 0) {
        const session = mx.matrixRTC.getRoomSession(room);
        addCall(room.roomId, session);
      }
    }

    const handleSessionStarted = (roomId: string, session: MatrixRTCSession) => {
      // New session means a fresh call — clear timeout/dismiss state, UNLESS the user
      // explicitly hung up or dismissed this room (hungUpCalls). In that case, keep
      // suppressing the ring until SessionEnded confirms the call truly ended.
      if (!hungUpCalls.has(roomId)) {
        timedOutCalls.delete(roomId);
        dismissedRef.current.delete(roomId);
      }
      clearCallTimeout(roomId);
      addCall(roomId, session);
    };

    const handleSessionEnded = (roomId: string) => {
      // Session truly ended — clear all state including explicit hang-up, allow re-ring next time.
      timedOutCalls.delete(roomId);
      hungUpCalls.delete(roomId);
      dismissedRef.current.delete(roomId);
      clearCallTimeout(roomId);
      setIncomingCalls((prev) => prev.filter((c) => c.roomId !== roomId));
    };

    mx.matrixRTC.on(MatrixRTCSessionManagerEvents.SessionStarted, handleSessionStarted);
    mx.matrixRTC.on(MatrixRTCSessionManagerEvents.SessionEnded, handleSessionEnded);

    return () => {
      mx.matrixRTC.removeListener(MatrixRTCSessionManagerEvents.SessionStarted, handleSessionStarted);
      mx.matrixRTC.removeListener(MatrixRTCSessionManagerEvents.SessionEnded, handleSessionEnded);
    };
  }, [mx, activeCallRoomId, clearCallTimeout, notificationPreferences, callRingScope]);

  const handleJoin = useCallback(
    (roomId: string) => {
      clearCallTimeout(roomId);
      setActiveCallRoomId(roomId, true);
      navigateRoom(roomId);
      setIncomingCalls((prev) => prev.filter((c) => c.roomId !== roomId));
    },
    [setActiveCallRoomId, navigateRoom, clearCallTimeout]
  );

  const handleDismiss = useCallback(
    (roomId: string) => {
      clearCallTimeout(roomId);
      timedOutCalls.add(roomId);
      hungUpCalls.add(roomId);
      dismissedRef.current.add(roomId);
      setIncomingCalls((prev) => prev.filter((c) => c.roomId !== roomId));
    },
    [clearCallTimeout]
  );

  // Play a join sound once when the call transitions to connected (isConnected goes true).
  // EC suppresses its own join sound in widget/embed mode, so cinny provides it.
  const prevConnectedRef = useRef(false);
  useEffect(() => {
    if (isConnected && !prevConnectedRef.current) {
      playMentionSound();
    }
    prevConnectedRef.current = isConnected;
  }, [isConnected]);

  // Ring while incoming calls are waiting; announce the first call to screen readers
  useEffect(() => {
    if (!hasActiveCall && incomingCalls.length > 0) {
      startRingtone();
      const firstRoomId = incomingCalls[0].roomId;
      if (announcedCallRef.current !== firstRoomId) {
        announcedCallRef.current = firstRoomId;
        const room = mx.getRoom(firstRoomId);
        announce(`Incoming call${room ? ` in ${room.name}` : ''}`);
      }
    } else {
      stopRingtone();
      announcedCallRef.current = null;
    }
    return stopRingtone;
  }, [hasActiveCall, incomingCalls, startRingtone, stopRingtone, mx]);

  // Clamp page index when calls list shrinks
  const safeIndex = Math.min(callPage, Math.max(0, incomingCalls.length - 1));

  // ── Nav items (prev/next unread/mention) ──
  const {
    navigatePrev,
    navigateNext,
    navigatePrevMention,
    navigateNextMention,
    unreadCount,
    mentionCount,
  } = useNavigateUnread();

  const allNavItems: NavItem[] = [];
  // Prev items first so they appear on the left (LTR reading order).
  if (mentionCount > 0) {
    allNavItems.push({
      key: 'prev-mention',
      ariaLabel: `Previous mention (${mentionCount})`,
      tooltip: `Previous mention (${mentionCount})`,
      leftIcon: Icons.ChevronLeft,
      rightIcon: Icons.Mention,
      onClick: navigatePrevMention,
    });
  }
  if (unreadCount > 0) {
    allNavItems.push({
      key: 'prev-unread',
      ariaLabel: `Previous unread room (${unreadCount})`,
      tooltip: `Previous unread (${unreadCount})`,
      leftIcon: Icons.ChevronLeft,
      rightIcon: Icons.MessageUnread,
      onClick: navigatePrev,
    });
  }
  if (mentionCount > 0) {
    allNavItems.push({
      key: 'next-mention',
      ariaLabel: `Next mention (${mentionCount} ${mentionCount === 1 ? 'room' : 'rooms'})`,
      tooltip: `Next mention (${mentionCount})`,
      leftIcon: Icons.Mention,
      rightIcon: Icons.ChevronRight,
      onClick: navigateNextMention,
    });
  }
  if (unreadCount > 0) {
    allNavItems.push({
      key: 'next-unread',
      ariaLabel: `Next unread room (${unreadCount})`,
      tooltip: `Next unread (${unreadCount})`,
      leftIcon: Icons.MessageUnread,
      rightIcon: Icons.ChevronRight,
      onClick: navigateNext,
    });
  }

  // ── Bar width for responsive nav truncation ──
  const [barEl, setBarEl] = useState<HTMLDivElement | null>(null);
  const [barWidth, setBarWidth] = useState(0);
  useEffect(() => {
    if (!barEl) return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setBarWidth(w);
    });
    obs.observe(barEl);
    return () => obs.disconnect();
  }, [barEl]);

  // ── Dismiss suppression ──
  // User dismisses via X. Stays dismissed until they use Previous/Next nav
  // from the menu (or keyboard) — cleared inside useNavigateUnread's step
  // functions. Active/incoming calls override dismiss (urgent).
  const [dismissed, setDismissed] = useAtom(bottomBarDismissedAtom);
  const handleDismissBar = useCallback(() => setDismissed(true), [setDismissed]);
  const unreadNavBarMode = useAtomValue(settingsAtom).unreadNavBar ?? 'onNav';

  // ── Hide-read-rooms toggle ──
  // Filters the sidebar list to only unread (and selected) rooms so
  // Prev/Next doesn't make the list shuffle as items are read.
  const [hideReadRooms, setHideReadRooms] = useAtom(hideReadRoomsAtom);
  const toggleHideReadRooms = useCallback(
    () => setHideReadRooms((v) => !v),
    [setHideReadRooms]
  );

  const hasNav = allNavItems.length > 0;
  const hasCall = hasActiveCall || incomingCalls.length > 0;
  // Keep the bar around when hideReadRooms is on even with no unreads,
  // otherwise the user has no UI to toggle it back off.
  const hasContent = hasCall || hasNav || hideReadRooms;
  if (!hasContent) return null;
  // Calls always force-show the bar regardless of the unread-nav-bar setting.
  if (!hasCall) {
    if (unreadNavBarMode === 'never') return null;
    if (unreadNavBarMode === 'onNav' && dismissed) return null;
    // 'always' falls through and renders.
  }

  // Responsive truncation: reserve space for call chrome + dismiss button,
  // then fit as many nav items as possible from the priority-ordered list.
  const reservedForCall = hasActiveCall ? 280 : 0;
  const remainingForNav = Math.max(0, barWidth - reservedForCall - DISMISS_BTN_WIDTH - 24);
  const maxVisibleNav = barWidth > 0
    ? Math.max(1, Math.floor(remainingForNav / NAV_ITEM_WIDTH))
    : 1;
  const visibleNav = allNavItems.slice(0, maxVisibleNav);
  // Dismiss button is shown only when the bar has no active/incoming call
  // (call → hangup / per-call dismiss are the real actions) and when the
  // setting actually honors dismissal ('onNav'; in 'always' mode pressing
  // X would be a no-op).
  const showDismiss =
    !hasActiveCall && incomingCalls.length === 0 && unreadNavBarMode === 'onNav';

  const hideReadButton = (
    <TooltipProvider
      position="Top"
      offset={4}
      tooltip={
        <Tooltip>
          <Text>
            {hideReadRooms ? 'Show read rooms' : 'Hide read rooms while triaging'}
          </Text>
        </Tooltip>
      }
    >
      {(triggerRef) => (
        <IconButton
          fill={hideReadRooms ? 'Soft' : 'None'}
          variant={hideReadRooms ? 'Primary' : 'Surface'}
          size="300"
          ref={triggerRef}
          aria-label={hideReadRooms ? 'Show read rooms' : 'Hide read rooms'}
          aria-pressed={hideReadRooms}
          onClick={toggleHideReadRooms}
        >
          <Icon src={hideReadRooms ? Icons.EyeBlind : Icons.Eye} size="50" />
        </IconButton>
      )}
    </TooltipProvider>
  );

  const dismissButton = (
    <TooltipProvider
      position="Top"
      offset={4}
      tooltip={<Tooltip><Text>Dismiss (returns when you use Prev/Next in the menu)</Text></Tooltip>}
    >
      {(triggerRef) => (
        <IconButton
          fill="None"
          size="300"
          ref={triggerRef}
          aria-label="Dismiss bar — returns when you use Previous or Next in the room menu"
          onClick={handleDismissBar}
        >
          <Icon src={Icons.Cross} />
        </IconButton>
      )}
    </TooltipProvider>
  );

  // Nav-only bar (no call, but unread/mention rooms exist — or toggle is on)
  if (!hasActiveCall && incomingCalls.length === 0) {
    return (
      <Box direction="Column" shrink="No" ref={setBarEl}>
        <Line variant="Surface" size="300" />
        <Box
          className={css.Actions}
          direction="Row"
          alignItems="Center"
          gap="100"
          role="toolbar"
          aria-label="Unread and mention navigation"
        >
          {hideReadButton}
          {visibleNav.map((item) => (
            <NavIconButton key={item.key} item={item} />
          ))}
          <Box grow="Yes" />
          {showDismiss && dismissButton}
        </Box>
      </Box>
    );
  }

  // Incoming call(s) with pagination
  if (!hasActiveCall) {
    const current = incomingCalls[safeIndex];
    const room = mx.getRoom(current.roomId);
    const total = incomingCalls.length;

    return (
      <Box direction="Column" shrink="No" ref={setBarEl}>
        <Line variant="Surface" size="300" />
        <Box
          className={css.Actions}
          direction="Row"
          alignItems="Center"
          gap="100"
          style={{ borderLeft: `3px solid ${color.Warning.Main}` }}
        >
          {/* Prev/next pagination — only when multiple calls */}
          {total > 1 && (
            <IconButton
              fill="None"
              size="300"
              onClick={() => setCallPage((p) => Math.max(0, p - 1))}
              disabled={safeIndex === 0}
              aria-label="Previous incoming call"
            >
              <Icon src={Icons.ChevronLeft} size="50" />
            </IconButton>
          )}

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
                  id="incoming-call-join"
                  size="500"
                  fill="Soft"
                  as="button"
                  aria-label={`Join call${room ? ` in ${room.name}` : ''}`}
                  onClick={() => handleJoin(current.roomId)}
                  ref={triggerRef}
                  className={css.RoomButton}
                >
                  <Icon size="300" src={Icons.Phone} style={{ color: color.Warning.Main }} />
                  <Text as="span" size="L400" style={{ color: color.Warning.Main }} truncate>
                    {room?.name ?? current.roomId}
                    {total > 1 && ` (${safeIndex + 1}/${total})`}
                  </Text>
                </Chip>
              )}
            </TooltipProvider>
          </Box>

          {total > 1 && (
            <IconButton
              fill="None"
              size="300"
              onClick={() => setCallPage((p) => Math.min(total - 1, p + 1))}
              disabled={safeIndex === total - 1}
              aria-label="Next incoming call"
            >
              <Icon src={Icons.ChevronRight} size="50" />
            </IconButton>
          )}

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
                aria-label="Dismiss incoming call"
                onClick={() => {
                  handleDismiss(current.roomId);
                  setCallPage((p) => Math.max(0, p - 1));
                }}
              >
                <Icon src={Icons.Cross} />
              </IconButton>
            )}
          </TooltipProvider>
        </Box>
      </Box>
    );
  }

  // Active call — render call chrome on its own row and unread/mention
  // nav on a second row so the two never overlap regardless of how wide
  // the call controls are with mic/camera toggles.
  const navRow = (visibleNav.length > 0 || hideReadRooms) && (
    <Box className={css.Actions} direction="Row" alignItems="Center" gap="100" role="toolbar" aria-label="Unread and mention navigation">
      {hideReadButton}
      {visibleNav.map((item) => (
        <NavIconButton key={item.key} item={item} />
      ))}
    </Box>
  );

  return (
    <Box direction="Column" shrink="No" ref={setBarEl}>
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
                onClick={() => activeCallRoomId && navigateRoom(activeCallRoomId)}
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
            <IconButton
              fill="None"
              size="300"
              ref={triggerRef}
              aria-label="Hang up"
              onClick={() => {
                if (activeCallRoomId) {
                  timedOutCalls.add(activeCallRoomId);
                  hungUpCalls.add(activeCallRoomId);
                  dismissedRef.current.add(activeCallRoomId);
                }
                hangUp();
              }}
            >
              <Icon src={Icons.PhoneDown} />
            </IconButton>
          )}
        </TooltipProvider>
        {lkCtx && (
          <>
            <TooltipProvider
              position="Top"
              offset={4}
              tooltip={
                <Tooltip>
                  <Text>{!lkCtx.isMicEnabled ? 'Unmute' : 'Mute'}</Text>
                </Tooltip>
              }
            >
              {(triggerRef) => (
                <IconButton fill="None" size="300" ref={triggerRef} aria-label={lkCtx.isMicEnabled ? 'Mute microphone' : 'Unmute microphone'} onClick={() => { lkCtx.toggleMicrophone(); announce(lkCtx.isMicEnabled ? 'Microphone muted' : 'Microphone unmuted'); }}>
                  <Icon src={!lkCtx.isMicEnabled ? Icons.MicMute : Icons.Mic} />
                </IconButton>
              )}
            </TooltipProvider>
            <TooltipProvider
              position="Top"
              offset={4}
              tooltip={
                <Tooltip>
                  <Text>{!lkCtx.isCamEnabled ? 'Video On' : 'Video Off'}</Text>
                </Tooltip>
              }
            >
              {(triggerRef) => (
                <IconButton fill="None" size="300" ref={triggerRef} aria-label={lkCtx.isCamEnabled ? 'Turn off camera' : 'Turn on camera'} onClick={() => { lkCtx.toggleCamera(); announce(lkCtx.isCamEnabled ? 'Camera off' : 'Camera on'); }}>
                  <Icon src={!lkCtx.isCamEnabled ? Icons.VideoCameraMute : Icons.VideoCamera} />
                </IconButton>
              )}
            </TooltipProvider>
          </>
        )}
      </Box>
      {navRow}
    </Box>
  );
}
