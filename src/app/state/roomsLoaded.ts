import { atom, useSetAtom } from 'jotai';
import { MatrixClient, SyncState } from 'matrix-js-sdk';
import { useCallback, useEffect, useRef } from 'react';
import { useSyncState } from '../hooks/useSyncState';

/**
 * Has the initial sliding-sync room load SETTLED this session?
 *
 * Sliding sync discovers rooms incrementally (the window grows over several polls), so for a
 * while we don't yet know about every room — including unread ones. Aggregate badges (space /
 * folder totals) can't be trusted during that phase: they'd show a premature partial sum, then
 * flip back to a dot when a late-loading unread room appears. So aggregates render a DOT until
 * this flips true, then the real total. (Per-room badges don't need this — each resolves on its
 * own as it goes live.)
 *
 * `false` until the loaded room count stops growing for {@link SETTLE_POLLS} consecutive syncs,
 * then `true` for the rest of the session. Mirrors the heuristic the SyncStatus banner uses.
 */
const baseRoomsLoadedAtom = atom(false);
export const roomsLoadedAtom = atom<boolean, [boolean], undefined>(
  (get) => get(baseRoomsLoadedAtom),
  (get, set, value) => {
    set(baseRoomsLoadedAtom, value);
  }
);

/** Consecutive non-growing polls before the initial load is called "settled". */
const SETTLE_POLLS = 2;

export const useBindRoomsLoadedAtom = (mx: MatrixClient, loadedAtom: typeof roomsLoadedAtom) => {
  const setLoaded = useSetAtom(loadedAtom);
  const lastCountRef = useRef(mx.getRooms().length);
  const stablePollsRef = useRef(0);
  const settledRef = useRef(false);

  // Reset on client change (account switch / re-login): the new session starts un-settled, so a
  // stale `true` doesn't reveal premature aggregate totals before the new account has loaded.
  useEffect(() => {
    settledRef.current = false;
    stablePollsRef.current = 0;
    lastCountRef.current = mx.getRooms().length;
    setLoaded(false);
  }, [mx, setLoaded]);

  useSyncState(
    mx,
    useCallback(
      (current) => {
        if (settledRef.current) return;
        if (
          current !== SyncState.Prepared &&
          current !== SyncState.Syncing &&
          current !== SyncState.Catchup
        ) {
          return;
        }
        const count = mx.getRooms().length;
        if (count > lastCountRef.current) {
          // Window still growing — reset the quiet-poll counter.
          lastCountRef.current = count;
          stablePollsRef.current = 0;
          return;
        }
        if (count === 0) return; // nothing yet — still connecting
        stablePollsRef.current += 1;
        if (stablePollsRef.current >= SETTLE_POLLS) {
          settledRef.current = true;
          setLoaded(true);
        }
      },
      [mx, setLoaded]
    )
  );
};
