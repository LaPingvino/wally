import React, {
  ChangeEventHandler,
  useCallback,
  useMemo,
  useState,
} from 'react';
import {
  Avatar,
  Box,
  Chip,
  Dialog,
  Header,
  Icon,
  IconButton,
  Icons,
  Input,
  MenuItem,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Scroll,
  Spinner,
  Text,
  as,
  color,
  config,
  toRem,
} from 'folds';
import FocusTrap from 'focus-trap-react';
import { IContent, JoinRule, MatrixEvent, MsgType, Room } from 'matrix-js-sdk';
import { useAtomValue } from 'jotai';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { mDirectAtom } from '../../../state/mDirectList';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { useAsyncSearch, UseAsyncSearchOptions } from '../../../hooks/useAsyncSearch';
import { factoryRoomIdByActivity } from '../../../utils/sort';
import {
  getDirectRoomAvatarUrl,
  getEditedEvent,
  getRoomAvatarUrl,
  isRoom,
  trimReplyFromBody,
  trimReplyFromFormattedBody,
} from '../../../utils/room';
import { RoomAvatar, RoomIcon } from '../../../components/room-avatar';
import { getMatrixToRoomEvent } from '../../../plugins/matrix-to';
import { getViaServers } from '../../../plugins/via-servers';
import { stopPropagation } from '../../../utils/keyboard';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import * as css from './styles.css';

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const pad2 = (n: number): string => n.toString().padStart(2, '0');

const formatForwardTimestamp = (tsMs: number): string => {
  const d = new Date(tsMs);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(
    d.getUTCDate()
  )} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
};

export const buildForwardContent = (
  srcRoom: Room,
  mEvent: MatrixEvent,
  overrideContent?: IContent
): IContent | null => {
  const eventId = mEvent.getId();
  if (!eventId) return null;

  let resolvedContent: IContent | undefined = overrideContent;
  if (!resolvedContent) {
    const timeline = srcRoom.getTimelineForEvent(eventId);
    const editedEvent = timeline
      ? getEditedEvent(eventId, mEvent, timeline.getTimelineSet())
      : undefined;
    resolvedContent =
      (editedEvent?.getContent()['m.new_content'] as IContent | undefined) ??
      mEvent.getContent();
  }
  const original = resolvedContent;
  const msgtype = (original.msgtype as string | undefined) ?? MsgType.Text;

  const out: IContent = { ...original };
  delete out['m.relates_to'];
  delete out['m.new_content'];
  delete out['com.beeper.per_message_profile'];
  delete out['m.per_message_profile'];
  delete out['m.mentions'];

  const viaServers = getViaServers(srcRoom);
  const matrixToLink = getMatrixToRoomEvent(srcRoom.roomId, eventId, viaServers);
  const roomName =
    srcRoom.name || srcRoom.getCanonicalAlias() || srcRoom.roomId;
  const tsStr = formatForwardTimestamp(mEvent.getTs());

  const attrHtml = `<p><a href="${escapeHtml(matrixToLink)}">${escapeHtml(
    roomName
  )} • ${tsStr}</a></p>`;
  const attrText = `${roomName} • ${tsStr} (${matrixToLink})`;

  const rawBody = typeof original.body === 'string' ? original.body : '';
  const hasHtml =
    original.format === 'org.matrix.custom.html' &&
    typeof original.formatted_body === 'string';
  const rawHtml = hasHtml
    ? (original.formatted_body as string)
    : escapeHtml(rawBody).replace(/\n/g, '<br>');

  const origBody = trimReplyFromBody(rawBody);
  const origHtml = trimReplyFromFormattedBody(rawHtml);

  const quoted = origBody
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');
  const plainBody = `> ↷ Forwarded\n${quoted}\n>\n> — ${attrText}`;
  const htmlBody =
    `<blockquote data-mx-forwarded-notice>\n` +
    `<p><em>↷ Forwarded</em></p>\n` +
    `${origHtml}\n` +
    `${attrHtml}\n` +
    `</blockquote>`;

  if (
    msgtype === MsgType.Text ||
    msgtype === MsgType.Emote ||
    msgtype === MsgType.Notice
  ) {
    out.msgtype = msgtype;
    out.body = plainBody;
    out.format = 'org.matrix.custom.html';
    out.formatted_body = htmlBody;
    return out;
  }

  if (
    msgtype === MsgType.Image ||
    msgtype === MsgType.Video ||
    msgtype === MsgType.Audio ||
    msgtype === MsgType.File
  ) {
    // MSC4095-style caption: `filename` is the actual filename,
    // `body`/`formatted_body` become the caption carrying the attribution.
    const filename =
      typeof original.filename === 'string' ? original.filename : rawBody;
    out.filename = filename;
    out.body = plainBody;
    out.format = 'org.matrix.custom.html';
    out.formatted_body = htmlBody;
    return out;
  }

  // Unhandled msgtype (location, custom, etc.): carry content as-is,
  // append attribution to body.
  out.body = `${rawBody}\n\n— forwarded from ${attrText}`.trim();
  return out;
};

