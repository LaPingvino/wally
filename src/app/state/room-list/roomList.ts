import { atom } from 'jotai';
import { MatrixClient } from 'matrix-js-sdk';
import { useMemo } from 'react';
import { Membership } from '../../../types/matrix/room';
import { RoomsAction, useBindRoomsWithMembershipsAtom } from './utils';
import { makeThrottledAtom } from '../throttledAtom';

const baseRoomsAtom = atom<string[]>([]);
export const allRoomsAtom = atom<string[], [RoomsAction], undefined>(
  (get) => get(baseRoomsAtom),
  (get, set, action) => {
    if (action.type === 'INITIALIZE') {
      set(baseRoomsAtom, action.rooms);
      return;
    }
    if (action.type === 'PUT_BATCH') {
      const deleteSet = new Set(action.deletes);
      const putSet = new Set(action.puts);
      const ids = get(baseRoomsAtom).filter((id) => !deleteSet.has(id) && !putSet.has(id));
      ids.push(...action.puts);
      set(baseRoomsAtom, ids);
      return;
    }
    set(baseRoomsAtom, (ids) => {
      const newIds = ids.filter((id) => id !== action.roomId);
      if (action.type === 'PUT') newIds.push(action.roomId);
      return newIds;
    });
  }
);
/**
 * Throttled read-only view of allRoomsAtom. See throttledAtom.ts.
 */
export const allRoomsThrottled = makeThrottledAtom(allRoomsAtom, 'allRooms', 100);

export const useBindAllRoomsAtom = (mx: MatrixClient, allRooms: typeof allRoomsAtom) => {
  useBindRoomsWithMembershipsAtom(
    mx,
    allRooms,
    useMemo(() => [Membership.Join], [])
  );
};
