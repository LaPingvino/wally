import { atom } from 'jotai';

// Whether the in-call chat panel is open. This file previously also held the
// Element Call embed atom (callEmbedAtom) + the CallEmbed instance; that whole
// chain was removed when calls moved to direct LiveKit and the EC iframe was
// retired, leaving only this live UI flag.
export const callChatAtom = atom<boolean>(false);