const SEARCH_OPTIONS: UseAsyncSearchOptions = {
  matchOptions: { contain: true },
};

type ForwardRoomItemProps = {
  roomId: string;
  onPick: (roomId: string) => void;
  disabled?: boolean;
};

function ForwardRoomItem({ roomId, onPick, disabled }: ForwardRoomItemProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const mDirects = useAtomValue(mDirectAtom);
  const room = mx.getRoom(roomId);
  if (!room) return null;
  const dm = mDirects.has(roomId);
  const avatarUrl = dm
    ? getDirectRoomAvatarUrl(mx, room, 32, useAuthentication)
    : getRoomAvatarUrl(mx, room, 32, useAuthentication);

  return (
    <MenuItem
      as="button"
      radii="300"
      onClick={() => onPick(roomId)}
      aria-disabled={disabled}
      before={
        <Avatar size="200">
          <RoomAvatar
            roomId={roomId}
            src={avatarUrl}
            alt={room.name}
            renderFallback={() => (
              <RoomIcon
                size="50"
                joinRule={room.getJoinRule() ?? JoinRule.Restricted}
                roomType={room.getType()}
                filled
              />
            )}
          />
        </Avatar>
      }
      after={
        <Text size="T200" priority="300" truncate>
          {room.getCanonicalAlias() ?? ''}
        </Text>
      }
    >
      <Text style={{ flexGrow: 1 }} size="B400" truncate>
        {room.name || roomId}
      </Text>
    </MenuItem>
  );
}

type ForwardDialogProps = {
  srcRoom: Room;
  mEvent: MatrixEvent;
  overrideContent?: IContent;
  open: boolean;
  onClose: () => void;
};

