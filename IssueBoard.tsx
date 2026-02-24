import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import { EventTimeline, MatrixClient, MatrixEvent, RelationType, Room } from 'matrix-js-sdk';
import {
  Avatar,
  Box,
  Button,
  Dialog,
  Header,
  Icon,
  IconButton,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Scroll,
  Text,
  color,
  config,
} from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useRoomMembers } from '../../hooks/useRoomMembers';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { stopPropagation } from '../../utils/keyboard';
import { getMemberDisplayName } from '../../utils/room';
import { UserAvatar } from '../../components/user-avatar';
import { StateEvent } from '../../../types/matrix/room';

// ── Types ─────────────────────────────────────────────────────────────────────

type FieldType = 'text' | 'enum' | 'user' | 'date' | 'follow';

export interface SchemaField {
  key: string;
  type: FieldType;
  label: string;
  required?: boolean;
  values?: string[];
  kanban_group?: boolean;
}

export interface IssueSchema {
  fields: SchemaField[];
}

type IssueContent = Record<string, unknown> & { _deleted?: boolean };

// An issue entry carries the state event (for editing/deleting) plus the
// effective content to display (last non-redacted version if redacted).
type IssueEntry = { event: MatrixEvent; content: IssueContent; redacted: boolean };

type ViewMode = { type: 'kanban'; fieldKey: string } | { type: 'list' };

// ── Default schema ─────────────────────────────────────────────────────────────

export const DEFAULT_ISSUE_SCHEMA: IssueSchema = {
  fields: [
    { key: 'title', type: 'text', label: 'Title', required: true },
    {
      key: 'status',
      type: 'enum',
      label: 'Status',
      values: ['Backlog', 'To Do', 'In Progress', 'Done'],
      kanban_group: true,
    },
    {
      key: 'priority',
      type: 'enum',
      label: 'Priority',
      values: ['Low', 'Medium', 'High', 'Critical'],
    },
    { key: 'assignee', type: 'user', label: 'Assignee' },
    { key: 'due', type: 'date', label: 'Due Date' },
    { key: 'description', type: 'text', label: 'Description' },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getIssueSchema(room: Room): IssueSchema | null {
  const event = room
    .getLiveTimeline()
    .getState(EventTimeline.FORWARDS)
    ?.getStateEvents('eu.kiefte.issues.schema', '');
  if (!event) return null;
  const content = event.getContent() as { fields?: unknown };
  if (!Array.isArray(content.fields)) return null;
  return { fields: content.fields as SchemaField[] };
}

function getIssues(room: Room): IssueEntry[] {
  const stateEvents = room
    .getLiveTimeline()
    .getState(EventTimeline.FORWARDS)
    ?.getStateEvents('eu.kiefte.issue') as MatrixEvent[] | undefined;
  if (!stateEvents || stateEvents.length === 0) return [];

  const timelineEvents = room.getUnfilteredTimelineSet().getLiveTimeline().getEvents();
  const result: IssueEntry[] = [];

  for (const event of stateEvents) {
    const stateKey = event.getStateKey()!;
    if (!event.isRedacted()) {
      const content = event.getContent() as IssueContent;
      if (!content._deleted) result.push({ event, content, redacted: false });
    } else {
      // Find last non-redacted, non-deleted version in the timeline
      for (let i = timelineEvents.length - 1; i >= 0; i--) {
        const e = timelineEvents[i];
        if (
          e.getType() === 'eu.kiefte.issue' &&
          e.getStateKey() === stateKey &&
          !e.isRedacted()
        ) {
          const c = e.getContent() as IssueContent;
          if (!c._deleted) {
            result.push({ event, content: c, redacted: true });
            break;
          }
        }
      }
    }
  }
  return result;
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function formatIssueDiff(
  schema: IssueSchema,
  oldContent: IssueContent | undefined,
  newContent: IssueContent
): string {
  const titleField = schema.fields.find((f) => f.key === 'title') ?? schema.fields[0];
  const title = titleField ? ((newContent[titleField.key] as string) ?? '(untitled)') : '(untitled)';
  if (!oldContent) return '\u{1F4CB} Issue created: "' + title + '"';
  const changes = schema.fields
    .filter((f) => oldContent[f.key] !== newContent[f.key] && (oldContent[f.key] || newContent[f.key]))
    .map((f) => f.label + ': ' + ((oldContent[f.key] as string) ?? '\u2014') + ' \u2192 ' + ((newContent[f.key] as string) ?? '\u2014'));
  if (changes.length === 0) return '\u270F\uFE0F Issue updated: "' + title + '"';
  return '\u270F\uFE0F Issue updated: "' + title + '"\n' + changes.join('\n');
}

function formatDate(value: string): string {
  if (!value) return '';
  try {
    return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return value;
  }
}

function getReactionsFor(allEvents: MatrixEvent[], targetId: string): Map<string, MatrixEvent[]> {
  const result = new Map<string, MatrixEvent[]>();
  for (const e of allEvents) {
    if (e.getType() !== 'm.reaction' || e.isRedacted()) continue;
    const rel = e.getContent()['m.relates_to'] as
      | { rel_type: string; event_id: string; key: string }
      | undefined;
    if (rel?.rel_type !== 'm.annotation' || rel.event_id !== targetId) continue;
    const group = result.get(rel.key) ?? [];
    group.push(e);
    result.set(rel.key, group);
  }
  return result;
}

function compareFieldValues(a: string, b: string, field: SchemaField): number {
  if (field.type === 'enum' && field.values && field.values.length > 0) {
    const ai = field.values.indexOf(a);
    const bi = field.values.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  }
  return a.localeCompare(b);
}

function defaultKanbanField(schema: IssueSchema): string | null {
  const enumFields = schema.fields.filter((f) => f.type === 'enum');
  return (enumFields.find((f) => f.kanban_group) ?? enumFields[0])?.key ?? null;
}

function loadViewMode(roomId: string, schema: IssueSchema | null): ViewMode {
  try {
    const stored = localStorage.getItem('cinny-issue-view-' + roomId);
    if (stored === 'list') return { type: 'list' };
    if (stored?.startsWith('kanban:')) {
      const fieldKey = stored.slice(7);
      const enumFields = schema?.fields.filter((f) => f.type === 'enum') ?? [];
      if (enumFields.some((f) => f.key === fieldKey)) return { type: 'kanban', fieldKey };
    }
  } catch {
    // ignore
  }
  if (schema) {
    const preferred = defaultKanbanField(schema);
    if (preferred) return { type: 'kanban', fieldKey: preferred };
  }
  return { type: 'list' };
}

function saveViewMode(roomId: string, mode: ViewMode) {
  try {
    localStorage.setItem(
      'cinny-issue-view-' + roomId,
      mode.type === 'list' ? 'list' : 'kanban:' + mode.fieldKey
    );
  } catch {
    // ignore
  }
}

// ── Shared input style ─────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: config.space.S100 + ' ' + config.space.S200,
  borderRadius: config.radii.R300,
  border: '1px solid ' + color.SurfaceVariant.ContainerLine,
  background: color.SurfaceVariant.Container,
  color: 'inherit',
  font: 'inherit',
  boxSizing: 'border-box',
};

const inlineSelectStyle: React.CSSProperties = {
  padding: '2px ' + config.space.S200,
  borderRadius: config.radii.R300,
  border: '1px solid ' + color.Surface.ContainerLine,
  background: color.Surface.Container,
  color: 'inherit',
  font: 'inherit',
  fontSize: '0.85em',
};

// ── User display helpers ───────────────────────────────────────────────────────

function MemberDisplay({ room, userId }: { room: Room; userId: string }) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const member = room.getMember(userId);
  const mxcUrl = member?.getMxcAvatarUrl();
  const avatarUrl = mxcUrl
    ? mx.mxcUrlToHttp(mxcUrl, 24, 24, 'crop', undefined, false, useAuthentication) ?? undefined
    : undefined;
  const name = (member ? getMemberDisplayName(room, userId) : undefined) ?? userId;
  return (
    <Box gap="100" alignItems="Center">
      <Avatar size="200">
        <UserAvatar
          userId={userId}
          src={avatarUrl}
          alt={name}
          renderFallback={() => <Icon size="50" src={Icons.User} filled />}
        />
      </Avatar>
      <Text size="T200" truncate>{name}</Text>
    </Box>
  );
}

// ── UserPicker ─────────────────────────────────────────────────────────────────

function UserPicker({
  room,
  value,
  onChange,
  id,
  required,
}: {
  room: Room;
  value: string;
  onChange: (userId: string) => void;
  id?: string;
  required?: boolean;
}) {
  const mx = useMatrixClient();
  const members = useRoomMembers(mx, room.roomId);
  const joined = members
    .filter((m) => m.membership === 'join')
    .sort((a, b) =>
      (getMemberDisplayName(room, a.userId) ?? a.userId).localeCompare(
        getMemberDisplayName(room, b.userId) ?? b.userId
      )
    );
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      style={inputStyle}
    >
      <option value="">&mdash; Unassigned &mdash;</option>
      {joined.map((m) => (
        <option key={m.userId} value={m.userId}>
          {getMemberDisplayName(room, m.userId) ?? m.userId}
        </option>
      ))}
    </select>
  );
}

// ── Field value display ────────────────────────────────────────────────────────

function FieldValue({ field, value, room }: { field: SchemaField; value: unknown; room: Room }) {
  const str = value as string;
  if (!str) return null;
  if (field.type === 'user') return <MemberDisplay room={room} userId={str} />;
  if (field.type === 'date') return <Text size="T200">{formatDate(str)}</Text>;
  return <Text size="T200">{str}</Text>;
}

// ── Activity / Reactions ───────────────────────────────────────────────────────

const QUICK_REACTIONS = ['\uD83D\uDC4D', '\uD83D\uDC4E', '\u2705', '\u274C'];

