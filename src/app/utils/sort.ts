import { MatrixClient } from 'matrix-js-sdk';
import { getLastMeaningfulTimestamp } from './room';

export type SortFunc<T> = (a: T, b: T) => number;

export const factoryRoomIdByActivity =
  (mx: MatrixClient): SortFunc<string> =>
  (a, b) => {
    const room1 = mx.getRoom(a);
    const room2 = mx.getRoom(b);

    // Sort by last CONVERSATIONAL activity, not raw getLastActiveTimestamp():
    // the latter counts member/state/eu.kiefte.issue events, so editing an issue
    // (state event) re-floats a room to the top even with no new message.
    return (
      (room2 ? getLastMeaningfulTimestamp(room2) : Number.MIN_SAFE_INTEGER) -
      (room1 ? getLastMeaningfulTimestamp(room1) : Number.MIN_SAFE_INTEGER)
    );
  };

export const factoryRoomIdByAtoZ =
  (mx: MatrixClient): SortFunc<string> =>
  (a, b) => {
    let aName = mx.getRoom(a)?.name ?? '';
    let bName = mx.getRoom(b)?.name ?? '';

    // remove "#" from the room name
    // To ignore it in sorting
    aName = aName.replace(/#/g, '');
    bName = bName.replace(/#/g, '');

    if (aName.toLowerCase() < bName.toLowerCase()) {
      return -1;
    }
    if (aName.toLowerCase() > bName.toLowerCase()) {
      return 1;
    }
    return 0;
  };

export const factoryRoomIdByUnreadCount =
  (getUnreadCount: (roomId: string) => number): SortFunc<string> =>
  (a, b) => {
    const aT = getUnreadCount(a) ?? 0;
    const bT = getUnreadCount(b) ?? 0;
    return bT - aT;
  };

export const byTsOldToNew: SortFunc<number> = (a, b) => a - b;

export const factoryRoomIdByUnreadFirst =
  (
    getHighlight: (roomId: string) => number,
    getTotal: (roomId: string) => number,
    fallback: SortFunc<string>
  ): SortFunc<string> =>
  (a, b) => {
    const aH = getHighlight(a);
    const bH = getHighlight(b);
    if (bH !== aH) return bH - aH;
    const aT = getTotal(a);
    const bT = getTotal(b);
    if (bT !== aT) return bT - aT;
    return fallback(a, b);
  };

export const byOrderKey: SortFunc<string | undefined> = (a, b) => {
  if (!a && !b) {
    return 0;
  }

  if (!b) return -1;
  if (!a) return 1;

  if (a < b) {
    return -1;
  }
  return 1;
};