export function ForwardDialog({
  srcRoom,
  mEvent,
  overrideContent,
  open,
  onClose,
}: ForwardDialogProps) {
  const mx = useMatrixClient();
  const allRoomIds = useAtomValue(allRoomsAtom);

  const targetRoomIds = useMemo(
    () =>
      allRoomIds
        .filter((rId) => {
          if (rId === srcRoom.roomId) return false;
          const r = mx.getRoom(rId);
          return !!r && isRoom(r);
        })
        .sort(factoryRoomIdByActivity(mx)),
    [allRoomIds, mx, srcRoom.roomId]
  );

  const getSearchStr = useCallback(
    (rId: string) => {
      const r = mx.getRoom(rId);
      if (!r) return rId;
      const alias = r.getCanonicalAlias();
      return alias ? [r.name, alias] : r.name;
    },
    [mx]
  );

  const [result, search, resetSearch] = useAsyncSearch(
    targetRoomIds,
    getSearchStr,
    SEARCH_OPTIONS
  );
  const visibleRoomIds = result ? result.items.slice(0, 100) : targetRoomIds.slice(0, 100);

  const [query, setQuery] = useState('');
  const handleSearchChange: ChangeEventHandler<HTMLInputElement> = (evt) => {
    const v = evt.target.value;
    setQuery(v);
    if (v) search(v);
    else resetSearch();
  };

  const [sentRoomId, setSentRoomId] = useState<string>();

  const [sendState, sendForward] = useAsyncCallback(
    useCallback(
      async (targetRoomId: string) => {
        const content = buildForwardContent(srcRoom, mEvent, overrideContent);
        if (!content) throw new Error('Message cannot be forwarded');
        await mx.sendMessage(targetRoomId, content as any);
        return targetRoomId;
      },
      [mx, srcRoom, mEvent, overrideContent]
    )
  );

  const handlePick = (targetRoomId: string) => {
    if (sendState.status === AsyncStatus.Loading) return;
    setSentRoomId(targetRoomId);
    sendForward(targetRoomId).catch(() => {
      /* error surfaced via sendState */
    });
  };

  const handleClose = () => {
    setQuery('');
    resetSearch();
    setSentRoomId(undefined);
    onClose();
  };

  const isBusy = sendState.status === AsyncStatus.Loading;
  const isDone = sendState.status === AsyncStatus.Success;
  const errorMsg =
    sendState.status === AsyncStatus.Error ? 'Failed to forward. Try again.' : undefined;

  return (
    <Overlay open={open} backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            onDeactivate: handleClose,
            clickOutsideDeactivates: true,
            escapeDeactivates: stopPropagation,
          }}
        >
          <Dialog variant="Surface">
            <Header
              style={{
                padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
                borderBottomWidth: config.borderWidth.B300,
              }}
              variant="Surface"
              size="500"
            >
              <Box grow="Yes">
                <Text size="H4">Forward Message</Text>
              </Box>
              <IconButton size="300" onClick={handleClose} radii="300">
                <Icon src={Icons.Cross} />
              </IconButton>
            </Header>
            <Box
              style={{ padding: config.space.S400, width: toRem(420), maxWidth: '90vw' }}
              direction="Column"
              gap="300"
            >
              <Input
                variant="Background"
                placeholder="Search rooms and DMs…"
                value={query}
                onChange={handleSearchChange}
                aria-label="Search rooms to forward to"
                autoFocus
              />
              {errorMsg && (
                <Text style={{ color: color.Critical.Main }} size="T300">
                  {errorMsg}
                </Text>
              )}
              {isDone && (
                <Text style={{ color: color.Success.Main }} size="T300">
                  Forwarded.
                </Text>
              )}
              <Box
                direction="Column"
                gap="100"
                style={{ maxHeight: toRem(360), overflow: 'hidden' }}
              >
                <Scroll size="300" hideTrack visibility="Hover">
                  <Box direction="Column" gap="100" className={css.MessageMenuGroup}>
                    {visibleRoomIds.length === 0 && (
                      <Text size="T200" priority="300" style={{ padding: config.space.S200 }}>
                        No matching rooms.
                      </Text>
                    )}
                    {visibleRoomIds.map((rId) => (
                      <ForwardRoomItem
                        key={rId}
                        roomId={rId}
                        onPick={handlePick}
                        disabled={isBusy}
                      />
                    ))}
                  </Box>
                </Scroll>
              </Box>
              {(isBusy || isDone) && sentRoomId && (
                <Box alignItems="Center" gap="200">
                  {isBusy && <Spinner size="200" variant="Secondary" />}
                  <Text size="T200" priority="300">
                    {isBusy ? 'Sending…' : 'Sent to '}
                    {!isBusy && (mx.getRoom(sentRoomId)?.name ?? sentRoomId)}
                  </Text>
                  {isDone && (
                    <Chip
                      as="button"
                      size="400"
                      radii="Pill"
                      variant="Surface"
                      onClick={handleClose}
                    >
                      <Text size="T200">Done</Text>
                    </Chip>
                  )}
                </Box>
              )}
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

export type MessageForwardItemProps = {
  room: Room;
  mEvent: MatrixEvent;
  overrideContent?: IContent;
  onClose?: () => void;
};

export const MessageForwardItem = as<'button', MessageForwardItemProps>(
  ({ room, mEvent, overrideContent, onClose, ...props }, ref) => {
    const [open, setOpen] = useState(false);

    const handleClose = () => {
      setOpen(false);
      onClose?.();
    };

    return (
      <>
        <ForwardDialog
          srcRoom={room}
          mEvent={mEvent}
          overrideContent={overrideContent}
          open={open}
          onClose={handleClose}
        />
        <MenuItem
          size="300"
          after={<Icon size="100" src={Icons.ArrowGoRight} />}
          radii="300"
          onClick={() => setOpen(true)}
          {...props}
          ref={ref}
        >
          <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
            Forward
          </Text>
        </MenuItem>
      </>
    );
  }
);