function IssueActivityRow({ event, allEvents, room }: { event: MatrixEvent; allEvents: MatrixEvent[]; room: Room }) {
  const mx = useMatrixClient();
  const eventId = event.getId()!;
  const userId = mx.getUserId()!;
  const reactions = useMemo(() => getReactionsFor(allEvents, eventId), [allEvents, eventId]);

  const handleReact = async (emoji: string) => {
    const mine = reactions.get(emoji)?.find((e) => e.getSender() === userId);
    if (mine) {
      await mx.redactEvent(room.roomId, mine.getId()!);
    } else {
      await mx.sendEvent(room.roomId, 'm.reaction' as any, {
        'm.relates_to': { rel_type: 'm.annotation', event_id: eventId, key: emoji },
      });
    }
  };

  const timeStr = event.getDate()?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? '';
  const reactionEntries = [...reactions.entries()].sort((a, b) => b[1].length - a[1].length);
  const unreactedQuick = QUICK_REACTIONS.filter((e) => !reactions.has(e));

  return (
    <Box direction="Column" gap="100" style={{ paddingBottom: config.space.S200, borderBottom: '1px solid ' + color.Surface.ContainerLine }}>
      <Box gap="200" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Text size="T200" style={{ whiteSpace: 'pre-line', flexGrow: 1 }}>{event.getContent().body as string}</Text>
        <Text size="T200" priority="300" style={{ flexShrink: 0, paddingTop: '2px' }}>{timeStr}</Text>
      </Box>
      <Box gap="100" style={{ flexWrap: 'wrap' }}>
        {reactionEntries.map(([emoji, evts]) => {
          const isOwn = evts.some((e) => e.getSender() === userId);
          return (
            <button key={emoji} type="button" onClick={() => handleReact(emoji)}
              aria-label={emoji + ', ' + evts.length + (evts.length === 1 ? ' person' : ' people') + (isOwn ? ', including you' : '')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '1px 8px', borderRadius: config.radii.R300,
                border: '1px solid ' + (isOwn ? color.Primary.Main : color.Surface.ContainerLine),
                background: isOwn ? color.Primary.Container : color.Surface.Container,
                cursor: 'pointer', font: 'inherit', fontSize: '0.85em', color: 'inherit' }}>
              <span aria-hidden="true">{emoji}</span>
              <Text size="T200">{evts.length}</Text>
            </button>
          );
        })}
        {unreactedQuick.map((emoji) => (
          <button key={emoji} type="button" onClick={() => handleReact(emoji)} aria-label={'React with ' + emoji}
            style={{ display: 'inline-flex', padding: '1px 6px', borderRadius: config.radii.R300,
              border: '1px solid ' + color.Surface.ContainerLine, background: 'transparent',
              cursor: 'pointer', font: 'inherit', fontSize: '0.85em', opacity: 0.5, color: 'inherit' }}>
            {emoji}
          </button>
        ))}
      </Box>
    </Box>
  );
}

function IssueActivity({ room, issueId, defaultFolded }: { room: Room; issueId: string; defaultFolded?: boolean }) {
  const [folded, setFolded] = useState(defaultFolded ?? false);
  const [allEvents, setAllEvents] = useState<MatrixEvent[]>(() =>
    room.getUnfilteredTimelineSet().getLiveTimeline().getEvents()
  );
  useEffect(() => {
    const refresh = () => setAllEvents([...room.getUnfilteredTimelineSet().getLiveTimeline().getEvents()]);
    room.on('Room.timeline' as any, refresh);
    room.on('Room.redaction' as any, refresh);
    return () => { room.off('Room.timeline' as any, refresh); room.off('Room.redaction' as any, refresh); };
  }, [room]);

  const activityEvents = useMemo(
    () => allEvents.filter((e) => e.getType() === 'm.room.message' && !e.isRedacted() &&
      (e.getContent() as Record<string, unknown>)['eu.kiefte.issue_id'] === issueId),
    [allEvents, issueId]
  );
  if (activityEvents.length === 0) return null;
  return (
    <Box direction="Column" gap="200" style={{ padding: config.space.S300 + ' ' + config.space.S400, borderTop: '1px solid ' + color.Surface.ContainerLine }}>
      <Box alignItems="Center" style={{ justifyContent: 'space-between' }}>
        <Text size="L400">Activity ({activityEvents.length})</Text>
        <button type="button" onClick={() => setFolded((f) => !f)} aria-expanded={!folded}
          aria-label={folded ? 'Expand activity' : 'Collapse activity'}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 4px', font: 'inherit', color: 'inherit', opacity: 0.7 }}>
          {folded ? '\u25B6' : '\u25BC'}
        </button>
      </Box>
      {!folded && activityEvents.map((evt) => (
        <IssueActivityRow key={evt.getId()} event={evt} allEvents={allEvents} room={room} />
      ))}
    </Box>
  );
}

function FollowActivity({ room, patterns, label }: { room: Room; patterns: string[]; label: string }) {
  const [folded, setFolded] = useState(true);
  const [allEvents, setAllEvents] = useState<MatrixEvent[]>(() =>
    room.getUnfilteredTimelineSet().getLiveTimeline().getEvents()
  );
  useEffect(() => {
    const refresh = () => setAllEvents([...room.getUnfilteredTimelineSet().getLiveTimeline().getEvents()]);
    room.on('Room.timeline' as any, refresh);
    room.on('Room.redaction' as any, refresh);
    return () => { room.off('Room.timeline' as any, refresh); room.off('Room.redaction' as any, refresh); };
  }, [room]);

  const matchingEvents = useMemo(() => {
    if (patterns.length === 0) return [];
    const lower = patterns.map((p) => p.toLowerCase());
    return allEvents.filter((e) => {
      if (e.getType() !== 'm.room.message' || e.isRedacted()) return false;
      const content = e.getContent() as Record<string, unknown>;
      if (content['eu.kiefte.issue_id']) return false;
      const body = String(content.body ?? '').toLowerCase();
      return lower.some((p) => body.includes(p));
    });
  }, [allEvents, patterns]);

  if (matchingEvents.length === 0) return null;
  return (
    <Box direction="Column" gap="200" style={{ padding: config.space.S300 + ' ' + config.space.S400, borderTop: '1px solid ' + color.Surface.ContainerLine }}>
      <Box alignItems="Center" style={{ justifyContent: 'space-between' }}>
        <Text size="L400">{label}: {matchingEvents.length} match{matchingEvents.length !== 1 ? 'es' : ''}</Text>
        <button type="button" onClick={() => setFolded((f) => !f)} aria-expanded={!folded}
          aria-label={folded ? 'Expand matches' : 'Collapse matches'}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 4px', font: 'inherit', color: 'inherit', opacity: 0.7 }}>
          {folded ? '\u25B6' : '\u25BC'}
        </button>
      </Box>
      {!folded && matchingEvents.map((evt) => (
        <IssueActivityRow key={evt.getId()} event={evt} allEvents={allEvents} room={room} />
      ))}
    </Box>
  );
}

// ── Thread discussions ─────────────────────────────────────────────────────────

function IssueThreadView({
  room,
  threadRootId,
  onClose,
}: {
  room: Room;
  threadRootId: string;
  onClose: () => void;
}) {
  const mx = useMatrixClient();
  const [allEvents, setAllEvents] = useState<MatrixEvent[]>(() =>
    room.getUnfilteredTimelineSet().getLiveTimeline().getEvents()
  );
  useEffect(() => {
    const refresh = () => setAllEvents([...room.getUnfilteredTimelineSet().getLiveTimeline().getEvents()]);
    room.on('Room.timeline' as any, refresh);
    return () => { room.off('Room.timeline' as any, refresh); };
  }, [room]);

  const rootEvent = useMemo(
    () => allEvents.find((e) => e.getId() === threadRootId && !e.isRedacted()),
    [allEvents, threadRootId]
  );

  const threadReplies = useMemo(() => {
    const sdkThread = room.getThread(threadRootId);
    if (sdkThread) return sdkThread.events.filter((e) => !e.isRedacted());
    return allEvents.filter((e) => {
      if (e.isRedacted()) return false;
      const rel = e.getContent()['m.relates_to'] as { rel_type?: string; event_id?: string } | undefined;
      return rel?.rel_type === RelationType.Thread && rel.event_id === threadRootId;
    });
  }, [allEvents, room, threadRootId]);

  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [threadReplies.length]);

  const handleReply = async () => {
    const text = replyText.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const lastEvent = threadReplies[threadReplies.length - 1] ?? rootEvent;
      await mx.sendEvent(room.roomId, 'm.room.message' as any, {
        msgtype: 'm.text',
        body: text,
        'm.relates_to': {
          rel_type: RelationType.Thread,
          event_id: threadRootId,
          'm.in_reply_to': { event_id: lastEvent?.getId() ?? threadRootId },
          is_falling_back: false,
        },
      });
      setReplyText('');
    } finally {
      setSending(false);
    }
  };

  const displayName = (userId: string) => getMemberDisplayName(room, userId) ?? userId;
  const allMessages = [...(rootEvent ? [rootEvent] : []), ...threadReplies];

  return (
    <Box direction="Column" style={{ border: '1px solid ' + color.Surface.ContainerLine, borderRadius: config.radii.R300, overflow: 'hidden' }}>
      <Box alignItems="Center" style={{ justifyContent: 'space-between', padding: config.space.S100 + ' ' + config.space.S200, background: color.SurfaceVariant.Container, borderBottom: '1px solid ' + color.Surface.ContainerLine }}>
        <Text size="T200" priority="300">{threadReplies.length} {threadReplies.length === 1 ? 'reply' : 'replies'}</Text>
        <IconButton size="200" onClick={onClose} radii="300" aria-label="Collapse thread">
          <Icon src={Icons.Cross} size="50" />
        </IconButton>
      </Box>
      <div ref={scrollRef} style={{ maxHeight: '220px', overflowY: 'auto', padding: config.space.S200 + ' ' + config.space.S300 }}>
        {allMessages.length === 0 && (
          <Text size="T200" priority="300" style={{ display: 'block', textAlign: 'center', padding: config.space.S200 }}>
            No messages yet — start the discussion below.
          </Text>
        )}
        <Box direction="Column" gap="200">
          {allMessages.map((e) => {
            const sender = e.getSender() ?? '';
            const time = e.getDate()?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? '';
            const isRoot = e.getId() === threadRootId;
            return (
              <Box key={e.getId()} direction="Column" gap="50"
                style={{ paddingBottom: config.space.S100, borderBottom: isRoot ? '1px solid ' + color.Surface.ContainerLine : undefined }}>
                <Box gap="100" alignItems="Center">
                  <Text size="T200" style={{ fontWeight: 600 }}>{displayName(sender)}</Text>
                  <Text size="T200" priority="300">{time}</Text>
                  {isRoot && <Text size="T200" priority="300" style={{ fontStyle: 'italic' }}> · thread root</Text>}
                </Box>
                <Text size="T200" style={{ whiteSpace: 'pre-line' }}>{e.getContent().body as string}</Text>
              </Box>
            );
          })}
        </Box>
      </div>
      <Box gap="100" style={{ padding: config.space.S100 + ' ' + config.space.S200, borderTop: '1px solid ' + color.Surface.ContainerLine }}>
        <input
          type="text"
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(); } }}
          placeholder="Reply to thread…"
          aria-label="Reply to thread"
          style={{ ...inputStyle, flex: 1 }}
        />
        <Button size="300" variant="Primary" onClick={handleReply} aria-disabled={sending || !replyText.trim()}>
          <Text>{sending ? '\u2026' : 'Send'}</Text>
        </Button>
      </Box>
    </Box>
  );
}

