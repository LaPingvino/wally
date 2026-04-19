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
