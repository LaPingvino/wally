import { useAtomValue } from 'jotai';
import React, { ReactNode, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MatrixEvent, Room, RoomEvent, RoomEventHandlerMap, RoomMemberEvent } from 'matrix-js-sdk';
import { roomToUnreadAtom, unreadEqual, unreadInfoToUnread } from '../../state/room/roomToUnread';
import LogoSVG from '../../../../public/res/svg/cinny.svg';
import LogoUnreadSVG from '../../../../public/res/svg/cinny-unread.svg';
import LogoHighlightSVG from '../../../../public/res/svg/cinny-highlight.svg';
import NotificationSound from '../../../../public/sound/notification.ogg';
import InviteSound from '../../../../public/sound/invite.ogg';
import { notificationPermission, setFavicon } from '../../utils/dom';
import { useSetting } from '../../state/hooks/settings';
import { EmojiFont, getSettings, settingsAtom } from '../../state/settings';
import { allInvitesAtom } from '../../state/room-list/inviteList';
import { usePreviousValue } from '../../hooks/usePreviousValue';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getHomeRoomPath, getInboxInvitesPath, getInboxNotificationsPath } from '../pathUtils';
import {
  getMemberDisplayName,
  getNotificationType,
  getUnreadInfo,
  isNotificationEvent,
} from '../../utils/room';
import { NotificationType, UnreadInfo } from '../../../types/matrix/room';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { playCurrentRoomSound, playReactionSound, playTypingSound } from '../../utils/sounds';
import { announce } from '../../utils/announce';
import { useSelectedRoom } from '../../hooks/router/useSelectedRoom';
import { useBackgroundBackfill } from '../../hooks/useBackgroundBackfill';
import { useFavoriteRoomsDriver } from '../../hooks/useFavoriteRooms';
import { useInboxNotificationsSelected } from '../../hooks/router/useInbox';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { SyncState } from 'matrix-js-sdk';
import { repairIDBAndReload, backupSessionToCache, checkpointCryptoStores } from '../../../client/initMatrix';
import { logFailureEvent, dumpFailureLog, setHeartbeatContext } from '../../../client/diagnostics';
import { MemoryWatchdog } from './MemoryWatchdog';

/**
 * Monitors session health after tab suspension (common on Chromebooks).
 *
 * When a Chromebook discards a tab to save memory, IndexedDB connections become
 * invalid. The SDK can't sync or persist data, but the error surfaces only as
 * an opaque UnknownError — there's no specific "IDB died" event to catch.
 *
 * This component listens for `visibilitychange` and, when the tab wakes up:
 *  1. Probes IndexedDB with a quick open/close.
 *  2. If IDB is broken → auto-repairs (wipes IDB, preserves localStorage creds, reloads).
 *  3. If IDB is fine but sync is stuck → calls retryImmediately() to nudge reconnection.
 */
function SessionHealthMonitor() {
  const mx = useMatrixClient();
  const hiddenSinceRef = useRef<number | null>(null);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        hiddenSinceRef.current = Date.now();
        return;
      }

      // Tab is visible again. Only run health check if we were hidden > 5 seconds
      // (short hides like alt-tabbing away briefly don't need recovery).
      const hiddenMs = hiddenSinceRef.current ? Date.now() - hiddenSinceRef.current : 0;
      hiddenSinceRef.current = null;
      if (hiddenMs < 5_000) return;

      // 1. Probe IndexedDB health — a broken connection means the OS discarded our tab.
      const probeDb = `idb-health-${Date.now()}`;
      try {
        const req = indexedDB.open(probeDb);
        req.onsuccess = () => {
          // IDB works — clean up probe and check sync instead.
          req.result.close();
          indexedDB.deleteDatabase(probeDb);

          // Keep the Cache API session backup fresh while healthy.
          backupSessionToCache();

          // 2. If sync hasn't produced an event recently, nudge reconnection.
          const syncState = mx.getSyncState();
          if (syncState === SyncState.Error || syncState === SyncState.Stopped) {
            mx.retryImmediately();
          }
        };
        req.onerror = () => {
          // IDB is broken — auto-repair.
          indexedDB.deleteDatabase(probeDb);
          logFailureEvent('idb_probe_failed', { trigger: 'open_onerror' });
          repairIDBAndReload();
        };
      } catch (err) {
        // indexedDB.open() threw — critically broken.
        logFailureEvent('idb_probe_failed', { trigger: 'open_threw', message: String(err) });
        repairIDBAndReload();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [mx]);

  return null;
}

