import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import { isKeyHotkey } from 'is-hotkey';
import { useKeyDown } from './useKeyDown';
import { stopPropagation } from '../utils/keyboard';
import { openSettingsAtKeyboardShortcutsAtom, customShortcutKeysAtom } from '../state/keyboardShortcutsHelp';
import { searchModalAtom } from '../state/searchModal';
import { getFavoritesPath, getHomePath, getDirectPath, getInboxNotificationsPath } from '../pages/pathUtils';

export interface KeyboardShortcut {
  key: string;
  defaultKey: string;
  description: string;
  category: 'Navigation' | 'Search' | 'Actions' | 'Help';
  /** If true, shortcut fires even when focus is inside an input/textarea/editor */
  allowInEditable?: boolean;
  action: () => void;
}

/** Static shortcut metadata — used by the settings page to show/edit bindings */
export type ShortcutDefinition = Omit<KeyboardShortcut, 'action' | 'key'>;
export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  { defaultKey: 'mod+k', description: 'Search', category: 'Search' },
  { defaultKey: 'alt+r', description: 'Focus room list', category: 'Navigation', allowInEditable: true },
  { defaultKey: 'alt+t', description: 'Focus message timeline', category: 'Navigation', allowInEditable: true },
  { defaultKey: 'alt+c', description: 'Focus message composer', category: 'Navigation', allowInEditable: true },
  { defaultKey: 'alt+h', description: 'Go to Home', category: 'Navigation', allowInEditable: true },
  { defaultKey: 'alt+d', description: 'Go to Direct Messages', category: 'Navigation', allowInEditable: true },
  { defaultKey: 'alt+f', description: 'Go to Favorites', category: 'Navigation', allowInEditable: true },
  { defaultKey: 'alt+i', description: 'Go to Inbox', category: 'Navigation', allowInEditable: true },
  { defaultKey: 'mod+/', description: 'Show keyboard shortcuts', category: 'Help' },
];

const focusSection = (selector: string) => {
  const el = document.querySelector(selector) as HTMLElement | null;
  el?.focus();
};

export const useGlobalKeyboardShortcuts = () => {
  const navigate = useNavigate();
  const setOpenAtKeyboardShortcuts = useSetAtom(openSettingsAtKeyboardShortcutsAtom);
  const setSearchModal = useSetAtom(searchModalAtom);
  const customKeys = useAtomValue(customShortcutKeysAtom);

  const shortcuts = useMemo<KeyboardShortcut[]>(
    () => {
      const c = (desc: string, defaultKey: string) => customKeys[desc] ?? defaultKey;
      return [
        {
          key: c('Search', 'mod+k'),
          defaultKey: 'mod+k',
          description: 'Search',
          category: 'Search',
          action: () => setSearchModal(true),
        },
        {
          key: c('Focus room list', 'alt+r'),
          defaultKey: 'alt+r',
          description: 'Focus room list',
          category: 'Navigation',
          allowInEditable: true,
          action: () => focusSection('#cinny-room-listbox'),
        },
        {
          key: c('Focus message timeline', 'alt+t'),
          defaultKey: 'alt+t',
          description: 'Focus message timeline',
          category: 'Navigation',
          allowInEditable: true,
          action: () => focusSection('#cinny-timeline'),
        },
        {
          key: c('Focus message composer', 'alt+c'),
          defaultKey: 'alt+c',
          description: 'Focus message composer',
          category: 'Navigation',
          allowInEditable: true,
          action: () => focusSection('[data-slate-editor="true"]'),
        },
        {
          key: c('Go to Home', 'alt+h'),
          defaultKey: 'alt+h',
          description: 'Go to Home',
          category: 'Navigation',
          allowInEditable: true,
          action: () => navigate(getHomePath()),
        },
        {
          key: c('Go to Direct Messages', 'alt+d'),
          defaultKey: 'alt+d',
          description: 'Go to Direct Messages',
          category: 'Navigation',
          allowInEditable: true,
          action: () => navigate(getDirectPath()),
        },
        {
          key: c('Go to Favorites', 'alt+f'),
          defaultKey: 'alt+f',
          description: 'Go to Favorites',
          category: 'Navigation',
          allowInEditable: true,
          action: () => navigate(getFavoritesPath()),
        },
        {
          key: c('Go to Inbox', 'alt+i'),
          defaultKey: 'alt+i',
          description: 'Go to Inbox',
          category: 'Navigation',
          allowInEditable: true,
          action: () => navigate(getInboxNotificationsPath()),
        },
        {
          key: c('Show keyboard shortcuts', 'mod+/'),
          defaultKey: 'mod+/',
          description: 'Show keyboard shortcuts',
          category: 'Help',
          action: () => setOpenAtKeyboardShortcuts(true),
        },
      ];
    },
    [navigate, setOpenAtKeyboardShortcuts, setSearchModal, customKeys]
  );

  const handleKeyDown = useCallback(
    (evt: KeyboardEvent) => {
      const inEditable = !stopPropagation(evt);

      for (const shortcut of shortcuts) {
        // isKeyHotkey uses evt.key which on Linux can produce composed
        // characters for Alt+key (e.g. Alt+R → '®'). Fall back to
        // matching via evt.code when Alt is held.
        let matches = isKeyHotkey(shortcut.key, evt);
        if (!matches && evt.altKey && shortcut.key.startsWith('alt+')) {
          const expectedKey = shortcut.key.replace(/^alt\+/, '').toLowerCase();
          const codeKey = evt.code.replace(/^Key/, '').toLowerCase();
          matches = codeKey === expectedKey;
        }
        if (!matches) continue;
        if (inEditable && !shortcut.allowInEditable) continue;
        evt.preventDefault();
        shortcut.action();
        return;
      }
    },
    [shortcuts]
  );

  useKeyDown(window, handleKeyDown);

  return { shortcuts };
};
