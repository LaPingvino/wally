import React, {
  ChangeEventHandler,
  KeyboardEventHandler,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Avatar,
  Box,
  Chip,
  Header,
  Icon,
  IconButton,
  Icons,
  Input,
  MenuItem,
  Scroll,
  Spinner,
  Text,
  as,
  color,
  config,
  toRem,
} from 'folds';
import { isKeyHotkey } from 'is-hotkey';
import { IContent, JoinRule, MatrixEvent, MsgType, Room } from 'matrix-js-sdk';
import { useAtomValue } from 'jotai';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { mDirectAtom } from '../../../state/mDirectList';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { useAsyncSearch, UseAsyncSearchOptions } from '../../../hooks/useAsyncSearch';
import { useListFocusIndex } from '../../../hooks/useListFocusIndex';
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
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { NativeDialog } from '../../../components/NativeDialog';
import * as dialogCss from '../../../components/NativeDialog.css';
import * as css from './styles.css';

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
  const plainBody = `> ↷ Forwarded\n${quoted}`;
  const htmlBody =
    `<blockquote data-mx-forwarded-notice>\n` +
    `<p><em>↷ Forwarded</em></p>\n` +
    `${origHtml}\n` +
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
    // `body`/`formatted_body` become the caption carrying the forward notice.
    const filename =
      typeof original.filename === 'string' ? original.filename : rawBody;
    out.filename = filename;
    out.body = plainBody;
    out.format = 'org.matrix.custom.html';
    out.formatted_body = htmlBody;
    return out;
  }

  // Unhandled msgtype (location, custom, etc.): carry content as-is.
  return out;
};

const SEARCH_OPTIONS: UseAsyncSearchOptions = {
  matchOptions: { contain: true },
};

type ForwardRoomItemProps = {
  roomId: string;
  focused: boolean;
  focusIndex: number;
  onPick: (roomId: string) => void;
  disabled?: boolean;
};

