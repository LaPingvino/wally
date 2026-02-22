import React, { useCallback, useEffect, useState } from 'react';
import { Room, MatrixEvent, RoomEvent, ThreadEvent, RelationType } from 'matrix-js-sdk';
import {
  Box,
  Text,
  Icon,
  Icons,
  IconButton,
  config,
  toRem,
} from 'folds';
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
};
function ThreadItem({ entry, room, onClick }: ThreadItemProps) {
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
};

export function ThreadsDrawer({ room, onClose, width = 320 }: ThreadsDrawerProps) {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [openThreadId, setOpenThreadId] = useAtom(openThreadIdAtom);
  const mx = useMatrixClient();

  // Build thread list from BOTH SDK thread objects (populated after fetchRoomThreads or
  // fresh sync with threadSupport:true) AND a main-timeline scan (works with old session
  // data that predates threadSupport being enabled, or when server lacks MSC3856).
  const getThreads = useCallback((): ThreadEntry[] => {
    const sdkThreads = room.getThreads();
    if (sdkThreads.length > 0) {
      // SDK threads available — use them directly (filter out any with missing rootEvent)
      return sdkThreads
        .filter((t) => t.rootEvent != null)
        .map((t) => ({ id: t.id, rootEvent: t.rootEvent!, replyCount: t.length }))
        .sort((a, b) => b.rootEvent.getTs() - a.rootEvent.getTs());
    }

    // Fallback: scan main timeline for m.thread relations.
    // Events land here in sessions predating threadSupport:true because thread replies
    // were stored in the main timeline before the SDK started tracking them separately.
    const timeline = room.getUnfilteredTimelineSet().getLiveTimeline().getEvents();
    const replyMap = new Map<string, { latestTs: number; count: number }>();
    for (const evt of timeline) {
      if (evt.isRedacted()) continue;
      const rel = evt.getContent()['m.relates_to'] as
        | { rel_type?: string; event_id?: string }
        | undefined;
      if (rel?.rel_type === RelationType.Thread && rel.event_id) {
        const existing = replyMap.get(rel.event_id);
        const ts = evt.getTs() ?? 0;
        replyMap.set(rel.event_id, {
          latestTs: Math.max(existing?.latestTs ?? 0, ts),
          count: (existing?.count ?? 0) + 1,
        });
      }
    }

    return [...replyMap.entries()]
      .map(([rootId, { count }]) => {
        const rootEvent = room.findEventById(rootId);
        if (!rootEvent || rootEvent.isRedacted()) return null;
        return { id: rootId, rootEvent, replyCount: count } as ThreadEntry;
      })
      .filter((e): e is ThreadEntry => e !== null)
      .sort((a, b) => b.rootEvent.getTs() - a.rootEvent.getTs());
  }, [room]);

  const [threads, setThreads] = useState<ThreadEntry[]>(getThreads);
  const [loading, setLoading] = useState(true);

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
      direction="Column"
      style={{
        width: `${width}px`,
        flexShrink: 0,
        overflow: 'hidden',
      }}
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
          <Text size="H5">{selectedThreadId ? 'Thread' : 'Threads'}</Text>
        </Box>
        <IconButton fill="None" size="300" onClick={onClose} aria-label="Close threads panel">
          <Icon size="200" src={Icons.Cross} />
        </IconButton>
      </Box>

      {selectedThreadId ? (
        <Box grow="Yes" direction="Column" style={{ overflow: 'hidden' }}>
          <ThreadView room={room} threadRootId={selectedThreadId} />
        </Box>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <Box style={{ padding: config.space.S400 }} justifyContent="Center">
              <Text size="T300" priority="300">Loading threads…</Text>
            </Box>
          ) : threads.length === 0 ? (
            <Box style={{ padding: config.space.S400 }} justifyContent="Center">
              <Text size="T300" priority="300">
                No threads in this room yet
              </Text>
            </Box>
          ) : (
            threads.map((entry) => (
              <ThreadItem
                key={entry.id}
                entry={entry}
                room={room}
                onClick={() => setSelectedThreadId(entry.id)}
              />
            ))
          )}
        </div>
      )}
    </Box>
  );
}
