import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Room, MatrixEvent, RoomEvent, ThreadEvent, RelationType } from 'matrix-js-sdk';
import {
  Box,
  Text,
  Icon,
  Icons,
  IconButton,
  Input,
  Button,
  config,
  toRem,
  Line,
} from 'folds';
import { atom, useAtom } from 'jotai';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';

// Global atom — set this to a thread root event ID to open that thread in the drawer.
// Anything (timeline, issue board, etc.) can import and set this atom.
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

type ThreadItemProps = {
  rootEvent: MatrixEvent;
  replyCount: number;
  room: Room;
  onClick: () => void;
};
function ThreadItem({ rootEvent, replyCount, room, onClick }: ThreadItemProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const senderId = rootEvent.getSender() ?? '';
  const displayName = getDisplayName(senderId, room);
  const member = room.getMember(senderId);
  const mxcUrl = member?.getMxcAvatarUrl();
  const avatarUrl = mxcUrl
    ? mxcUrlToHttp(mx, mxcUrl, useAuthentication, 28, 28, 'crop') ?? undefined
    : undefined;
  const body = rootEvent.getContent().body ?? '[message]';

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: `${config.space.S200} ${config.space.S300}`,
        cursor: 'pointer',
        background: 'none',
        border: 'none',
        borderBottom: '1px solid var(--bg-surface-border)',
      }}
    >
      <Box gap="200" alignItems="Center" style={{ marginBottom: config.space.S100 }}>
        <AvatarCircle displayName={displayName} avatarUrl={avatarUrl} />
        <Text size="T300" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayName}
        </Text>
        <Text size="T200" priority="300" style={{ flexShrink: 0 }}>
          {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
        </Text>
      </Box>
      <Text
        size="T300"
        priority="300"
        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', paddingLeft: toRem(36) }}
      >
        {body}
      </Text>
    </button>
  );
}

