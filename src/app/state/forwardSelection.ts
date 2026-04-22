import { atom } from 'jotai';

export type ForwardSelection = {
  roomId: string;
  eventIds: string[];
};

export const forwardSelectionAtom = atom<ForwardSelection | null>(null);