function IssueDiscussion({
  room,
  issueId,
  initialThreads,
  issueTitle,
  onThreadAdded,
}: {
  room: Room;
  issueId: string;
  initialThreads: string[];
  issueTitle: string;
  onThreadAdded: (id: string) => void;
}) {
  const mx = useMatrixClient();
  const [threads, setThreads] = useState<string[]>(initialThreads);
  const [openThreadId, setOpenThreadId] = useState<string | null>(
    initialThreads.length > 0 ? initialThreads[initialThreads.length - 1] : null
  );
  const [starting, setStarting] = useState(false);

  const handleStartDiscussion = async () => {
    if (starting) return;
    setStarting(true);
    try {
      const body = 'Discussion: ' + (issueTitle || 'Untitled issue');
      const response = await mx.sendEvent(room.roomId, 'm.room.message' as any, {
        msgtype: 'm.text',
        body,
        'eu.kiefte.issue_id': issueId,
      }) as { event_id: string };
      const threadRootId = response.event_id;
      const newThreads = [...threads, threadRootId];
      setThreads(newThreads);
      onThreadAdded(threadRootId);
      setOpenThreadId(threadRootId);
      // Persist the thread link on the state event
      const currentStateEvent = room
        .getLiveTimeline()
        .getState(EventTimeline.FORWARDS)
        ?.getStateEvents('eu.kiefte.issue', issueId) as MatrixEvent | null | undefined;
      const currentContent = (currentStateEvent?.getContent() as IssueContent | undefined) ?? {};
      await mx.sendStateEvent(room.roomId, 'eu.kiefte.issue' as any, { ...currentContent, threads: newThreads }, issueId);
    } catch {
      // Thread root message already sent but link failed — revert optimistic update
      setThreads((prev) => prev.slice(0, -1));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Box direction="Column" gap="200" style={{ padding: config.space.S300 + ' ' + config.space.S400, borderTop: '1px solid ' + color.Surface.ContainerLine }}>
      <Box alignItems="Center" style={{ justifyContent: 'space-between' }}>
        <Text size="L400">{'\uD83D\uDCAC'} Discussions{threads.length > 0 ? ' (' + threads.length + ')' : ''}</Text>
        <Button size="300" variant="Secondary" fill="Soft" onClick={handleStartDiscussion} aria-disabled={starting}>
          <Icon src={Icons.Plus} size="100" aria-hidden="true" />
          <Text>{starting ? 'Starting\u2026' : threads.length === 0 ? 'Start Discussion' : 'Add Discussion'}</Text>
        </Button>
      </Box>
      {threads.map((threadRootId, idx) => {
        const isOpen = openThreadId === threadRootId;
        return (
          <Box key={threadRootId} direction="Column" gap="100">
            <button
              type="button"
              onClick={() => setOpenThreadId(isOpen ? null : threadRootId)}
              aria-expanded={isOpen}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: config.space.S100 + ' ' + config.space.S200,
                borderRadius: config.radii.R300,
                border: '1px solid ' + color.Surface.ContainerLine,
                background: isOpen ? color.SurfaceVariant.Container : 'transparent',
                cursor: 'pointer', font: 'inherit', color: 'inherit', width: '100%',
              }}
            >
              <Text size="T300">Thread {idx + 1}</Text>
              <Text size="T200" priority="300">{isOpen ? '\u25B2' : '\u25BC'}</Text>
            </button>
            {isOpen && (
              <IssueThreadView room={room} threadRootId={threadRootId} onClose={() => setOpenThreadId(null)} />
            )}
          </Box>
        );
      })}
    </Box>
  );
}

// ── SchemaEditor ───────────────────────────────────────────────────────────────

interface DraftField extends SchemaField { _enumRaw: string; }

function fieldToDraft(f: SchemaField): DraftField { return { ...f, _enumRaw: f.values?.join(', ') ?? '' }; }

function draftToField(d: DraftField): SchemaField {
  const { _enumRaw, ...field } = d;
  if (field.type === 'enum') {
    field.values = _enumRaw.split(',').map((v) => v.trim()).filter(Boolean);
  } else {
    delete field.values;
    delete field.kanban_group;
  }
  return field;
}

const TYPE_LABELS: Record<FieldType, string> = { text: 'Text', enum: 'Choice', user: 'User', date: 'Date', follow: 'Follow' };

export interface SchemaEditorProps {
  initial: IssueSchema;
  titleText?: string;
  onSave: (schema: IssueSchema) => Promise<void>;
  onCancel: () => void;
}

