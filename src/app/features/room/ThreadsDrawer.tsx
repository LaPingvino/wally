import React, { KeyboardEventHandler, useCallback, useEffect, useState } from 'react';
import { Room, MatrixEvent, RoomEvent, ThreadEvent, RelationType } from 'matrix-js-sdk';
import {
  Box,
  Spinner,
  Text,
  Icon,
  Icons,
  IconButton,
  config,
  toRem,
} from 'folds';
import { isKeyHotkey } from 'is-hotkey';
import { atom, useAtom } from 'jotai';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { ThreadView } from './ThreadView';

// Global atom — set this to any event ID to open that event's thread in the drawer.
// Timeline messages, issue board, etc. can all import and set this atom.
export const openThreadIdAtom = atom<string | null>(null);

function getDisplayName(userId: string, room: Room): string {
  const member = room.getMember(userId);
  return member?.rawDisplayName || getMxIdLocalPart(userId) || userId;
}

type AvatarCircleProps = {
  displayName: string;
  avatarUrl?: string;
};
function AvatarCircle({ displayName, avatarUrl }: AvatarCircleProps) {
  const letter = displayName[0]?.toUpperCase() ?? '?';
  return (
    <div
      style={{
        width: toRem(28),
        height: toRem(28),
        borderRadius: '50%',
        background: 'var(--bg-secondary)',
        flexShrink: 0,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={displayName}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <Text size="T200">{letter}</Text>
      )}
    </div>
  );
}

// Unified thread representation — works with both SDK Thread objects and timeline fallback.
type ThreadEntry = {
  id: string;
  rootEvent: MatrixEvent;
  replyCount: number;
};

