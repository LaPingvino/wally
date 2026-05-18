import { useCallback, useEffect, useState } from 'react';
import { MatrixClient, MatrixEvent, Room, RoomEvent } from 'matrix-js-sdk';
import { useAtomValue } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { settingsAtom } from '../settings';

// Per-room account data event for the Wally "where do m.notice
// messages appear" toggle.
//   absent or { inbox_only: undefined } → follow global default
//   { inbox_only: false }                → force inline in timeline
//   { inbox_only: true }                 → suppress from timeline,
//                                          only visible in Notices inbox
//
// Notices remain visible in the Notices inbox regardless of mode.
export const NOTICE_MODE_EVENT = 'eu.kiefte.wally.notice_mode';

export type NoticeModeContent = {
  inbox_only?: boolean;
};

export const getRoomNoticeOverride = (room: Room): boolean | undefined => {
  const ev = room.getAccountData(NOTICE_MODE_EVENT);
  const content = ev?.getContent<NoticeModeContent>();
  return content?.inbox_only;
};

export const setRoomNoticeOverride = async (
  mx: MatrixClient,
  roomId: string,
  override: boolean | undefined
): Promise<void> => {
  // Writing an empty object reverts to "follow global default"; the
  // Matrix spec has no clean way to delete an account-data event, so
  // we store the cleared state as an empty content.
  const content: NoticeModeContent = override === undefined ? {} : { inbox_only: override };
  await mx.setRoomAccountData(roomId, NOTICE_MODE_EVENT, content);
};

const subscribeNoticeOverride = (room: Room, listener: () => void): (() => void) => {
  const handler = (event: MatrixEvent) => {
    if (event.getType() === NOTICE_MODE_EVENT) listener();
  };
  room.on(RoomEvent.AccountData, handler);
  return () => {
    room.off(RoomEvent.AccountData, handler);
  };
};

export const useRoomNoticeOverride = (room: Room): boolean | undefined => {
  const [override, setOverride] = useState<boolean | undefined>(() => getRoomNoticeOverride(room));

  useEffect(() => {
    setOverride(getRoomNoticeOverride(room));
    return subscribeNoticeOverride(room, () => setOverride(getRoomNoticeOverride(room)));
  }, [room]);

  return override;
};

const noticeInboxOnlyDefaultAtom = selectAtom(settingsAtom, (s) => s.noticeInboxOnlyDefault);

export const useEffectiveNoticeInboxOnly = (room: Room): boolean => {
  const override = useRoomNoticeOverride(room);
  const globalDefault = useAtomValue(noticeInboxOnlyDefaultAtom);
  return override ?? globalDefault;
};

export const useSetRoomNoticeOverride = (
  mx: MatrixClient,
  roomId: string
): ((override: boolean | undefined) => Promise<void>) =>
  useCallback(
    (override: boolean | undefined) => setRoomNoticeOverride(mx, roomId, override),
    [mx, roomId]
  );
