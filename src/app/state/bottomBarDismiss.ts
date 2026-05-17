import { atom } from 'jotai';

/**
 * True when the bottom action bar is hidden. Starts true so the bar
 * doesn't clutter the sidebar until the user actively engages unread
 * navigation. Cleared by useNavigateUnread's step functions (Previous /
 * Next / First Unread) — once the user starts triaging, the bar sticks
 * around for the duration. The X button re-dismisses. Active/incoming
 * calls force-show the bar regardless.
 */
export const bottomBarDismissedAtom = atom<boolean>(true);
