/**
 * ThreadView — renders a single Matrix thread using the same RoomTimeline + RoomInput
 * infrastructure as the main room view.
 *
 * Thread events are gathered by scanning the main room timeline directly
 * (no SDK Thread objects used — they're unreliable when hasServerSideSupport=0).
 *
 * Layout:
 *   ┌─ root event header ─────────────────────────────┐
 *   │  <sender>: <message preview>                     │
 *   └──────────────────────────────────────────────────┘
 *   ┌─ RoomTimeline (thread replies) ─────────────────┐
 *   │  (full message rendering, pagination, etc.)      │
 *   └──────────────────────────────────────────────────┘
 *   ┌─ RoomInput (sends thread replies) ──────────────┐
 *   └──────────────────────────────────────────────────┘
 */
import React, { useRef } from 'react';
import { Box, Text, config, toRem } from 'folds';
import { Room, MatrixEvent } from 'matrix-js-sdk';
import { useEditor } from '../../components/editor';
import { RoomTimeline } from './RoomTimeline';
import { RoomInput } from './RoomInput';
import { Page } from '../../components/page';
import { getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { getMemberDisplayName } from '../../utils/room';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';

// ── Root event header ──────────────────────────────────────────────────────────

function getEventBodyPreview(event: MatrixEvent): string {
  const content = event.getContent();
  const body: string = content.body ?? content.formatted_body ?? '';
  // Strip reply-to block ("> <@user:server> message\n\n")
  const stripped = body.replace(/^> .*\n+/gm, '').trim();
  return stripped.length > 200 ? `${stripped.slice(0, 200)}…` : stripped;
}

type RootEventHeaderProps = {
  room: Room;
  rootEvent: MatrixEvent;
};
function RootEventHeader({ room, rootEvent }: RootEventHeaderProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');

  const senderId = rootEvent.getSender() ?? '';
  const displayName =
    getMemberDisplayName(room, senderId) ?? getMxIdLocalPart(senderId) ?? senderId;

  const member = room.getMember(senderId);
  const avatarMxc = member?.getMxcAvatarUrl();
  const avatarUrl = avatarMxc
    ? mxcUrlToHttp(mx, avatarMxc, useAuthentication, 28, 28, 'crop') ?? undefined
    : undefined;

  const preview = getEventBodyPreview(rootEvent);
  const ts = rootEvent.getDate();
  const timeStr = ts
    ? ts.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: !hour24Clock,
      })
    : '';

  return (
    <Box
      direction="Row"
      gap="200"
      style={{
        padding: `${config.space.S200} ${config.space.S300}`,
        borderBottom: `1px solid var(--bg-surface-border)`,
        flexShrink: 0,
        background: 'var(--bg-surface-low)',
      }}
    >
      {/* Avatar */}
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
          marginTop: toRem(2),
        }}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={displayName}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <Text size="T200">{displayName[0]?.toUpperCase() ?? '?'}</Text>
        )}
      </div>

      {/* Content */}
      <Box direction="Column" grow="Yes" style={{ minWidth: 0 }}>
        <Box gap="200" alignItems="Baseline">
          <Text size="T300" weight="Medium" truncate>
            {displayName}
          </Text>
          {timeStr && (
            <Text size="T200" priority="300">
              {timeStr}
            </Text>
          )}
        </Box>
        <Text size="T300" priority="300" style={{ opacity: 0.8, wordBreak: 'break-word' }}>
          {preview || <em>Message</em>}
        </Text>
      </Box>
    </Box>
  );
}

// ── ThreadView ─────────────────────────────────────────────────────────────────

type ThreadViewProps = {
  room: Room;
  threadRootId: string;
};

export function ThreadView({ room, threadRootId }: ThreadViewProps) {
  const inputRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const editor = useEditor();

  // Thread events are gathered by RoomTimeline scanning the main room timeline directly.
  // No SDK Thread objects needed here.
  const rootEvent = room.findEventById(threadRootId) ?? null;

  return (
    <Page ref={viewRef}>
      {rootEvent && <RootEventHeader room={room} rootEvent={rootEvent} />}
      <Box grow="Yes" direction="Column">
        <RoomTimeline
          room={room}
          roomInputRef={inputRef}
          editor={editor}
          threadId={threadRootId}
        />
      </Box>
      <Box shrink="No" direction="Column">
        <div style={{ padding: `0 ${config.space.S400}` }}>
          <RoomInput
            room={room}
            roomId={room.roomId}
            threadId={threadRootId}
            editor={editor}
            fileDropContainerRef={viewRef}
            ref={inputRef}
          />
        </div>
      </Box>
    </Page>
  );
}