type ThreadItemProps = {
  entry: ThreadEntry;
  room: Room;
  onClick: () => void;
  tabIndex?: number;
};
function ThreadItem({ entry, room, onClick, tabIndex: tabIndexProp }: ThreadItemProps) {
  const { rootEvent, replyCount } = entry;
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const senderId = rootEvent.getSender() ?? '';
  const displayName = getDisplayName(senderId, room);
  const member = room.getMember(senderId);
  const mxcUrl = member?.getMxcAvatarUrl();
  const avatarUrl = mxcUrl
    ? mxcUrlToHttp(mx, mxcUrl, useAuthentication, 28, 28, 'crop') ?? undefined
    : undefined;
  const body: string = rootEvent.getContent().body ?? '';
  const preview = body.length > 80 ? `${body.slice(0, 80)}…` : body;

  return (
    <button
      type="button"
      onClick={onClick}
      data-thread-id={entry.id}
      tabIndex={tabIndexProp ?? 0}
      style={{
        display: 'flex',
        gap: config.space.S200,
        padding: `${config.space.S200} ${config.space.S300}`,
        width: '100%',
        textAlign: 'left',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        borderBottom: '1px solid var(--bg-surface-border)',
        color: 'inherit',
      }}
    >
      <AvatarCircle displayName={displayName} avatarUrl={avatarUrl} />
      <Box direction="Column" gap="100" style={{ flex: 1, minWidth: 0 }}>
        <Text size="T300" style={{ fontWeight: 600 }} truncate>
          {displayName}
        </Text>
        <Text size="T200" priority="300" truncate>
          {preview || '…'}
        </Text>
        <Text size="T200" priority="300">
          {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
        </Text>
      </Box>
    </button>
  );
}

type ThreadsDrawerProps = {
  room: Room;
  onClose: () => void;
  width?: number;
  isFullWidth?: boolean;
  onToggleFullWidth?: () => void;
};

export function ThreadsDrawer({ room, onClose, width = 320, isFullWidth, onToggleFullWidth }: ThreadsDrawerProps) {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [openThreadId, setOpenThreadId] = useAtom(openThreadIdAtom);
  const mx = useMatrixClient();

  // Build thread list from BOTH SDK thread objects (populated after fetchRoomThreads or
  // fresh sync with threadSupport:true) AND a main-timeline scan (works with old session
  // data that predates threadSupport being enabled, or when server lacks MSC3856).
  //
  // We always merge both sources so that opening a thread (which calls room.createThread()
  // to register one SDK Thread object) does not cause the rest of the list to disappear.
  // SDK entries take precedence over fallback entries for the same thread ID.
  const getThreads = useCallback((): ThreadEntry[] => {
    const entries = new Map<string, ThreadEntry>();

    // 1. Fallback: scan main timeline for m.thread relations.
    const timeline = room.getUnfilteredTimelineSet().getLiveTimeline().getEvents();
    const replyMap = new Map<string, number>();
    for (const evt of timeline) {
      if (evt.isRedacted()) continue;
      const rel = evt.getContent()['m.relates_to'] as
        | { rel_type?: string; event_id?: string }
        | undefined;
      if (rel?.rel_type === RelationType.Thread && rel.event_id) {
        replyMap.set(rel.event_id, (replyMap.get(rel.event_id) ?? 0) + 1);
      }
    }
    for (const [rootId, count] of replyMap.entries()) {
      const rootEvent = room.findEventById(rootId);
      if (!rootEvent || rootEvent.isRedacted()) continue;
      entries.set(rootId, { id: rootId, rootEvent, replyCount: count });
    }

    // 2. SDK threads override fallback entries (more accurate reply count, includes
    //    fetched history). Skip any that lack a rootEvent — they aren't ready yet.
    for (const t of room.getThreads()) {
      if (!t.rootEvent) continue;
      entries.set(t.id, { id: t.id, rootEvent: t.rootEvent, replyCount: t.length });
    }

    return [...entries.values()].sort((a, b) => b.rootEvent.getTs() - a.rootEvent.getTs());
  }, [room]);

  const [threads, setThreads] = useState<ThreadEntry[]>(getThreads);
  const [loading, setLoading] = useState(true);
  const [focusedThreadId, setFocusedThreadId] = useState<string | null>(null);

  const handleThreadListKeyDown: KeyboardEventHandler<HTMLDivElement> = useCallback(
    (evt) => {
      const target = evt.target as HTMLElement;
      const threadId = target.getAttribute('data-thread-id');
      if (!threadId) return;
      const isDown = isKeyHotkey('arrowdown', evt as unknown as KeyboardEvent);
      const isUp = isKeyHotkey('arrowup', evt as unknown as KeyboardEvent);
      const isHome = isKeyHotkey('home', evt as unknown as KeyboardEvent);
      const isEnd = isKeyHotkey('end', evt as unknown as KeyboardEvent);
      if (!isDown && !isUp && !isHome && !isEnd) return;
      evt.preventDefault();
      const buttons = Array.from(
        (evt.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-thread-id]')
      );
      const currentIdx = buttons.findIndex((b) => b.getAttribute('data-thread-id') === threadId);
      let nextIdx: number;
      if (isHome) nextIdx = 0;
      else if (isEnd) nextIdx = buttons.length - 1;
      else if (isDown) nextIdx = Math.min(currentIdx + 1, buttons.length - 1);
      else nextIdx = Math.max(currentIdx - 1, 0);
      const next = buttons[nextIdx];
      if (next) {
        setFocusedThreadId(next.getAttribute('data-thread-id'));
        next.focus();
      }
    },
    []
  );

  // Fetch all historical threads on mount via SDK (works when server supports MSC3856).
  // Falls back to showing whatever the timeline scan or local sync state has.
  useEffect(() => {
    setLoading(true);
    room.createThreadsTimelineSets()
      .then(() => room.fetchRoomThreads())
      .then(() => {
        setThreads(getThreads());
        setLoading(false);
      })
      .catch((err) => {
        console.warn('ThreadsDrawer: failed to fetch threads', err);
        setThreads(getThreads());
        setLoading(false);
      });
  }, [room, getThreads]);

  // Keep list updated as new threads arrive or get replies
  useEffect(() => {
    const update = () => setThreads(getThreads());
    room.on(ThreadEvent.New as any, update);
    room.on(ThreadEvent.NewReply as any, update);
    room.on(RoomEvent.Timeline as any, update);
    return () => {
      room.off(ThreadEvent.New as any, update);
      room.off(ThreadEvent.NewReply as any, update);
      room.off(RoomEvent.Timeline as any, update);
    };
  }, [room, getThreads]);

  // Open a specific thread when requested via atom (from timeline, issue board, etc.)
  useEffect(() => {
    if (openThreadId) {
      setSelectedThreadId(openThreadId);
      setOpenThreadId(null);
    }
  }, [openThreadId, setOpenThreadId]);

  return (
    <Box
      id="cinny-threads-panel"
      role="region"
      aria-label="Threads panel"
      tabIndex={-1}
      direction="Column"
      style={
        isFullWidth
          ? { flex: 1, minWidth: 0, overflow: 'hidden' }
          : { width: `${width}px`, flexShrink: 0, overflow: 'hidden' }
      }
    >
      <Box
        alignItems="Center"
        justifyContent="SpaceBetween"
        style={{
          padding: `${config.space.S200} ${config.space.S300}`,
          borderBottom: '1px solid var(--bg-surface-border)',
          flexShrink: 0,
        }}
      >
        <Box alignItems="Center" gap="200">
          {selectedThreadId && (
            <IconButton fill="None" size="300" onClick={() => setSelectedThreadId(null)} aria-label="Back to thread list">
              <Icon size="200" src={Icons.ArrowLeft} />
            </IconButton>
          )}
          <Text size="H5" as="h2">{selectedThreadId ? 'Thread' : 'Threads'}</Text>
        </Box>
        {onToggleFullWidth && (
          <IconButton
            fill="None"
            size="300"
            onClick={onToggleFullWidth}
            aria-label={isFullWidth ? 'Side by side' : 'Full width'}
          >
            <Icon size="200" src={isFullWidth ? Icons.ArrowGoRight : Icons.ArrowGoLeft} />
          </IconButton>
        )}
        <IconButton fill="None" size="300" onClick={onClose} aria-label="Close threads panel">
          <Icon size="200" src={Icons.Cross} />
        </IconButton>
      </Box>

      {selectedThreadId ? (
        <Box grow="Yes" direction="Column" style={{ overflow: 'hidden' }}>
          <ThreadView room={room} threadRootId={selectedThreadId} />
        </Box>
      ) : (
        <div
          style={{ flex: 1, overflowY: 'auto' }}
          onKeyDown={handleThreadListKeyDown}
          onFocus={(evt) => {
            const threadId = (evt.target as HTMLElement).getAttribute('data-thread-id');
            if (threadId) setFocusedThreadId(threadId);
          }}
        >
          {loading ? (
            <Box style={{ padding: config.space.S400 }} justifyContent="Center" alignItems="Center" gap="300">
              <Spinner size="300" variant="Secondary" />
              <Text size="T300" priority="300">Loading threads…</Text>
            </Box>
          ) : threads.length === 0 ? (
            <Box style={{ padding: config.space.S400 }} justifyContent="Center">
              <Text size="T300" priority="300">
                No threads in this room yet
              </Text>
            </Box>
          ) : (
            threads.map((entry, idx) => (
              <ThreadItem
                key={entry.id}
                entry={entry}
                room={room}
                onClick={() => setSelectedThreadId(entry.id)}
                tabIndex={
                  focusedThreadId
                    ? entry.id === focusedThreadId ? 0 : -1
                    : idx === 0 ? 0 : -1
                }
              />
            ))
          )}
        </div>
      )}
    </Box>
  );
}
