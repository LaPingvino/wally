import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

export const keyboardShortcutsHelpAtom = atom<boolean>(false);
// Set to true to open Settings at the Keyboard Shortcuts page
export const openSettingsAtKeyboardShortcutsAtom = atom<boolean>(false);
// Set to true to open Settings at the Devices page
export const openSettingsAtDevicesAtom = atom<boolean>(false);
// Maps shortcut description → custom key string (is-hotkey format, e.g. 'mod+k')
export const customShortcutKeysAtom = atomWithStorage<Record<string, string>>(
  'wally_custom_bindings',
  {}
);