/**
 * Periodically checkpoints crypto IndexedDB stores so that crash recovery
 * can restore from the checkpoint instead of requiring recovery password.
 *
 * - First checkpoint: after initial sync completes.
 * - Repeat: every 30 minutes while the tab is healthy.
 */
function CryptoCheckpointManager() {
  const mx = useMatrixClient();
  const checkpointedRef = useRef(false);

  useEffect(() => {
    // Tightened from 30 → 5 minutes: a Chromebook OS crash mid-session
    // restores from this checkpoint, and a 30-minute window meant new
    // device keys received in that window were lost (device showed
    // "unverified" after recovery). 5 minutes still survives crash
    // bursts and keeps the verification window narrow.
    const CHECKPOINT_INTERVAL = 5 * 60 * 1000;

    // Surface the failure log on startup so anyone investigating a
    // recovery-key prompt can see the trail of events that led there
    // without having to know about the Cache API entry.
    logFailureEvent('startup');
    dumpFailureLog();

    // Device-key fingerprint tracking — diagnostic for the "checkpoint
    // restored but device shows unverified" path. If curve25519/ed25519
    // change across a reload we know crypto identity rotated, which
    // proves the rust-store round-trip lost the device keys (server then
    // sees fresh keys under the same device_id, invalidating signatures).
    const LAST_KEYS_LS = 'wally_device_keys_last';
    const snapshotDeviceKeys = async (reason: string) => {
      try {
        const crypto = mx.getCrypto();
        if (!crypto) return;
        const keys = await crypto.getOwnDeviceKeys();
        const fingerprint = {
          curve25519: keys.curve25519,
          ed25519: keys.ed25519,
        };
        const prevRaw = localStorage.getItem(LAST_KEYS_LS);
        const prev = prevRaw ? (JSON.parse(prevRaw) as typeof fingerprint) : null;
        if (prev && (prev.curve25519 !== fingerprint.curve25519 || prev.ed25519 !== fingerprint.ed25519)) {
          logFailureEvent('device_keys_changed', { reason, prev, current: fingerprint });
        }
        logFailureEvent('device_keys_snapshot', { reason, ...fingerprint });
        localStorage.setItem(LAST_KEYS_LS, JSON.stringify(fingerprint));
      } catch (e) {
        // best-effort diagnostic
        console.warn('Device key snapshot failed:', e);
      }
    };

    const doCheckpoint = async () => {
      // Snapshot before checkpoint so the blob's identity is recorded in
      // the log next to the `checkpoint_written` event.
      await snapshotDeviceKeys('pre_checkpoint');
      await checkpointCryptoStores().catch((e) => {
        console.warn('Crypto checkpoint failed:', e);
      });
    };

    // Checkpoint once sync is prepared (initial sync done).
    const onSync = (state: SyncState | null) => {
      if (state === SyncState.Syncing && !checkpointedRef.current) {
        checkpointedRef.current = true;
        // Snapshot device keys early — fires once sync is up, which is
        // the moment we'd see a rotated identity post-recovery.
        void snapshotDeviceKeys('post_sync');
        // Small delay to let crypto settle after first sync.
        setTimeout(doCheckpoint, 5_000);
      }
      // Update heartbeat context so a post-crash log can show what
      // sync state we were in. Forensics for OS-level kills.
      setHeartbeatContext({
        syncState: state,
        userId: mx.getUserId(),
      });
    };

    mx.on('sync' as any, onSync);
    // Initial fix-up so we always have at least minimal context.
    setHeartbeatContext({
      syncState: mx.getSyncState(),
      userId: mx.getUserId(),
    });

    // Periodic checkpoint, self-rescheduling. We don't want two
    // checkpoints racing into the rust crypto store — overlapping writes
    // can corrupt the store or drop device keys. setTimeout chain
    // guarantees the next run only starts after the previous one
    // (snapshot + checkpoint) has fully completed.
    let cancelled = false;
    let checkpointTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleCheckpoint = () => {
      checkpointTimer = setTimeout(async () => {
        try {
          await doCheckpoint();
        } finally {
          if (!cancelled) scheduleCheckpoint();
        }
      }, CHECKPOINT_INTERVAL);
    };
    scheduleCheckpoint();

    // Best-effort checkpoint right before the tab is hidden / discarded —
    // catches the case where the OS is about to kill us. pagehide is
    // sync-only, so we kick off the async work and let the browser keep
    // the tab alive long enough; if it doesn't, we lost at most a few
    // minutes vs. nothing. Idempotent against the periodic interval.
    const onPageHide = () => { void doCheckpoint(); };
    window.addEventListener('pagehide', onPageHide);

    return () => {
      mx.off('sync' as any, onSync);
      cancelled = true;
      if (checkpointTimer) clearTimeout(checkpointTimer);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [mx]);

  return null;
}

function SystemEmojiFeature() {
  const [emojiFont] = useSetting(settingsAtom, 'emojiFont');

  useEffect(() => {
    switch (emojiFont) {
      case EmojiFont.Twemoji:
        document.documentElement.style.setProperty('--font-emoji', 'Twemoji');
        break;
      case EmojiFont.NotoColorEmojiBahai:
        document.documentElement.style.setProperty('--font-emoji', 'NotoColorEmojiBahai');
        break;
      case EmojiFont.System:
      default:
        document.documentElement.style.setProperty('--font-emoji', 'Twemoji_DISABLED');
        break;
    }
  }, [emojiFont]);

  return null;
}

function PageZoomFeature() {
  const [pageZoom] = useSetting(settingsAtom, 'pageZoom');

  useEffect(() => {
    if (pageZoom === 100) {
      document.documentElement.style.removeProperty('font-size');
    } else {
      document.documentElement.style.setProperty('font-size', `calc(1em * ${pageZoom / 100})`);
    }
  }, [pageZoom]);

  return null;
}

function FaviconUpdater() {
  const roomToUnread = useAtomValue(roomToUnreadAtom);

  useEffect(() => {
    let notification = false;
    let highlight = false;
    roomToUnread.forEach((unread) => {
      if (unread.total > 0) {
        notification = true;
      }
      if (unread.highlight > 0) {
        highlight = true;
      }
    });

    if (notification) {
      setFavicon(highlight ? LogoHighlightSVG : LogoUnreadSVG);
    } else {
      setFavicon(LogoSVG);
    }
  }, [roomToUnread]);

  return null;
}

function InviteNotifications() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const invites = useAtomValue(allInvitesAtom);
  const perviousInviteLen = usePreviousValue(invites.length, 0);
  const mx = useMatrixClient();

  const navigate = useNavigate();
  const [showNotifications] = useSetting(settingsAtom, 'showNotifications');
  const [notificationSound] = useSetting(settingsAtom, 'isNotificationSounds');

  const notify = useCallback(
    (count: number) => {
      const noti = new window.Notification('Invitation', {
        icon: LogoSVG,
        badge: LogoSVG,
        body: `You have ${count} new invitation request.`,
        silent: true,
      });

      noti.onclick = () => {
        if (!window.closed) navigate(getInboxInvitesPath());
        noti.close();
      };
    },
    [navigate]
  );

  const playSound = useCallback(() => {
    const audioElement = audioRef.current;
    audioElement?.play();
  }, []);

  useEffect(() => {
    if (invites.length > perviousInviteLen && mx.getSyncState() === 'SYNCING') {
      if (showNotifications && notificationPermission('granted')) {
        notify(invites.length - perviousInviteLen);
      }

      if (notificationSound) {
        playSound();
      }
    }
  }, [mx, invites, perviousInviteLen, showNotifications, notificationSound, notify, playSound]);

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <audio ref={audioRef} style={{ display: 'none' }}>
      <source src={InviteSound} type="audio/ogg" />
    </audio>
  );
}

