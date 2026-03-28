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
import { getInboxInvitesPath, getInboxNotificationsPath } from '../pathUtils';
import {
  getMemberDisplayName,
  getNotificationType,
  getUnreadInfo,
  isNotificationEvent,
} from '../../utils/room';
import { NotificationType, UnreadInfo } from '../../../types/matrix/room';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { playReactionSound, playTypingSound } from '../../utils/sounds';
import { announce } from '../../utils/announce';
import { useSelectedRoom } from '../../hooks/router/useSelectedRoom';
import { useInboxNotificationsSelected } from '../../hooks/router/useInbox';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { SyncState } from 'matrix-js-sdk';
import { repairIDBAndReload, backupSessionToCache, checkpointCryptoStores } from '../../../client/initMatrix';

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
          repairIDBAndReload();
        };
      } catch {
        // indexedDB.open() threw — critically broken.
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
    const CHECKPOINT_INTERVAL = 30 * 60 * 1000; // 30 minutes

    const doCheckpoint = () => {
      checkpointCryptoStores().catch((e) => {
        console.warn('Crypto checkpoint failed:', e);
      });
    };

    // Checkpoint once sync is prepared (initial sync done).
    const onSync = (state: SyncState | null) => {
      if (state === SyncState.Syncing && !checkpointedRef.current) {
        checkpointedRef.current = true;
        // Small delay to let crypto settle after first sync.
        setTimeout(doCheckpoint, 5_000);
      }
    };

    mx.on('sync' as any, onSync);

    // Also checkpoint periodically.
    const interval = setInterval(doCheckpoint, CHECKPOINT_INTERVAL);

    return () => {
      mx.off('sync' as any, onSync);
      clearInterval(interval);
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
  const prevTypingCountRef = useRef(0);

  const navigate = useNavigate();
  const notificationSelected = useInboxNotificationsSelected();
  const selectedRoomId = useSelectedRoom();

  const notify = useCallback(
    ({
      roomName,
      roomAvatar,
      username,
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
        if (!window.closed) navigate(getInboxNotificationsPath());
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

      const sender = mEvent.getSender();
      const eventId = mEvent.getId();
      if (!sender || !eventId || mEvent.getSender() === mx.getUserId()) return;
      const unreadInfo = getUnreadInfo(room);
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
      if (notificationSound) playReactionSound();
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

export function ClientNonUIFeatures({ children }: ClientNonUIFeaturesProps) {
  return (
    <>
      <SessionHealthMonitor />
      <CryptoCheckpointManager />
      <SystemEmojiFeature />
      <PageZoomFeature />
      <FaviconUpdater />
      <InviteNotifications />
      <MessageNotifications />
      {children}
    </>
  );
}