export function SchemaEditor({ initial, titleText, onSave, onCancel }: SchemaEditorProps) {
  const titleId = 'schema-editor-title';
  const [fields, setFields] = useState<DraftField[]>(() => initial.fields.map(fieldToDraft));
  const [selectedKey, setSelectedKey] = useState<string | null>(() => initial.fields[0]?.key ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = fields.find((f) => f.key === selectedKey) ?? null;

  const updateField = (key: string, patch: Partial<DraftField>) =>
    setFields((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  const removeField = (key: string) => {
    setFields((fs) => {
      const next = fs.filter((f) => f.key !== key);
      if (selectedKey === key) setSelectedKey(next[0]?.key ?? null);
      return next;
    });
  };

  const addField = () => {
    const newKey = generateId();
    setFields((fs) => [...fs, { key: newKey, type: 'text', label: '', _enumRaw: '' }]);
    setSelectedKey(newKey);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalFields = fields.map(draftToField);
    setSaving(true);
    setError(null);
    try {
      await onSave({ fields: finalFields });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save schema');
      setSaving(false);
    }
  };

  return (
    <Dialog role="dialog" aria-modal="true" aria-labelledby={titleId} variant="Surface" style={{ width: '90vw', maxWidth: '680px' }}>
      <Header style={{ padding: '0 ' + config.space.S200 + ' 0 ' + config.space.S400, borderBottomWidth: config.borderWidth.B300 }} variant="Surface" size="500">
        <Box grow="Yes"><Text id={titleId} size="H4">{titleText ?? 'Configure Issue Tracker'}</Text></Box>
        <IconButton size="300" onClick={onCancel} radii="300" aria-label="Close"><Icon src={Icons.Cross} /></IconButton>
      </Header>

      <form id="schema-editor-form" onSubmit={handleSave}>
        <Box style={{ minHeight: '320px', maxHeight: '60vh' }}>
          {/* Left: field list */}
          <Box direction="Column" style={{ width: '200px', flexShrink: 0, borderRight: '1px solid ' + color.Surface.ContainerLine, overflow: 'auto' }}>
            <Box direction="Column" gap="100" style={{ padding: config.space.S200, flexGrow: 1 }}>
              {fields.map((field, idx) => (
                <button key={field.key} type="button" onClick={() => setSelectedKey(field.key)}
                  aria-pressed={selectedKey === field.key}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px',
                    padding: config.space.S100 + ' ' + config.space.S200, borderRadius: config.radii.R300,
                    border: '1px solid ' + (selectedKey === field.key ? color.Primary.Main : 'transparent'),
                    background: selectedKey === field.key ? color.Primary.Container : 'transparent',
                    cursor: 'pointer', textAlign: 'left', width: '100%', font: 'inherit', color: 'inherit' }}>
                  <Text size="T300" truncate style={{ width: '100%' }}>{field.label || ('Field ' + (idx + 1))}</Text>
                  <Text size="T200" priority="300">{TYPE_LABELS[field.type] ?? field.type}</Text>
                </button>
              ))}
            </Box>
            <Box style={{ padding: config.space.S200, borderTop: '1px solid ' + color.Surface.ContainerLine }}>
              <Button type="button" variant="Secondary" fill="Soft" size="300" onClick={addField} style={{ width: '100%' }}>
                <Icon src={Icons.Plus} size="100" aria-hidden="true" /><Text>Add Field</Text>
              </Button>
            </Box>
          </Box>

          {/* Right: field editor */}
          <Box grow="Yes" direction="Column" style={{ overflow: 'auto' }}>
            {selected ? (
              <Box direction="Column" gap="300" style={{ padding: config.space.S400 }}>
                <Box gap="200">
                  <Box direction="Column" gap="100" style={{ flex: 1 }}>
                    <label htmlFor={'sf-label-' + selected.key}><Text size="T200">Label</Text></label>
                    <input id={'sf-label-' + selected.key} type="text" required value={selected.label}
                      onChange={(e) => updateField(selected.key, { label: e.target.value })}
                      style={inputStyle} placeholder="e.g. Status" />
                  </Box>
                  <Box direction="Column" gap="100" style={{ flexShrink: 0, width: '120px' }}>
                    <label htmlFor={'sf-type-' + selected.key}><Text size="T200">Type</Text></label>
                    <select id={'sf-type-' + selected.key} value={selected.type}
                      onChange={(e) => updateField(selected.key, { type: e.target.value as FieldType })}
                      style={inputStyle}>
                      <option value="text">Text</option>
                      <option value="enum">Choice</option>
                      <option value="user">User</option>
                      <option value="date">Date</option>
                      <option value="follow">Follow</option>
                    </select>
                  </Box>
                </Box>

                <Box alignItems="Center" gap="100">
                  <input id={'sf-req-' + selected.key} type="checkbox" checked={!!selected.required}
                    onChange={(e) => updateField(selected.key, { required: e.target.checked || undefined })} />
                  <label htmlFor={'sf-req-' + selected.key}><Text size="T200">Required</Text></label>
                </Box>

                {selected.type === 'follow' && (
                  <Box direction="Column" gap="100">
                    <Text size="T200">Follow fields watch room messages for keywords (entered per issue) and list matches inline alongside Activity.</Text>
                    <Text size="T200" priority="300">Users enter comma-separated keywords in each issue&apos;s field value.</Text>
                  </Box>
                )}

                {selected.type === 'enum' && (
                  <Box direction="Column" gap="100">
                    <label htmlFor={'sf-vals-' + selected.key}><Text size="T200">Choices (comma-separated)</Text></label>
                    <input id={'sf-vals-' + selected.key} type="text" value={selected._enumRaw}
                      onChange={(e) => updateField(selected.key, { _enumRaw: e.target.value })}
                      style={inputStyle} placeholder="e.g. Backlog, To Do, In Progress, Done" />
                    <Box alignItems="Center" gap="100">
                      <input id={'sf-kanban-' + selected.key} type="checkbox" checked={!!selected.kanban_group}
                        onChange={(e) => updateField(selected.key, { kanban_group: e.target.checked ? true : undefined })} />
                      <label htmlFor={'sf-kanban-' + selected.key}><Text size="T200">Default kanban grouping field</Text></label>
                    </Box>
                  </Box>
                )}

                <Box style={{ marginTop: 'auto', paddingTop: config.space.S200 }}>
                  <Button type="button" variant="Critical" fill="Soft" size="300"
                    onClick={() => removeField(selected.key)} aria-label={'Remove field: ' + (selected.label || 'this field')}>
                    <Icon src={Icons.Delete} size="100" aria-hidden="true" /><Text>Remove Field</Text>
                  </Button>
                </Box>
              </Box>
            ) : (
              <Box direction="Column" alignItems="Center" justifyContent="Center" grow="Yes" gap="200" style={{ padding: config.space.S400, opacity: 0.5 }}>
                <Icon src={Icons.Plus} size="400" aria-hidden="true" />
                <Text size="T300">Add a field or select one to edit</Text>
              </Box>
            )}
          </Box>
        </Box>
      </form>

      <Box gap="200" style={{ padding: config.space.S300, borderTop: '1px solid ' + color.Surface.ContainerLine, justifyContent: 'flex-end' }}>
        {error && <Text size="T300" style={{ color: color.Critical.Main, flexGrow: 1 }}>{error}</Text>}
        <Button type="button" variant="Secondary" fill="Soft" size="300" onClick={onCancel}><Text>Cancel</Text></Button>
        <Button type="submit" form="schema-editor-form" variant="Primary" size="300" aria-disabled={saving}>
          <Text>{saving ? 'Saving\u2026' : 'Save Schema'}</Text>
        </Button>
      </Box>
    </Dialog>
  );
}

// ── IssueForm ─────────────────────────────────────────────────────────────────

interface IssueFormProps {
  schema: IssueSchema;
  initial?: IssueContent;
  room: Room;
  issueId?: string;
  onSave: (content: IssueContent) => Promise<void>;
  onCancel: () => void;
  canDelete?: boolean;
  onDelete?: () => Promise<void>;
}

function IssueForm({ schema, initial, room, issueId, onSave, onCancel, canDelete, onDelete }: IssueFormProps) {
  const titleId = 'issue-form-title';
  const [values, setValues] = useState<IssueContent>(() => ({ ...initial }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: string, value: unknown) => setValues((v) => ({ ...v, [key]: value }));

  const handleThreadAdded = useCallback((threadRootId: string) => {
    setValues((v) => ({
      ...v,
      threads: [...((v.threads as string[] | undefined) ?? []), threadRootId],
    }));
  }, []);

  const titleField = schema.fields.find((f) => f.key === 'title') ?? schema.fields[0];
  const issueTitle = titleField ? String(values[titleField.key] ?? '') : '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setSaving(true);
    try { await onDelete(); } catch { setSaving(false); }
  };

  return (
    <Dialog role="dialog" aria-modal="true" aria-labelledby={titleId} variant="Surface" style={{ width: '90vw', maxWidth: '520px' }}>
      <Header style={{ padding: '0 ' + config.space.S200 + ' 0 ' + config.space.S400, borderBottomWidth: config.borderWidth.B300 }} variant="Surface" size="500">
        <Box grow="Yes"><Text id={titleId} size="H4">{issueId ? 'Edit Issue' : 'New Issue'}</Text></Box>
        <IconButton size="300" onClick={onCancel} radii="300" aria-label="Close"><Icon src={Icons.Cross} /></IconButton>
      </Header>

      <Scroll style={{ maxHeight: '70vh' }}>
        <form id="issue-form" onSubmit={handleSubmit}>
          <Box direction="Column" gap="300" style={{ padding: config.space.S400 }}>
            {schema.fields.map((field) => (
              <Box key={field.key} direction="Column" gap="100">
                <label htmlFor={'issue-field-' + field.key}>
                  <Text size="T200">{field.label}{field.required && ' *'}</Text>
                </label>
                {field.type === 'enum' ? (
                  <select id={'issue-field-' + field.key}
                    value={(values[field.key] as string) ?? ''}
                    onChange={(e) => set(field.key, e.target.value)} required={field.required} style={inputStyle}>
                    <option value="">&mdash; Select &mdash;</option>
                    {field.values?.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                ) : field.type === 'user' ? (
                  <UserPicker room={room} id={'issue-field-' + field.key}
                    value={(values[field.key] as string) ?? ''}
                    onChange={(uid) => set(field.key, uid)} required={field.required} />
                ) : field.type === 'date' ? (
                  <input id={'issue-field-' + field.key} type="date"
                    value={(values[field.key] as string) ?? ''}
                    onChange={(e) => set(field.key, e.target.value)} required={field.required} style={inputStyle} />
                ) : field.type === 'follow' ? (
                  <input id={'issue-field-' + field.key} type="text"
                    value={(values[field.key] as string) ?? ''}
                    onChange={(e) => set(field.key, e.target.value)} style={inputStyle}
                    placeholder="Keywords to watch (comma-separated)" />
                ) : (
                  <input id={'issue-field-' + field.key} type="text"
                    value={(values[field.key] as string) ?? ''}
                    onChange={(e) => set(field.key, e.target.value)} required={field.required} style={inputStyle} />
                )}
              </Box>
            ))}
            {error && <Text size="T300" style={{ color: color.Critical.Main }}>{error}</Text>}
          </Box>
        </form>
        {issueId && <IssueActivity room={room} issueId={issueId} />}
        {issueId && (
          <IssueDiscussion
            room={room}
            issueId={issueId}
            initialThreads={(values.threads as string[] | undefined) ?? []}
            issueTitle={issueTitle}
            onThreadAdded={handleThreadAdded}
          />
        )}
        {issueId && schema.fields.filter((f) => f.type === 'follow').map((f) => {
          const pats = String(values[f.key] ?? '').split(',').map((p) => p.trim()).filter(Boolean);
          return pats.length > 0 ? <FollowActivity key={f.key} label={f.label} room={room} patterns={pats} /> : null;
        })}
      </Scroll>

      <Box gap="200" style={{ padding: config.space.S300, borderTop: '1px solid ' + color.Surface.ContainerLine, justifyContent: 'flex-end' }}>
        {canDelete && onDelete && (
          <Button type="button" variant="Critical" fill="Soft" size="300" onClick={handleDelete} aria-disabled={saving}>
            <Text>Delete</Text>
          </Button>
        )}
        <Button type="button" variant="Secondary" fill="Soft" size="300" onClick={onCancel}><Text>Cancel</Text></Button>
        <Button type="submit" form="issue-form" variant="Primary" size="300" aria-disabled={saving}>
          <Text>{saving ? 'Saving\u2026' : 'Save'}</Text>
        </Button>
      </Box>
    </Dialog>
  );
}

// ── IssueCard (kanban) ─────────────────────────────────────────────────────────

function IssueCard({ entry, schema, room, kanbanFieldKey, canWrite, onClick, isSelected, onToggleSelect, showCheckbox }: {
  entry: IssueEntry; schema: IssueSchema; room: Room; kanbanFieldKey: string; canWrite: boolean; onClick: () => void;
  isSelected?: boolean; onToggleSelect?: () => void; showCheckbox?: boolean;
}) {
  const { content, redacted } = entry;
  const titleField = schema.fields.find((f) => f.key === 'title') ?? schema.fields[0];
  const title = titleField ? ((content[titleField.key] as string) ?? '(untitled)') : '(untitled)';
  const secondaryFields = schema.fields.filter((f) => f.key !== titleField?.key && f.key !== kanbanFieldKey && content[f.key]);
  const threadCount = ((content.threads as string[] | undefined) ?? []).length;

  return (
    <div style={{ position: 'relative' }}>
      {showCheckbox && (
        <input
          type="checkbox"
          checked={!!isSelected}
          onChange={() => onToggleSelect?.()}
          onClick={(e) => e.stopPropagation()}
          aria-label={'Select: ' + title}
          style={{ position: 'absolute', top: '10px', left: '10px', zIndex: 1, cursor: 'pointer' }}
        />
      )}
      <button type="button"
        onClick={showCheckbox ? () => onToggleSelect?.() : (canWrite ? onClick : undefined)}
        aria-label={showCheckbox ? (isSelected ? 'Deselect: ' : 'Select: ') + title : (canWrite ? title + ' \u2014 click to edit' : title)}
        aria-pressed={showCheckbox ? isSelected : undefined}
        disabled={!showCheckbox && !canWrite}
        style={{ padding: config.space.S200, paddingLeft: showCheckbox ? '28px' : config.space.S200,
          background: isSelected ? color.Primary.Container : color.Surface.Container,
          border: '1px solid ' + (isSelected ? color.Primary.Main : redacted ? color.Warning.Main : color.Surface.ContainerLine),
          borderRadius: config.radii.R300, textAlign: 'left', cursor: canWrite || showCheckbox ? 'pointer' : 'default',
          width: '100%', display: 'flex', flexDirection: 'column', gap: config.space.S100 }}>
        <Box alignItems="Center" gap="100" style={{ justifyContent: 'space-between' }}>
          <Text size="T300" truncate>{title}</Text>
          <Box gap="100" alignItems="Center">
            {threadCount > 0 && <Text size="T200" priority="300" style={{ flexShrink: 0 }}>{'\uD83D\uDCAC'} {threadCount}</Text>}
            {redacted && <Text size="T200" style={{ color: color.Warning.Main, flexShrink: 0 }} title="Current state redacted">⚠️</Text>}
          </Box>
        </Box>
        {secondaryFields.map((f) => (
          <Box key={f.key} gap="100" alignItems="Center">
            <Text size="T200" priority="300">{f.label}:</Text>
            <FieldValue field={f} value={content[f.key]} room={room} />
          </Box>
        ))}
      </button>
    </div>
  );
}

// ── IssueListItem (list view) ─────────────────────────────────────────────────

function IssueListItem({ entry, schema, room, canWrite, onEdit, isSelected, onToggleSelect, showCheckbox }: {
  entry: IssueEntry; schema: IssueSchema; room: Room; canWrite: boolean; onEdit: () => void;
  isSelected?: boolean; onToggleSelect?: () => void; showCheckbox?: boolean;
}) {
  const { content, redacted } = entry;
  const titleField = schema.fields.find((f) => f.key === 'title') ?? schema.fields[0];
  const title = titleField ? ((content[titleField.key] as string) ?? '(untitled)') : '(untitled)';
  const otherFields = schema.fields.filter((f) => f !== titleField);
  const threadCount = ((content.threads as string[] | undefined) ?? []).length;

  return (
    <Box direction="Column" gap="200"
      style={{ border: '1px solid ' + (isSelected ? color.Primary.Main : redacted ? color.Warning.Main : color.Surface.ContainerLine),
        borderRadius: config.radii.R300, background: isSelected ? color.Primary.Container : color.Surface.Container }}>
      <Box alignItems="Center" gap="200" style={{ justifyContent: 'space-between', padding: config.space.S300 + ' ' + config.space.S300 + ' 0' }}>
        <Box alignItems="Center" gap="100">
          {showCheckbox && (
            <input
              type="checkbox"
              checked={!!isSelected}
              onChange={() => onToggleSelect?.()}
              aria-label={'Select: ' + title}
              style={{ cursor: 'pointer', flexShrink: 0 }}
            />
          )}
          {redacted && <Text size="T200" style={{ color: color.Warning.Main }} title="Current state redacted — showing last known version">⚠️</Text>}
          <Text size="T300" as="h3" style={{ margin: 0, fontWeight: 'bold' }}>{title}</Text>
          {threadCount > 0 && <Text size="T200" priority="300">{'\uD83D\uDCAC'} {threadCount}</Text>}
        </Box>
        {canWrite && !showCheckbox && (
          <Button size="300" variant="Secondary" fill="Soft" onClick={onEdit} aria-label={'Edit issue: ' + title}>
            <Icon src={Icons.Pencil} size="100" aria-hidden="true" /><Text>Edit</Text>
          </Button>
        )}
      </Box>
      {otherFields.filter((f) => content[f.key]).length > 0 && (
        <Box gap="300" style={{ flexWrap: 'wrap', padding: '0 ' + config.space.S300 }}>
          {otherFields.filter((f) => content[f.key]).map((f) => (
            <Box key={f.key} gap="100" alignItems="Center">
              <Text size="T200" priority="300">{f.label}:</Text>
              <FieldValue field={f} value={content[f.key]} room={room} />
            </Box>
          ))}
        </Box>
      )}
      <IssueActivity room={room} issueId={entry.event.getStateKey()!} defaultFolded />
      {schema.fields.filter((f) => f.type === 'follow').map((f) => {
        const pats = String(content[f.key] ?? '').split(',').map((p) => p.trim()).filter(Boolean);
        return pats.length > 0 ? <FollowActivity key={f.key} label={f.label} room={room} patterns={pats} /> : null;
      })}
    </Box>
  );
}

// ── Move issue helpers ─────────────────────────────────────────────────────────

function canUserWriteIssuesInRoom(mx: MatrixClient, r: Room): boolean {
  const userId = mx.getUserId()!;
  const myPL = r.getMember(userId)?.powerLevel ?? 0;
  const plEvent = r.getLiveTimeline().getState(EventTimeline.FORWARDS)
    ?.getStateEvents('m.room.power_levels', '');
  const stateDefault =
    ((plEvent?.getContent() as Record<string, unknown>)?.state_default as number) ?? 50;
  return myPL >= stateDefault;
}

function buildDefaultFieldMapping(source: IssueSchema, target: IssueSchema): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const sf of source.fields) {
    const byKey = target.fields.find((tf) => tf.key === sf.key && tf.type === sf.type);
    if (byKey) { map.set(sf.key, byKey.key); continue; }
    const byLabel = target.fields.find(
      (tf) => tf.label.toLowerCase() === sf.label.toLowerCase() && tf.type === sf.type
    );
    map.set(sf.key, byLabel ? byLabel.key : null);
  }
  return map;
}