type ThreadDetailProps = {
  threadRootId: string;
  room: Room;
  onBack: () => void;
};
function ThreadDetail({ threadRootId, room, onBack }: ThreadDetailProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const thread = room.getThread(threadRootId);
  const rootEvent = room.findEventById(threadRootId);

  const [events, setEvents] = useState<MatrixEvent[]>(() => thread?.events ?? []);

  useEffect(() => {
    const update = () => {
      const t = room.getThread(threadRootId);
      setEvents([...(t?.events ?? [])]);
    };
    mx.on(RoomEvent.Timeline as any, update);
    return () => { mx.off(RoomEvent.Timeline as any, update); };
  }, [mx, room, threadRootId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  const handleSend = useCallback(async () => {
    const text = replyText.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await mx.sendMessage(room.roomId, {
        msgtype: 'm.text',
        body: text,
        'm.relates_to': {
          rel_type: RelationType.Thread,
          event_id: threadRootId,
          'm.in_reply_to': { event_id: threadRootId },
          is_falling_back: false,
        },
      } as any);
      setReplyText('');
    } catch (e) {
      console.error('Failed to send thread reply', e);
    } finally {
      setSending(false);
    }
  }, [mx, room.roomId, threadRootId, replyText, sending]);

  const allEvents: MatrixEvent[] = rootEvent ? [rootEvent, ...events] : events;

  return (
    <Box direction="Column" style={{ flex: 1, overflow: 'hidden' }}>
      <Box
        alignItems="Center"
        gap="200"
        style={{
          padding: `${config.space.S200} ${config.space.S300}`,
          borderBottom: '1px solid var(--bg-surface-border)',
          flexShrink: 0,
        }}
      >
        <IconButton fill="None" size="300" onClick={onBack} aria-label="Back to thread list">
          <Icon size="200" src={Icons.ArrowLeft} />
        </IconButton>
        <Text size="H5">Thread</Text>
      </Box>
      <div style={{ flex: 1, overflowY: 'auto', padding: config.space.S200 }}>
        {allEvents.map((evt) => {
          const senderId = evt.getSender() ?? '';
          const displayName = getDisplayName(senderId, room);
          const member = room.getMember(senderId);
          const mxcUrl = member?.getMxcAvatarUrl();
          const avatarUrl = mxcUrl
            ? mxcUrlToHttp(mx, mxcUrl, useAuthentication, 28, 28, 'crop') ?? undefined
            : undefined;
          const body = evt.getContent().body ?? '[message]';
          const isRoot = evt.getId() === threadRootId;
          return (
            <Box
              key={evt.getId()}
              gap="200"
              style={{
                padding: `${config.space.S100} 0`,
                borderBottom: isRoot ? '1px solid var(--bg-surface-border)' : undefined,
                marginBottom: isRoot ? config.space.S100 : undefined,
              }}
            >
              <AvatarCircle displayName={displayName} avatarUrl={avatarUrl} />
              <Box direction="Column" gap="100" style={{ flex: 1, minWidth: 0 }}>
                <Text size="T300" style={{ fontWeight: 600 }}>
                  {displayName}
                </Text>
                <Text size="T300" style={{ wordBreak: 'break-word' }}>
                  {body}
                </Text>
              </Box>
            </Box>
          );
        })}
        <div ref={endRef} />
      </div>
      <Box
        direction="Column"
        gap="200"
        style={{
          padding: config.space.S200,
          borderTop: '1px solid var(--bg-surface-border)',
          flexShrink: 0,
        }}
      >
        <Input
          variant="Background"
          size="400"
          outlined
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Reply in thread…"
          aria-label="Reply in thread"
          disabled={sending}
        />
        <Button
          variant="Primary"
          size="300"
          onClick={handleSend}
          disabled={sending || !replyText.trim()}
        >
          <Text as="span" size="B300">
            Reply
          </Text>
        </Button>
      </Box>
    </Box>
  );
}

type ThreadsDrawerProps = {
  room: Room;
  onClose: () => void;
};

export function ThreadsDrawer({ room, onClose }: ThreadsDrawerProps) {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [openThreadId, setOpenThreadId] = useAtom(openThreadIdAtom);
  const mx = useMatrixClient();

  const getThreads = useCallback(() => {
    const threads = room.getThreads();
    // Sort by most recent activity (last event timestamp desc)
    return [...threads].sort((a, b) => {
      const aTs = a.events[a.events.length - 1]?.getTs() ?? a.rootEvent?.getTs() ?? 0;
      const bTs = b.events[b.events.length - 1]?.getTs() ?? b.rootEvent?.getTs() ?? 0;
      return bTs - aTs;
    });
  }, [room]);

  const [threads, setThreads] = useState(getThreads);
  const [loading, setLoading] = useState(true);

  // Fetch all historical threads on mount.
  // room.getThreads() only returns threads already in memory.
  // fetchRoomThreads() silently no-ops unless threadsTimelineSets is
  // already initialised — so we must call createThreadsTimelineSets() first.
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
        setLoading(false);
      });
  }, [room, getThreads]);

  // Keep list updated as new threads arrive or get replies
  useEffect(() => {
    const update = () => setThreads(getThreads());
    room.on(ThreadEvent.New as any, update);
    room.on(ThreadEvent.NewReply as any, update);
    return () => {
      room.off(ThreadEvent.New as any, update);
      room.off(ThreadEvent.NewReply as any, update);
    };
  }, [room, getThreads]);

  // Open a specific thread when requested via atom (inline support)
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
        width: toRem(264),
        flexShrink: 0,
        overflow: 'hidden',
        borderLeft: '1px solid var(--bg-surface-border)',
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
        <Text size="H5">Threads</Text>
        <IconButton fill="None" size="300" onClick={onClose} aria-label="Close threads panel">
          <Icon size="200" src={Icons.Cross} />
        </IconButton>
      </Box>

      {selectedThreadId ? (
        <ThreadDetail
          threadRootId={selectedThreadId}
          room={room}
          onBack={() => setSelectedThreadId(null)}
        />
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
            threads.map((thread) => {
              if (!thread.rootEvent) return null;
              return (
                <ThreadItem
                  key={thread.id}
                  rootEvent={thread.rootEvent}
                  replyCount={thread.length}
                  room={room}
                  onClick={() => setSelectedThreadId(thread.id)}
                />
              );
            })
          )}
        </div>
      )}
    </Box>
  );
}