function ForwardRoomItem({
  roomId,
  focused,
  focusIndex,
  onPick,
  disabled,
}: ForwardRoomItemProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const mDirects = useAtomValue(mDirectAtom);
  const room = mx.getRoom(roomId);
  if (!room) return null;
  const dm = mDirects.has(roomId);
  const avatarUrl = dm
    ? getDirectRoomAvatarUrl(mx, room, 32, useAuthentication)
    : getRoomAvatarUrl(mx, room, 32, useAuthentication);
  const alias = room.getCanonicalAlias() ?? '';
  const label = alias ? `${room.name || roomId} (${alias})` : room.name || roomId;

  return (
    <MenuItem
      as="button"
      role="option"
      aria-selected={focused}
      aria-label={label}
      data-focus-index={focusIndex}
      variant={focused ? 'Primary' : 'Surface'}
      radii="300"
      onClick={() => onPick(roomId)}
      aria-disabled={disabled}
      before={
        <Avatar size="200">
          <RoomAvatar
            roomId={roomId}
            src={avatarUrl}
            alt=""
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
          {alias}
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
  mEvents: MatrixEvent[];
  overrideContent?: IContent;
  open: boolean;
  onClose: () => void;
  onSent?: () => void;
};

export function ForwardDialog({
  srcRoom,
  mEvents,
  overrideContent,
  open,
  onClose,
  onSent,
}: ForwardDialogProps) {
  const mx = useMatrixClient();
  const allRoomIds = useAtomValue(allRoomsAtom);
  const isMulti = mEvents.length > 1;

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listFocus = useListFocusIndex(visibleRoomIds.length, 0);

  const handleSearchChange: ChangeEventHandler<HTMLInputElement> = (evt) => {
    const v = evt.target.value;
    setQuery(v);
    listFocus.reset();
    if (v) search(v);
    else resetSearch();
  };

  const [sentRoomId, setSentRoomId] = useState<string>();
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const [sendState, sendForward] = useAsyncCallback(
    useCallback(
      async (targetRoomId: string) => {
        const ordered = [...mEvents].sort((a, b) => a.getTs() - b.getTs());
        setProgress({ done: 0, total: ordered.length });
        for (let i = 0; i < ordered.length; i += 1) {
          const evt = ordered[i];
          const content = buildForwardContent(
            srcRoom,
            evt,
            ordered.length === 1 ? overrideContent : undefined
          );
          if (!content) throw new Error('Message cannot be forwarded');
          // eslint-disable-next-line no-await-in-loop
          await mx.sendMessage(targetRoomId, content as any);
          setProgress({ done: i + 1, total: ordered.length });
        }
        return targetRoomId;
      },
      [mx, srcRoom, mEvents, overrideContent]
    )
  );

  const handlePick = (targetRoomId: string) => {
    if (sendState.status === AsyncStatus.Loading) return;
    setSentRoomId(targetRoomId);
    sendForward(targetRoomId)
      .then(() => {
        onSent?.();
      })
      .catch(() => {
        /* error surfaced via sendState */
      });
  };

  const handleClose = () => {
    setQuery('');
    resetSearch();
    setSentRoomId(undefined);
    setProgress({ done: 0, total: 0 });
    listFocus.reset();
    onClose();
  };

  const handleInputKeyDown: KeyboardEventHandler<HTMLInputElement> = (evt) => {
    if (isKeyHotkey('enter', evt)) {
      evt.preventDefault();
      const rId = visibleRoomIds[listFocus.index];
      if (rId) handlePick(rId);
      return;
    }
    if (isKeyHotkey('arrowdown', evt)) {
      evt.preventDefault();
      listFocus.next();
      return;
    }
    if (isKeyHotkey('arrowup', evt)) {
      evt.preventDefault();
      listFocus.previous();
    }
  };

  useEffect(() => {
    const scrollView = scrollRef.current;
    const focusedItem = scrollView?.querySelector(
      `[data-focus-index="${listFocus.index}"]`
    );
    if (focusedItem) {
      focusedItem.scrollIntoView({ block: 'nearest' });
    }
  }, [listFocus.index]);

  useEffect(() => {
    if (open) {
      // Focus input after native <dialog> has opened
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open]);

  const isBusy = sendState.status === AsyncStatus.Loading;
  const isDone = sendState.status === AsyncStatus.Success;
  const errorMsg =
    sendState.status === AsyncStatus.Error ? 'Failed to forward. Try again.' : undefined;

  return (
    <NativeDialog
      open={open}
      onClose={handleClose}
      className={dialogCss.NativeDialog}
      style={{ width: toRem(460), maxHeight: toRem(560) }}
    >
      <Box direction="Column" style={{ height: '100%' }} role="dialog" aria-label="Forward message">
        <Header
          style={{
            padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
            borderBottomWidth: config.borderWidth.B300,
            flexShrink: 0,
          }}
          variant="Surface"
          size="500"
        >
          <Box grow="Yes">
            <Text size="H4">
              {isMulti ? `Forward ${mEvents.length} messages` : 'Forward Message'}
            </Text>
          </Box>
          <IconButton size="300" onClick={handleClose} radii="300" aria-label="Close">
            <Icon src={Icons.Cross} />
          </IconButton>
        </Header>
        <Box
          shrink="No"
          style={{ padding: config.space.S400, paddingBottom: config.space.S200 }}
          direction="Column"
          gap="200"
        >
          <Input
            ref={inputRef}
            variant="Background"
            placeholder="Search rooms and DMs…"
            value={query}
            onChange={handleSearchChange}
            onKeyDown={handleInputKeyDown}
            role="combobox"
            aria-label="Search rooms to forward to"
            aria-autocomplete="list"
            aria-expanded
            aria-controls="forward-room-list"
            aria-activedescendant={
              visibleRoomIds[listFocus.index]
                ? `forward-room-${visibleRoomIds[listFocus.index]}`
                : undefined
            }
            before={<Icon size="200" src={Icons.Search} />}
          />
          {errorMsg && (
            <Text style={{ color: color.Critical.Main }} size="T300" role="alert">
              {errorMsg}
            </Text>
          )}
        </Box>
        <Box grow="Yes" style={{ minHeight: 0 }}>
          <Scroll ref={scrollRef} size="300" hideTrack>
            <div
              id="forward-room-list"
              role="listbox"
              aria-label="Forward destinations"
              style={{ padding: `0 ${config.space.S400} ${config.space.S400}` }}
            >
              {visibleRoomIds.length === 0 && (
                <Text size="T200" priority="300" style={{ padding: config.space.S200 }}>
                  No matching rooms.
                </Text>
              )}
              {visibleRoomIds.map((rId, index) => (
                <div key={rId} id={`forward-room-${rId}`}>
                  <ForwardRoomItem
                    roomId={rId}
                    focused={listFocus.index === index}
                    focusIndex={index}
                    onPick={handlePick}
                    disabled={isBusy}
                  />
                </div>
              ))}
            </div>
          </Scroll>
        </Box>
        {(isBusy || isDone) && sentRoomId && (
          <Box
            shrink="No"
            alignItems="Center"
            gap="200"
            style={{
              padding: config.space.S300,
              borderTopWidth: config.borderWidth.B300,
            }}
            aria-live="polite"
          >
            {isBusy && <Spinner size="200" variant="Secondary" />}
            <Text size="T200" priority="300" style={{ flexGrow: 1 }}>
              {(() => {
                if (!isBusy) {
                  return `Sent to ${mx.getRoom(sentRoomId)?.name ?? sentRoomId}`;
                }
                if (isMulti) {
                  return `Sending ${progress.done}/${progress.total}…`;
                }
                return 'Sending…';
              })()}
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
    </NativeDialog>
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
    const events = useMemo(() => [mEvent], [mEvent]);

    const handleClose = () => {
      setOpen(false);
      onClose?.();
    };

    return (
      <>
        <ForwardDialog
          srcRoom={room}
          mEvents={events}
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