// ── MoveIssueDialog ────────────────────────────────────────────────────────────

type MoveStep = 'pick-room' | 'map-fields';

function MoveIssueDialog({
  sourceRoom,
  sourceSchema,
  issuesToMove,
  onClose,
  onMoved,
}: {
  sourceRoom: Room;
  sourceSchema: IssueSchema;
  issuesToMove: IssueEntry[];
  onClose: () => void;
  onMoved: () => void;
}) {
  const mx = useMatrixClient();
  const titleId = 'move-issue-dialog-title';
  const [step, setStep] = useState<MoveStep>('pick-room');
  const [targetRoom, setTargetRoom] = useState<Room | null>(null);
  const [targetSchema, setTargetSchema] = useState<IssueSchema | null>(null);
  const [fieldMapping, setFieldMapping] = useState<Map<string, string | null>>(new Map());
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidateRooms = useMemo(
    () =>
      mx.getRooms().filter((r) => {
        if (r.roomId === sourceRoom.roomId) return false;
        if (!getIssueSchema(r)) return false;
        return canUserWriteIssuesInRoom(mx, r);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mx, sourceRoom.roomId]
  );

  const handlePickRoom = (room: Room) => {
    const schema = getIssueSchema(room)!;
    setTargetRoom(room);
    setTargetSchema(schema);
    setFieldMapping(buildDefaultFieldMapping(sourceSchema, schema));
    setStep('map-fields');
  };

  const handleMove = async () => {
    if (!targetRoom || !targetSchema) return;
    setMoving(true);
    setError(null);
    try {
      // Merge enum values into target schema if needed
      let updatedSchema = { ...targetSchema, fields: targetSchema.fields.map((f) => ({ ...f })) };
      let schemaChanged = false;
      for (const sf of sourceSchema.fields) {
        if (sf.type !== 'enum' || !sf.values) continue;
        const targetKey = fieldMapping.get(sf.key);
        if (!targetKey) continue;
        const tf = updatedSchema.fields.find((f) => f.key === targetKey);
        if (!tf || tf.type !== 'enum') continue;
        const existing = tf.values ?? [];
        const newVals = sf.values.filter((v) => !existing.includes(v));
        if (newVals.length > 0) {
          tf.values = [...existing, ...newVals];
          schemaChanged = true;
        }
      }
      if (schemaChanged) {
        await mx.sendStateEvent(targetRoom.roomId, 'eu.kiefte.issues.schema' as any, updatedSchema, '');
      }

      // Copy issues to target room
      const titleField = sourceSchema.fields.find((f) => f.key === 'title') ?? sourceSchema.fields[0];
      for (const entry of issuesToMove) {
        const newContent: IssueContent = {};
        for (const sf of sourceSchema.fields) {
          const targetKey = fieldMapping.get(sf.key);
          if (targetKey && entry.content[sf.key] !== undefined) {
            newContent[targetKey] = entry.content[sf.key];
          }
        }
        const newId = generateId();
        await mx.sendStateEvent(targetRoom.roomId, 'eu.kiefte.issue' as any, newContent, newId);
        const issueTitle = titleField ? ((newContent[titleField.key] as string) ?? '(untitled)') : '(untitled)';
        try {
          await mx.sendEvent(targetRoom.roomId, 'm.room.message' as any, {
            msgtype: 'm.notice',
            body: '\uD83D\uDCCB Issue moved from ' + (sourceRoom.name ?? sourceRoom.roomId) + ': "' + issueTitle + '"',
            'eu.kiefte.issue_id': newId,
          });
        } catch { /* non-critical */ }
      }

      // Mark originals as deleted
      for (const entry of issuesToMove) {
        const stateKey = entry.event.getStateKey()!;
        await mx.sendStateEvent(sourceRoom.roomId, 'eu.kiefte.issue' as any, { ...entry.content, _deleted: true }, stateKey);
      }

      // Tombstone notice in source room
      const count = issuesToMove.length;
      const targetName = targetRoom.name ?? targetRoom.roomId;
      try {
        await mx.sendEvent(sourceRoom.roomId, 'm.room.message' as any, {
          msgtype: 'm.notice',
          body: '\uD83D\uDCE6 ' + count + ' issue' + (count !== 1 ? 's' : '') + ' moved to ' + targetName,
        });
      } catch { /* non-critical */ }

      onMoved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Move failed');
      setMoving(false);
    }
  };

  if (step === 'pick-room') {
    return (
      <Dialog role="dialog" aria-modal="true" aria-labelledby={titleId} variant="Surface" style={{ width: '90vw', maxWidth: '480px' }}>
        <Header style={{ padding: '0 ' + config.space.S200 + ' 0 ' + config.space.S400, borderBottomWidth: config.borderWidth.B300 }} variant="Surface" size="500">
          <Box grow="Yes">
            <Text id={titleId} size="H4">
              {'Move ' + issuesToMove.length + ' Issue' + (issuesToMove.length !== 1 ? 's' : '') + ' To\u2026'}
            </Text>
          </Box>
          <IconButton size="300" onClick={onClose} radii="300" aria-label="Close"><Icon src={Icons.Cross} /></IconButton>
        </Header>
        <Scroll style={{ maxHeight: '60vh' }}>
          {candidateRooms.length === 0 ? (
            <Box direction="Column" alignItems="Center" justifyContent="Center" gap="200" style={{ padding: config.space.S500, opacity: 0.7 }}>
              <Text size="T300">No rooms with an issue tracker found where you have write access.</Text>
            </Box>
          ) : (
            <Box direction="Column" gap="100" style={{ padding: config.space.S200 }}>
              {candidateRooms.map((r) => {
                const rSchema = getIssueSchema(r)!;
                const allMatch = sourceSchema.fields.every((sf) =>
                  rSchema.fields.some(
                    (tf) => tf.type === sf.type && (tf.key === sf.key || tf.label.toLowerCase() === sf.label.toLowerCase())
                  )
                );
                return (
                  <button
                    key={r.roomId}
                    type="button"
                    onClick={() => handlePickRoom(r)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: config.space.S200,
                      padding: config.space.S200 + ' ' + config.space.S300,
                      borderRadius: config.radii.R300,
                      border: '1px solid ' + color.Surface.ContainerLine,
                      background: color.Surface.Container,
                      cursor: 'pointer', font: 'inherit', color: 'inherit', textAlign: 'left', width: '100%',
                    }}
                  >
                    <Box direction="Column" style={{ flexGrow: 1 }}>
                      <Text size="T300">{r.name ?? r.roomId}</Text>
                      <Text size="T200" priority="300">{rSchema.fields.length + ' fields'}</Text>
                    </Box>
                    <Text size="T200" style={{ color: allMatch ? color.Primary.Main : color.Warning.Main, flexShrink: 0 }}>
                      {allMatch ? '\u2713 Compatible' : '\u26A0 Partial match'}
                    </Text>
                  </button>
                );
              })}
            </Box>
          )}
        </Scroll>
        <Box gap="200" style={{ padding: config.space.S300, borderTop: '1px solid ' + color.Surface.ContainerLine, justifyContent: 'flex-end' }}>
          <Button type="button" variant="Secondary" fill="Soft" size="300" onClick={onClose}><Text>Cancel</Text></Button>
        </Box>
      </Dialog>
    );
  }

  // Step 2: field mapping
  return (
    <Dialog role="dialog" aria-modal="true" aria-labelledby={titleId} variant="Surface" style={{ width: '90vw', maxWidth: '520px' }}>
      <Header style={{ padding: '0 ' + config.space.S200 + ' 0 ' + config.space.S400, borderBottomWidth: config.borderWidth.B300 }} variant="Surface" size="500">
        <Box grow="Yes" alignItems="Center" gap="200">
          <IconButton size="300" onClick={() => setStep('pick-room')} radii="300" aria-label="Back to room picker">
            <Icon src={Icons.ArrowLeft} />
          </IconButton>
          <Text id={titleId} size="H4">Map Fields</Text>
        </Box>
        <IconButton size="300" onClick={onClose} radii="300" aria-label="Close"><Icon src={Icons.Cross} /></IconButton>
      </Header>
      <Scroll style={{ maxHeight: '60vh' }}>
        <Box direction="Column" gap="300" style={{ padding: config.space.S400 }}>
          <Text size="T300" priority="300">{'Moving to: ' + (targetRoom?.name ?? '')}</Text>
          {sourceSchema.fields.map((sf) => {
            const currentMapping = fieldMapping.get(sf.key) ?? null;
            const compatibleTargets = (targetSchema?.fields ?? []).filter((tf) => tf.type === sf.type);
            const mappedTarget = targetSchema?.fields.find((f) => f.key === currentMapping);
            const hasNewEnumVals =
              sf.type === 'enum' &&
              currentMapping !== null &&
              (sf.values ?? []).some((v) => !(mappedTarget?.values ?? []).includes(v));
            return (
              <Box key={sf.key} alignItems="Center" gap="200" style={{ flexWrap: 'wrap' }}>
                <Text size="T300" style={{ width: '140px', flexShrink: 0 }}>{sf.label}</Text>
                <Text size="T200" priority="300">{'\u2192'}</Text>
                <select
                  value={currentMapping ?? ''}
                  onChange={(e) => {
                    const val = e.target.value || null;
                    setFieldMapping((m) => { const n = new Map(m); n.set(sf.key, val); return n; });
                  }}
                  aria-label={'Map ' + sf.label + ' to target field'}
                  style={{ ...inlineSelectStyle, flex: 1, minWidth: '120px' }}
                >
                  <option value="">(skip)</option>
                  {compatibleTargets.map((tf) => (
                    <option key={tf.key} value={tf.key}>{tf.label}</option>
                  ))}
                </select>
                {sf.type === 'enum' && currentMapping && (
                  <Text size="T200" style={{ color: hasNewEnumVals ? color.Warning.Main : color.Primary.Main, flexShrink: 0 }}>
                    {hasNewEnumVals ? '\u26A0 Will merge' : '\u2713 Matches'}
                  </Text>
                )}
              </Box>
            );
          })}
          {error && <Text size="T300" style={{ color: color.Critical.Main }}>{error}</Text>}
        </Box>
      </Scroll>
      <Box gap="200" style={{ padding: config.space.S300, borderTop: '1px solid ' + color.Surface.ContainerLine, justifyContent: 'flex-end' }}>
        <Button type="button" variant="Secondary" fill="Soft" size="300" onClick={() => setStep('pick-room')}><Text>Back</Text></Button>
        <Button type="button" variant="Primary" size="300" onClick={handleMove} aria-disabled={moving}>
          <Text>{moving ? 'Moving\u2026' : 'Move ' + issuesToMove.length + ' Issue' + (issuesToMove.length !== 1 ? 's' : '')}</Text>
        </Button>
      </Box>
    </Dialog>
  );
}