function MessageNotifications() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const notifRef = useRef<Notification>();
  const unreadCacheRef = useRef<Map<string, UnreadInfo>>(new Map());
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const [showNotifications] = useSetting(settingsAtom, 'showNotifications');
  const [notificationSound] = useSetting(settingsAtom, 'isNotificationSounds');
  const [inRoomActivitySound] = useSetting(settingsAtom, 'inRoomActivitySound');
  const [reactionToMeSound] = useSetting(settingsAtom, 'reactionToMeSound');
  const prevTypingCountRef = useRef(0);

  const navigate = useNavigate();
  const notificationSelected = useInboxNotificationsSelected();
  const selectedRoomId = useSelectedRoom();

  const notify = useCallback(
    ({
      roomName,
      roomAvatar,
      username,
      roomId,
      eventId,
    }: {
      roomName: string;
      roomAvatar?: string;
      username: string;
      roomId: string;
      eventId: string;
    }) => {
      const noti = new window.Notification(roomName, {
        icon: roomAvatar,
        badge: roomAvatar,
        body: `New inbox notification from ${username}`,
        silent: true,
      });

      noti.onclick = () => {
        if (!window.closed) {
          window.focus();
          navigate(getHomeRoomPath(roomId, eventId));
        }
        noti.close();
        notifRef.current = undefined;
      };

      notifRef.current?.close();
      notifRef.current = noti;
    },
    [navigate]
  );

  const playSound = useCallback(() => {
    const audioElement = audioRef.current;
    audioElement?.play();
  }, []);

  useEffect(() => {
    const handleTimelineEvent: RoomEventHandlerMap[RoomEvent.Timeline] = (
      mEvent,
      room,
      toStartOfTimeline,
      removed,
      data
    ) => {
      if (mx.getSyncState() !== 'SYNCING') return;
      if (document.hasFocus() && (selectedRoomId === room?.roomId || notificationSelected)) return;
      if (
        !room ||
        !data.liveEvent ||
        room.isSpaceRoom() ||
        !isNotificationEvent(mEvent) ||
        getNotificationType(mx, room.roomId) === NotificationType.Mute
      ) {
        return;
      }

      // Honor per-room push rules: 'mentions only' rooms must not raise a
      // desktop notification on every message. getPushActionsForEvent
      // resolves rule actions (override + room + content + underride) into
      // a final notify boolean for THIS event.
      const pushActions = mx.getPushActionsForEvent(mEvent);
      if (!pushActions?.notify) return;

      const sender = mEvent.getSender();
      const eventId = mEvent.getId();
      if (!sender || !eventId || mEvent.getSender() === mx.getUserId()) return;
      const unreadInfo = getUnreadInfo(room, mx);
      const cachedUnreadInfo = unreadCacheRef.current.get(room.roomId);
      unreadCacheRef.current.set(room.roomId, unreadInfo);

      if (unreadInfo.total === 0) return;
      if (
        cachedUnreadInfo &&
        unreadEqual(unreadInfoToUnread(cachedUnreadInfo), unreadInfoToUnread(unreadInfo))
      ) {
        return;
      }

      if (showNotifications && notificationPermission('granted')) {
        const avatarMxc =
          room.getAvatarFallbackMember()?.getMxcAvatarUrl() ?? room.getMxcAvatarUrl();
        notify({
          roomName: room.name ?? 'Unknown',
          roomAvatar: avatarMxc
            ? mxcUrlToHttp(mx, avatarMxc, useAuthentication, 96, 96, 'crop') ?? undefined
            : undefined,
          username: getMemberDisplayName(room, sender) ?? getMxIdLocalPart(sender) ?? sender,
          roomId: room.roomId,
          eventId,
        });
      }

      if (notificationSound) {
        playSound();
      }
    };
    mx.on(RoomEvent.Timeline, handleTimelineEvent);

    // In-room activity ding — plays for messages in the currently focused room
    const handleInRoomSound: RoomEventHandlerMap[RoomEvent.Timeline] = (
      mEvent, room, _toStart, _removed, data
    ) => {
      if (!inRoomActivitySound || !data.liveEvent) return;
      if (!room || room.roomId !== selectedRoomId) return;
      if (!document.hasFocus()) return;
      if (mEvent.getSender() === mx.getUserId()) return;
      if (!isNotificationEvent(mEvent)) return;
      playCurrentRoomSound();
    };
    mx.on(RoomEvent.Timeline, handleInRoomSound);

    // Reaction to my own message
    const handleReactionEvent: RoomEventHandlerMap[RoomEvent.Timeline] = (
      mEvent,
      room,
      _toStart,
      _removed,
      data
    ) => {
      if (!data.liveEvent || mEvent.getType() !== 'm.reaction') return;
      const rel = mEvent.getContent()['m.relates_to'] as
        | { rel_type?: string; event_id?: string; key?: string }
        | undefined;
      if (rel?.rel_type !== 'm.annotation' || !rel.event_id) return;
      const targetEvt = room?.findEventById(rel.event_id);
      if (targetEvt?.getSender() !== mx.getUserId()) return;
      if (reactionToMeSound) playReactionSound();
      const reactor = mEvent.getSender() ?? 'Someone';
      const reactorName = room
        ? (getMemberDisplayName(room, reactor) ?? getMxIdLocalPart(reactor) ?? reactor)
        : reactor;
      announce(`${reactorName} reacted ${rel.key ?? ''} to your message`);
    };
    mx.on(RoomEvent.Timeline, handleReactionEvent);

    // Typing sound for current room
    const handleTyping = (event: MatrixEvent, member: { roomId?: string }) => {
      if (member.roomId !== selectedRoomId) return;
      const typingUserIds =
        (event.getContent() as { user_ids?: string[] }).user_ids ?? [];
      const othersTyping = typingUserIds.filter((uid) => uid !== mx.getUserId());
      if (othersTyping.length > 0 && prevTypingCountRef.current === 0) {
        if (inRoomActivitySound) playTypingSound();
        announce('Someone is typing');
      }
      prevTypingCountRef.current = othersTyping.length;
    };
    mx.on(RoomMemberEvent.Typing, handleTyping as any);

    return () => {
      mx.removeListener(RoomEvent.Timeline, handleTimelineEvent);
      mx.removeListener(RoomEvent.Timeline, handleInRoomSound);
      mx.removeListener(RoomEvent.Timeline, handleReactionEvent);
      mx.removeListener(RoomMemberEvent.Typing, handleTyping as any);
    };
  }, [
    mx,
    notificationSound,
    notificationSelected,
    showNotifications,
    playSound,
    notify,
    selectedRoomId,
    useAuthentication,
    inRoomActivitySound,
    reactionToMeSound,
  ]);

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <audio ref={audioRef} style={{ display: 'none' }}>
      <source src={NotificationSound} type="audio/ogg" />
    </audio>
  );
}

type ClientNonUIFeaturesProps = {
  children: ReactNode;
};

function BackgroundBackfillFeature() {
  useBackgroundBackfill();
  return null;
}

function GlobalDrivers() {
  useFavoriteRoomsDriver();
  return null;
}

export function ClientNonUIFeatures({ children }: ClientNonUIFeaturesProps) {
  return (
    <>
      <GlobalDrivers />
      <SessionHealthMonitor />
      <CryptoCheckpointManager />
      <MemoryWatchdog />
      <SystemEmojiFeature />
      <PageZoomFeature />
      <FaviconUpdater />
      <InviteNotifications />
      <MessageNotifications />
      <BackgroundBackfillFeature />
      {children}
    </>
  );
}
