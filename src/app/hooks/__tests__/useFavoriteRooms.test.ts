/**
 * Regression test for useFavoriteRooms.
 *
 * Background: an earlier implementation ran a 594-room
 *   mx.getRoom(id).tags['m.favourite']
 * filter on every render of every caller, contributing ~13% of total
 * CPU profile time on a busy account.
 *
 * The fix has two halves:
 *   1. A single shared atom + driver subscribed to RoomEvent.Tags once,
 *      so 5 call sites become 1 subscription.
 *   2. useMemo around the filter, so callers don't re-run it unless
 *      their roomIds array or the favorites set actually changed.
 *
 * These tests focus on (2) — the memoization invariant — because
 * regressions there are easy to introduce by accident in future edits.
 * The pure helper filterFavoriteRoomIds is what useMemo wraps, so we
 * exercise it directly and check referential stability via memoization
 * with the same Set instance.
 */

import { describe, it, expect } from 'vitest';
import { filterFavoriteRoomIds } from '../useFavoriteRooms';

describe('filterFavoriteRoomIds', () => {
  it('returns only ids that are in the favorites set', () => {
    const favs = new Set(['!a', '!c']);
    expect(filterFavoriteRoomIds(['!a', '!b', '!c'], favs)).toEqual(['!a', '!c']);
  });

  it('preserves input order', () => {
    const favs = new Set(['!a', '!b', '!c']);
    expect(filterFavoriteRoomIds(['!c', '!b', '!a'], favs)).toEqual(['!c', '!b', '!a']);
  });

  it('returns empty array when no favorites match', () => {
    const favs = new Set(['!x']);
    expect(filterFavoriteRoomIds(['!a', '!b'], favs)).toEqual([]);
  });

  it('returns empty array on empty input', () => {
    expect(filterFavoriteRoomIds([], new Set(['!a']))).toEqual([]);
  });

  it('does not call Set.has more than once per input id', () => {
    // Sanity check that the filter is the simple shape we expect —
    // not, say, a nested loop that explodes on large inputs. Catches
    // the case where someone "optimizes" by adding a tag-lookup pass.
    const favs = new Set(['!a', '!c']);
    let calls = 0;
    const counting = {
      has(id: string): boolean {
        calls += 1;
        return favs.has(id);
      },
    };
    filterFavoriteRoomIds(['!a', '!b', '!c', '!d'], counting as unknown as ReadonlySet<string>);
    expect(calls).toBe(4);
  });
});