// ── IssueBoard ────────────────────────────────────────────────────────────────

export interface IssueBoardProps { room: Room; }

export function IssueBoard({ room }: IssueBoardProps) {
  const mx = useMatrixClient();
  const powerLevels = usePowerLevelsContext();
  const creators = useRoomCreators(room);
  const permissions = useRoomPermissions(creators, powerLevels);

  const roomCreateEvent = room.getLiveTimeline().getState(EventTimeline.BACKWARDS)?.getStateEvents(StateEvent.RoomCreate, '');
  const isRoomCreator = roomCreateEvent?.getSender() === mx.getSafeUserId();
  const canWriteIssues = isRoomCreator || permissions.stateEvent('eu.kiefte.issue' as any, mx.getSafeUserId());
  const canConfigSchema = isRoomCreator || permissions.stateEvent('eu.kiefte.issues.schema' as any, mx.getSafeUserId());

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const refresh = () => setTick((t) => t + 1);
    mx.on('RoomState.events' as any, refresh);
    return () => { mx.off('RoomState.events' as any, refresh); };
  }, [mx]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const schema = useMemo(() => getIssueSchema(room), [room, tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const issues = useMemo(() => getIssues(room), [room, tick]);

  // Widget registration — check if the issue tracker widget is already in this room
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const widgetEnabled = useMemo(() => {
    const state = room.getLiveTimeline().getState(EventTimeline.FORWARDS);
    const ev = state?.getStateEvents('im.vector.modular.widgets' as any, 'eu.kiefte.issue-tracker');
    return ev != null && !ev.isRedacted() && Object.keys(ev.getContent() as object).length > 0;
  }, [room, tick]);

  const enableWidget = useCallback(async () => {
    const widgetUrl = `${window.location.origin}/widget.html?roomId=$matrix_room_id&userId=$matrix_user_id`;
    await mx.sendStateEvent(room.roomId, 'im.vector.modular.widgets' as any, {
      type: 'm.custom',
      url: widgetUrl,
      name: 'Issue Tracker',
      id: 'eu.kiefte.issue-tracker',
    }, 'eu.kiefte.issue-tracker');
  }, [mx, room.roomId]);

  const [viewMode, setViewMode] = useState<ViewMode>(() => loadViewMode(room.roomId, getIssueSchema(room)));
  const switchView = (mode: ViewMode) => { setViewMode(mode); saveViewMode(room.roomId, mode); };

  // List sort/filter state
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [filterField, setFilterField] = useState<string | null>(null);
  const [filterValue, setFilterValue] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  const editTriggerRef = useRef<HTMLButtonElement>(null);
  const schemaTriggerRef = useRef<HTMLButtonElement>(null);
  const lastEditTriggerRef = useRef<HTMLElement | null>(null);
  const [editing, setEditing] = useState<IssueEntry | 'new' | null>(null);
  const [editingSchema, setEditingSchema] = useState(false);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(new Set());
  const [movingIssues, setMovingIssues] = useState(false);

  const toggleSelect = useCallback((stateKey: string) => {
    setSelectedIssueIds((prev) => {
      const next = new Set(prev);
      if (next.has(stateKey)) next.delete(stateKey); else next.add(stateKey);
      return next;
    });
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIssueIds(new Set());
  }, []);

  const selectedEntries = useMemo(
    () => issues.filter((e) => selectedIssueIds.has(e.event.getStateKey()!)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [issues, selectedIssueIds]
  );

  const openEdit = useCallback((entry: IssueEntry | 'new') => {
    lastEditTriggerRef.current = document.activeElement as HTMLElement || null;
    setEditing(entry);
  }, []);

  const closeEdit = useCallback(() => {
    const trigger = lastEditTriggerRef.current;
    lastEditTriggerRef.current = null;
    setEditing(null);
    setTimeout(() => {
      if (trigger && document.body.contains(trigger)) {
        trigger.focus();
      } else {
        editTriggerRef.current?.focus();
      }
    }, 50);
  }, []);

  // 'n' = new issue when board is focused and not in an input
  useEffect(() => {
    if (!canWriteIssues) return;
    const handleKeyDown = (evt: KeyboardEvent) => {
      if (evt.key !== 'n' || evt.altKey || evt.ctrlKey || evt.metaKey || evt.shiftKey) return;
      const target = evt.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return;
      evt.preventDefault();
      openEdit('new');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canWriteIssues, openEdit]);

  const handleSaveIssue = useCallback(async (content: IssueContent) => {
    const isNew = editing === 'new';
    const entry = editing !== 'new' && editing !== null ? editing : null;
    const stateKey = entry ? entry.event.getStateKey()! : generateId();
    await mx.sendStateEvent(room.roomId, 'eu.kiefte.issue' as any, content, stateKey);
    try {
      const oldContent = entry ? entry.content : undefined;
      const body = schema ? formatIssueDiff(schema, oldContent, content) : 'Issue updated';
      await mx.sendEvent(room.roomId, 'm.room.message' as any, { msgtype: 'm.notice', body, 'eu.kiefte.issue_id': stateKey });
    } catch { /* non-critical */ }
    closeEdit();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mx, room.roomId, editing, schema]);

  const handleDeleteIssue = useCallback(async () => {
    if (editing === null || editing === 'new') return;
    const stateKey = editing.event.getStateKey()!;
    const current = editing.content;
    await mx.sendStateEvent(room.roomId, 'eu.kiefte.issue' as any, { ...current, _deleted: true }, stateKey);
    try {
      const titleField = schema?.fields.find((f) => f.key === 'title') ?? schema?.fields[0];
      const title = titleField ? ((current[titleField.key] as string) ?? '(untitled)') : '(untitled)';
      await mx.sendEvent(room.roomId, 'm.room.message' as any, { msgtype: 'm.notice', body: '\u{1F5D1}\uFE0F Issue deleted: "' + title + '"', 'eu.kiefte.issue_id': stateKey });
    } catch { /* non-critical */ }
    closeEdit();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mx, room.roomId, editing, schema]);

  const closeSchema = useCallback(() => {
    setEditingSchema(false);
    setTimeout(() => schemaTriggerRef.current?.focus(), 50);
  }, []);

  const handleSaveSchema = useCallback(async (newSchema: IssueSchema) => {
    await mx.sendStateEvent(room.roomId, 'eu.kiefte.issues.schema' as any, newSchema, '');
    closeSchema();
  }, [mx, room.roomId, closeSchema]);

  // Must be declared before any conditional return to satisfy Rules of Hooks.
  const displayedIssues = useMemo(() => {
    if (!schema) return [];
    const fDef = schema.fields.find((f) => f.key === filterField);
    let list = [...issues];
    if (filterField && fDef?.type === 'date' && (filterDateFrom || filterDateTo)) {
      list = list.filter((entry) => {
        const val = String(entry.content[filterField] ?? '');
        if (!val) return !filterDateFrom;
        if (filterDateFrom && val < filterDateFrom) return false;
        if (filterDateTo && val > filterDateTo) return false;
        return true;
      });
    } else if (filterField && filterValue) {
      list = list.filter((entry) => {
        const val = String(entry.content[filterField] ?? '');
        return val.toLowerCase().includes(filterValue.toLowerCase());
      });
    }
    if (sortField) {
      const field = schema.fields.find((f) => f.key === sortField);
      list.sort((a, b) => {
        const av = String(a.content[sortField] ?? '');
        const bv = String(b.content[sortField] ?? '');
        const cmp = field ? compareFieldValues(av, bv, field) : av.localeCompare(bv);
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues, schema, filterField, filterValue, filterDateFrom, filterDateTo, sortField, sortDir]);

  if (!schema) {
    if (!canConfigSchema) {
      return (
        <Box grow="Yes" direction="Column" alignItems="Center" justifyContent="Center" gap="300" style={{ padding: config.space.S500, textAlign: 'center' }}>
          <Icon src={Icons.CheckTwice} size="600" aria-hidden="true" />
          <Text as="h2" size="H5">Issue Tracker Not Set Up</Text>
          <Text size="T300" priority="300">Ask a room admin to initialize the issue tracker.</Text>
        </Box>
      );
    }
    return (
      <Box grow="Yes" direction="Column" style={{ overflow: 'auto', alignItems: 'center', justifyContent: 'center', padding: config.space.S400 }}>
        <SchemaEditor initial={DEFAULT_ISSUE_SCHEMA} titleText="Initialize Issue Tracker" onSave={handleSaveSchema} onCancel={() => {}} />
      </Box>
    );
  }

  // All enum fields can be used as kanban grouping; kanban_group marks the preferred default.
  const enumFields = schema.fields.filter((f) => f.type === 'enum');

  const effectiveViewMode: ViewMode = (() => {
    if (viewMode.type === 'list') return viewMode;
    if (enumFields.some((f) => f.key === viewMode.fieldKey)) return viewMode;
    const preferred = enumFields.find((f) => f.kanban_group) ?? enumFields[0];
    return preferred ? { type: 'kanban', fieldKey: preferred.key } : { type: 'list' };
  })();

  // Sorted + filtered issue list for list view
  const filterFieldDef = schema.fields.find((f) => f.key === filterField);

  const initialContent = editing !== null && editing !== 'new' ? editing.content : undefined;

  const renderKanban = (kanbanFieldKey: string) => {
    const kanbanField = schema.fields.find((f) => f.key === kanbanFieldKey);
    if (!kanbanField) return null;
    interface Column { key: string; label: string; entries: IssueEntry[]; }
    const columns: Column[] = [
      ...(kanbanField.values ?? []).map((value) => ({
        key: value, label: value,
        entries: issues.filter((entry) => entry.content[kanbanField.key] === value),
      })),
      { key: '__uncategorized__', label: 'Uncategorized',
        entries: issues.filter((entry) => !kanbanField.values?.includes(entry.content[kanbanField.key] as string)) },
    ].filter((col) => col.entries.length > 0 || kanbanField.values?.includes(col.key));

    return (
      <div style={{ flexGrow: 1, overflow: 'auto' }} role="region" aria-label="Issue board">
        <Box gap="300" style={{ padding: config.space.S300, minHeight: '100%', alignItems: 'flex-start' }}>
          {columns.map((col) => {
            const colHeadingId = 'issue-col-heading-' + col.key;
            return (
              <section key={col.key} aria-labelledby={colHeadingId}
                style={{ minWidth: '240px', maxWidth: '320px', flexShrink: 0, background: color.SurfaceVariant.Container,
                  borderRadius: config.radii.R300, padding: config.space.S300, display: 'flex', flexDirection: 'column', gap: config.space.S200 }}>
                <Box alignItems="Center" style={{ justifyContent: 'space-between' }}>
                  <Text id={colHeadingId} as="h3" size="H6">{col.label.replace(/_/g, ' ')}</Text>
                  <Text size="T200" priority="300" aria-label={col.entries.length + ' issues'}>{col.entries.length}</Text>
                </Box>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: config.space.S200 }}>
                  {col.entries.map((entry) => {
                    const sk = entry.event.getStateKey()!;
                    return (
                      <li key={sk}>
                        <IssueCard
                          entry={entry} schema={schema} room={room}
                          kanbanFieldKey={kanbanFieldKey} canWrite={canWriteIssues}
                          onClick={() => openEdit(entry)}
                          showCheckbox={selectionMode}
                          isSelected={selectedIssueIds.has(sk)}
                          onToggleSelect={() => toggleSelect(sk)}
                        />
                      </li>
                    );
                  })}
                  {col.entries.length === 0 && (
                    <li aria-live="polite">
                      <Text size="T200" priority="300" style={{ textAlign: 'center', padding: config.space.S200 }}>No issues</Text>
                    </li>
                  )}
                </ul>
              </section>
            );
          })}
        </Box>
      </div>
    );
  };

  const renderList = () => (
    <Scroll style={{ flexGrow: 1 }}>
      <Box direction="Column" gap="300" style={{ padding: config.space.S300 }} role="list" aria-label="Issues">
        {displayedIssues.length === 0 && (
          <Text size="T300" priority="300" style={{ textAlign: 'center', padding: config.space.S400 }}>
            {issues.length === 0 ? 'No issues yet.' : 'No issues match the current filter.'}
          </Text>
        )}
        {displayedIssues.map((entry) => {
          const sk = entry.event.getStateKey()!;
          return (
            <Box key={sk} role="listitem">
              <IssueListItem
                entry={entry} schema={schema} room={room} canWrite={canWriteIssues}
                onEdit={() => openEdit(entry)}
                showCheckbox={selectionMode}
                isSelected={selectedIssueIds.has(sk)}
                onToggleSelect={() => toggleSelect(sk)}
              />
            </Box>
          );
        })}
      </Box>
    </Scroll>
  );

  const preferredKanbanField = enumFields.find((f) => f.kanban_group) ?? enumFields[0];

  return (
    <Box grow="Yes" direction="Column" style={{ overflow: 'hidden' }}>
      {/* Main toolbar */}
      <Box shrink="No" alignItems="Center" gap="200" role="toolbar" aria-label="Issue tracker controls"
        style={{ padding: config.space.S200 + ' ' + config.space.S400, borderBottom: '1px solid ' + color.Surface.ContainerLine, flexWrap: 'wrap' }}>
        {selectionMode ? (
          <>
            <Text size="T300" style={{ flexGrow: 1 }} aria-live="polite">{selectedIssueIds.size} selected</Text>
            {selectedIssueIds.size > 0 && (
              <Button size="300" variant="Secondary" fill="Soft" onClick={() => setMovingIssues(true)}>
                <Icon src={Icons.ArrowRight} size="100" aria-hidden="true" />
                <Text>{'Move ' + selectedIssueIds.size}</Text>
              </Button>
            )}
            <Button size="300" variant="Secondary" fill="None" onClick={exitSelectionMode}>
              <Text>Cancel</Text>
            </Button>
          </>
        ) : (
          <>
            <Text size="T300" style={{ flexGrow: 1 }} aria-live="polite">{issues.length} {issues.length === 1 ? 'issue' : 'issues'}</Text>
            <Box gap="100" alignItems="Center">
              {/* Kanban button — uses preferred field; when in kanban, group-by selector shown below */}
              {enumFields.length > 0 && (
                <Button size="300" variant="Secondary"
                  fill={effectiveViewMode.type === 'kanban' ? 'Solid' : 'Soft'}
                  onClick={() => { if (preferredKanbanField) switchView({ type: 'kanban', fieldKey: preferredKanbanField.key }); }}
                  aria-pressed={effectiveViewMode.type === 'kanban'}>
                  <Text>Kanban</Text>
                </Button>
              )}
              <Button size="300" variant="Secondary" fill={effectiveViewMode.type === 'list' ? 'Solid' : 'Soft'}
                onClick={() => switchView({ type: 'list' })} aria-pressed={effectiveViewMode.type === 'list'}>
                <Text>List</Text>
              </Button>
            </Box>
            {canConfigSchema && (
              <Button ref={schemaTriggerRef} size="300" variant="Secondary" fill="Soft" onClick={() => setEditingSchema(true)} aria-label="Edit issue tracker schema">
                <Icon src={Icons.Setting} size="100" aria-hidden="true" /><Text>Schema</Text>
              </Button>
            )}
            {canConfigSchema && !widgetEnabled && (
              <Button size="300" variant="Secondary" fill="Soft" onClick={enableWidget} aria-label="Register issue tracker as a widget for other Matrix clients">
                <Icon src={Icons.Link} size="100" aria-hidden="true" /><Text>Enable widget</Text>
              </Button>
            )}
            {canWriteIssues && issues.length > 0 && (
              <Button size="300" variant="Secondary" fill="Soft" onClick={() => setSelectionMode(true)} aria-label="Select issues to move">
                <Text>Select</Text>
              </Button>
            )}
            {canWriteIssues && (
              <Button ref={editTriggerRef} size="300" variant="Primary" onClick={() => openEdit('new')} aria-label="Create new issue" aria-keyshortcuts="n">
                <Icon src={Icons.Plus} size="100" aria-hidden="true" /><Text>New Issue</Text>
              </Button>
            )}
          </>
        )}
      </Box>

      {/* Secondary toolbar: kanban group-by selector (when in kanban with multiple enum fields) */}
      {effectiveViewMode.type === 'kanban' && enumFields.length > 1 && (
        <Box shrink="No" alignItems="Center" gap="200"
          style={{ padding: config.space.S100 + ' ' + config.space.S400, borderBottom: '1px solid ' + color.Surface.ContainerLine, background: color.SurfaceVariant.Container }}>
          <Text size="T200">Group by:</Text>
          <select
            value={effectiveViewMode.fieldKey}
            onChange={(e) => switchView({ type: 'kanban', fieldKey: e.target.value })}
            aria-label="Kanban grouping field"
            style={inlineSelectStyle}>
            {enumFields.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
        </Box>
      )}

      {/* Secondary toolbar: sort + filter (when in list view) */}
      {effectiveViewMode.type === 'list' && (
        <Box shrink="No" alignItems="Center" gap="300" style={{ flexWrap: 'wrap',
          padding: config.space.S100 + ' ' + config.space.S400, borderBottom: '1px solid ' + color.Surface.ContainerLine, background: color.SurfaceVariant.Container }}>
          {/* Sort */}
          <Box alignItems="Center" gap="100">
            <Text size="T200">Sort:</Text>
            <select value={sortField ?? ''} onChange={(e) => setSortField(e.target.value || null)}
              aria-label="Sort by field" style={inlineSelectStyle}>
              <option value="">Default</option>
              {schema.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            {sortField && (
              <button type="button"
                onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                aria-label={sortDir === 'asc' ? 'Ascending, click to reverse' : 'Descending, click to reverse'}
                style={{ background: 'transparent', border: '1px solid ' + color.Surface.ContainerLine,
                  borderRadius: config.radii.R300, cursor: 'pointer', padding: '2px 8px',
                  font: 'inherit', fontSize: '0.85em', color: 'inherit' }}>
                {sortDir === 'asc' ? '\u2191 Asc' : '\u2193 Desc'}
              </button>
            )}
          </Box>
          {/* Filter */}
          <Box alignItems="Center" gap="100">
            <Text size="T200">Filter:</Text>
            <select value={filterField ?? ''} onChange={(e) => { setFilterField(e.target.value || null); setFilterValue(''); setFilterDateFrom(''); setFilterDateTo(''); }}
              aria-label="Filter by field" style={inlineSelectStyle}>
              <option value="">None</option>
              {schema.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            {filterField && filterFieldDef?.type === 'date' ? (
              <Box alignItems="Center" gap="100">
                <label htmlFor="filter-date-from"><Text size="T200">From:</Text></label>
                <input id="filter-date-from" type="date" value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  aria-label="Filter from date" style={inlineSelectStyle} />
                <label htmlFor="filter-date-to"><Text size="T200">To:</Text></label>
                <input id="filter-date-to" type="date" value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                  aria-label="Filter to date" style={inlineSelectStyle} />
              </Box>
            ) : filterField && filterFieldDef?.type === 'enum' ? (
              <select value={filterValue} onChange={(e) => setFilterValue(e.target.value)}
                aria-label={'Filter value for ' + filterFieldDef.label} style={inlineSelectStyle}>
                <option value="">Any</option>
                {filterFieldDef.values?.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            ) : filterField ? (
              <input type="text" value={filterValue} onChange={(e) => setFilterValue(e.target.value)}
                aria-label={'Filter value'} placeholder="Filter…"
                style={{ ...inlineSelectStyle, width: '120px' }} />
            ) : null}
            {filterField && (filterValue || filterDateFrom || filterDateTo) && (
              <button type="button" onClick={() => { setFilterField(null); setFilterValue(''); setFilterDateFrom(''); setFilterDateTo(''); }}
                aria-label="Clear filter"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 4px',
                  font: 'inherit', color: 'inherit', opacity: 0.7 }}>
                ×
              </button>
            )}
          </Box>
        </Box>
      )}

      {effectiveViewMode.type === 'kanban' ? renderKanban(effectiveViewMode.fieldKey) : renderList()}

      <Overlay open={editing !== null} backdrop={<OverlayBackdrop />}>
        <OverlayCenter>
          <FocusTrap focusTrapOptions={{ initialFocus: false, clickOutsideDeactivates: true, onDeactivate: closeEdit, escapeDeactivates: stopPropagation }}>
            {schema && editing !== null && (
              <IssueForm schema={schema} initial={initialContent} room={room}
                issueId={editing !== 'new' ? editing.event.getStateKey()! : undefined}
                onSave={handleSaveIssue} onCancel={closeEdit}
                canDelete={editing !== 'new' && canWriteIssues}
                onDelete={editing !== 'new' ? handleDeleteIssue : undefined} />
            )}
          </FocusTrap>
        </OverlayCenter>
      </Overlay>

      <Overlay open={editingSchema} backdrop={<OverlayBackdrop />}>
        <OverlayCenter>
          <FocusTrap focusTrapOptions={{ initialFocus: false, clickOutsideDeactivates: true, onDeactivate: closeSchema, escapeDeactivates: stopPropagation }}>
            {editingSchema && (
              <SchemaEditor initial={schema} titleText="Edit Schema" onSave={handleSaveSchema} onCancel={closeSchema} />
            )}
          </FocusTrap>
        </OverlayCenter>
      </Overlay>

      <Overlay open={movingIssues} backdrop={<OverlayBackdrop />}>
        <OverlayCenter>
          <FocusTrap focusTrapOptions={{ initialFocus: false, clickOutsideDeactivates: true, onDeactivate: () => setMovingIssues(false), escapeDeactivates: stopPropagation }}>
            {movingIssues && (
              <MoveIssueDialog
                sourceRoom={room}
                sourceSchema={schema}
                issuesToMove={selectedEntries}
                onClose={() => setMovingIssues(false)}
                onMoved={exitSelectionMode}
              />
            )}
          </FocusTrap>
        </OverlayCenter>
      </Overlay>
    </Box>
  );
}
