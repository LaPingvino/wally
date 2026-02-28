import { atom } from 'jotai';

export const searchModalAtom = atom<boolean>(false);
// Set this to a non-empty string before setting searchModalAtom=true to pre-populate the search input.
export const searchModalInitialCharAtom = atom<string>('');
