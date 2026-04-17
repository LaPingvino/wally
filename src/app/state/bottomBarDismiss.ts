import { atom } from 'jotai';

/**
 * Timestamp (ms since epoch) until which the bottom action bar is suppressed
 * after the user dismissed it. Zero = not dismissed. Bar reappears when
 * Date.now() >= dismissedUntil, even if new calls/unreads arrive earlier —
 * per user spec: "minimum timeout of 5 minutes".
 */
export const bottomBarDismissedUntilAtom = atom<number>(0);

export const BOTTOM_BAR_DISMISS_MS = 5 * 60 * 1000;
