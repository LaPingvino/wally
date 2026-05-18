import { useCallback, useEffect, useState } from 'react';
import { MatrixClient, MatrixEvent, Room, RoomEvent } from 'matrix-js-sdk';

// Per-room account data event type for the Wally "where do m.notice
// messages appear" toggle.
//   - absent or { inbox_only: false } → inline in timeline (default)
//   - { inbox_only: true }            → suppressed from timeline,
//                                       only visible via the Notices inbox
export const NOTICE_MODE_EVENT = 'eu.kiefte.wally.notice_mode';

export type NoticeModeContent = {
  inbox_only?: boolean;
};

export const getRoomNoticeInboxOnly = (room: Room): boolean => {
  const ev = room.getAccountData(NOTICE_MODE_EVENT);
  const content = ev?.getContent<NoticeModeContent>();
  return content?.inbox_only === true;
};

export const setRoomNoticeInboxOnly = async (
  mx: MatrixClient,
  roomId: string,
  inboxOnly: boolean
): Promise<void> => {
  // Empty content (vs deleting the event, which the spec doesn't support
  // cleanly) is enough to revert to the default. Keeping the event around
  // also lets other clients distinguish "explicitly default" from "never set."
  await mx.setRoomAccountData(roomId, NOTICE_MODE_EVENT, { inbox_only: inboxOnly });
};

export const useRoomNoticeInboxOnly = (room: Room): boolean => {
  const [inboxOnly, setInboxOnly] = useState(() => getRoomNoticeInboxOnly(room));

  useEffect(() => {
    setInboxOnly(getRoomNoticeInboxOnly(room));
    const handler = (event: MatrixEvent) => {
      if (event.getType() === NOTICE_MODE_EVENT) {
        setInboxOnly(getRoomNoticeInboxOnly(room));
      }
    };
    room.on(RoomEvent.AccountData, handler);
    return () => {
      room.off(RoomEvent.AccountData, handler);
    };
  }, [room]);

  return inboxOnly;
};

export const useSetRoomNoticeInboxOnly = (
  mx: MatrixClient,
  roomId: string
): ((inboxOnly: boolean) => Promise<void>) =>
  useCallback((inboxOnly: boolean) => setRoomNoticeInboxOnly(mx, roomId, inboxOnly), [mx, roomId]);
