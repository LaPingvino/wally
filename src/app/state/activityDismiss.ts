import { atomWithStorage } from 'jotai/utils';

/**
 * Timestamp (ms since epoch) such that any activity event with ts <= this
 * is considered dismissed from the Activity inbox. Set by "Mark all as
 * read" on the Activity page. Persisted in localStorage so the dismissal
 * survives reloads.
 */
export const activityDismissedBeforeAtom = atomWithStorage<number>(
  'cinny_activity_dismissed_before',
  0
);

/**
 * Per-entry dismissals: map from collapse key (e.g. `sender:profile-name`)
 * to the dismiss timestamp. An entry is hidden iff its representative event's
 * ts is less than or equal to the dismiss timestamp; newer events for the
 * same key re-surface it.
 */
export const activityDismissedItemsAtom = atomWithStorage<Record<string, number>>(
  'cinny_activity_dismissed_items',
  {}
);
