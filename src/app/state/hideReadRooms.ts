import { atomWithStorage } from 'jotai/utils';

/**
 * When true, the sidebar room lists (Home, Direct, Space) hide rooms
 * with no unread messages. Toggled from a button at the start of the
 * bottom unread navigation bar. Persisted so it survives reloads.
 *
 * Why: reduces visual jumping and mental load when triaging unreads
 * via Prev/Next — the list stops shuffling as rooms are read.
 */
export const hideReadRoomsAtom = atomWithStorage<boolean>(
  'cinny_hide_read_rooms',
  false
);
