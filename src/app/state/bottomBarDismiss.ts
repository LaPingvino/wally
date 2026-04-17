import { atom } from 'jotai';

/**
 * True when the user has dismissed the bottom action bar via its X.
 * Stays true until the user next invokes Previous/Next Unread or Mention
 * from the room header menu (or keyboard shortcut) — any call to one of
 * useNavigateUnread's step functions clears this. Active/incoming calls
 * force-show the bar regardless.
 */
export const bottomBarDismissedAtom = atom<boolean>(false);
