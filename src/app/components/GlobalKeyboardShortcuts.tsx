import React, { useCallback } from 'react';
import { useNavigate, useLocation, matchPath } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { isKeyHotkey } from 'is-hotkey';
import { useGlobalKeyboardShortcuts } from '../hooks/useGlobalKeyboardShortcuts';
import { useCallState } from '../pages/client/call/CallProvider';

type DisplayShortcut = {
  key: string;
  description: string;
  category: 'Navigation' | 'Search' | 'Actions' | 'Help';
  allowInEditable?: boolean;
};
import { useKeyDown } from '../hooks/useKeyDown';
import { stopPropagation } from '../utils/keyboard';
import { useOrphanSpaces } from '../state/hooks/roomList';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { roomToParentsAtom } from '../state/room/roomToParents';
import { allRoomsAtom } from '../state/room-list/roomList';
import { useSidebarItems } from '../hooks/useSidebarItems';
import { getSpaceLobbyPath, getDirectRoomPath, getHomeRoomPath, getSpaceRoomPath } from '../pages/pathUtils';
import { HOME_ROOM_PATH, DIRECT_ROOM_PATH, SPACE_ROOM_PATH } from '../pages/paths';
import { getCanonicalAliasOrRoomId } from '../utils/matrix';
import { announce } from '../utils/announce';
import { useSetSetting } from '../state/hooks/settings';
import { settingsAtom } from '../state/settings';
import { getSecondarySessions } from '../state/sessions';
import { useClientConfig } from '../hooks/useClientConfig';
import { useNavigateUnread } from '../hooks/useNavigateUnread';

const CALL_SHORTCUTS: DisplayShortcut[] = [
  { key: 'mod+shift+m', description: 'Toggle mute (in call)', category: 'Actions' },
  { key: 'mod+shift+v', description: 'Toggle video (in call)', category: 'Actions' },
  { key: 'mod+shift+h', description: 'End call', category: 'Actions' },
];

const SPACE_SHORTCUT: DisplayShortcut = {
  key: 'alt+1–9',
  description: 'Go to 1st–9th space',
  category: 'Navigation',
};

const NEXT_UNREAD_SHORTCUT: DisplayShortcut = {
  key: 'alt+n',
  description: 'Go to next unread room',
  category: 'Navigation',
};


const START_CALL_SHORTCUT: DisplayShortcut = {
  key: 'alt+j',
  description: 'Start or join call in current room',
  category: 'Actions',
};

const ACCOUNT_SWITCH_SHORTCUT: DisplayShortcut = {
  key: 'alt+shift+1–9',
  description: 'Switch to 1st–9th account',
  category: 'Navigation',
};

const NEXT_UNREAD_DOWN_SHORTCUT: DisplayShortcut = {
  key: 'alt+shift+down',
  description: 'Next unread room',
  category: 'Navigation',
};

const PREV_UNREAD_UP_SHORTCUT: DisplayShortcut = {
  key: 'alt+shift+up',
  description: 'Previous unread room',
  category: 'Navigation',
};

const PEOPLE_DRAWER_SHORTCUT: DisplayShortcut = {
  key: 'alt+p',
  description: 'Toggle members panel',
  category: 'Actions',
};

const THREADS_SHORTCUT: DisplayShortcut = {
  key: 'alt+shift+t',
  description: 'Toggle threads panel',
  category: 'Actions',
};

const SEARCH_ROOM_SHORTCUT: DisplayShortcut = {
  key: 'alt+f',
  description: 'Search in room',
  category: 'Search',
};

const CHAT_TOGGLE_SHORTCUT: DisplayShortcut = {
  key: 'alt+shift+c',
  description: 'Toggle chat panel (during call)',
  category: 'Actions',
};

const SECTION_NAV_SHORTCUT: DisplayShortcut = {
  key: 'f6',
  description: 'Move to next section',
  category: 'Navigation',
};

const SECTION_NAV_BACK_SHORTCUT: DisplayShortcut = {
  key: 'shift+f6',
  description: 'Move to previous section',
  category: 'Navigation',
};

const SECTION_LABELS: Record<string, string> = {
  'cinny-room-listbox': 'Room list',
  'cinny-lobby': 'Space lobby',
  'cinny-timeline': 'Message timeline',
  'cinny-members-panel': 'Members panel',
  'cinny-threads-panel': 'Threads panel',
};

function findSidebarFocus(): HTMLElement | null {
  const nav = document.querySelector<HTMLElement>('[aria-label="Main navigation"]');
  if (!nav) return null;
  // Roving tabindex: active item has tabIndex=0; fall back to first button
  return (
    nav.querySelector<HTMLElement>('[tabindex="0"]') ??
    nav.querySelector<HTMLElement>('button:not([disabled])')
  );
}

// Fixed sections that need special focus handling (roving tabindex, child-button targeting, etc.)
// Panels with role="region" + aria-label are auto-discovered by getRegionSections() below.
const SECTION_FINDERS: Array<() => HTMLElement | null> = [
  findSidebarFocus,
  () => {
    const listbox = document.querySelector<HTMLElement>('#cinny-room-listbox');
    if (!listbox) return null;
    // Focus the first focusable room item inside the listbox, not the container.
    // NavButton renders as <button> inside NavItem[role="option"].
    return listbox.querySelector<HTMLElement>('button, a[href], [tabindex="0"]') ?? listbox;
  },
  // First enabled button in the room header toolbar (skips disabled buttons)
  () => document.querySelector<HTMLElement>('#cinny-room-header-toolbar button:not([disabled])'),
  () => document.querySelector('#cinny-timeline'),
  () => document.querySelector('[data-slate-editor="true"]'),
];

/**
 * Auto-discovers visible ARIA region landmarks so new panels (widgets, issues, etc.)
 * are included in F6 cycling without any changes here — they just need
 * role="region" + aria-label + tabIndex={-1} on their root element.
 * Sorted top-to-bottom, left-to-right by their on-screen position.
 */
function getRegionSections(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="region"][aria-label]'))
    .filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })
    .sort((a, b) => {
      const rA = a.getBoundingClientRect();
      const rB = b.getBoundingClientRect();
      return rA.left !== rB.left ? rA.left - rB.left : rA.top - rB.top;
    });
}

export function GlobalKeyboardShortcuts() {
  const navigate = useNavigate();
  useGlobalKeyboardShortcuts();
  const { hangUp, toggleAudio, toggleVideo, activeCallRoomId, setActiveCallRoomId } = useCallState();
  const setPeopleDrawer = useSetSetting(settingsAtom, 'isPeopleDrawer');
  const { navigateNext: navigateNextUnread, navigatePrev: navigatePrevUnread, navigateFirst: navigateFirstUnread } = useNavigateUnread();
  const mx = useMatrixClient();
  const roomToParents = useAtomValue(roomToParentsAtom);
  const orphanSpaces = useOrphanSpaces(mx, allRoomsAtom, roomToParents);
  const [sidebarItems] = useSidebarItems(orphanSpaces);
  const spaceIds = sidebarItems.filter((item): item is string => typeof item === 'string');
  // GlobalKeyboardShortcuts is rendered outside the room routes, so useParams() never
  // returns roomIdOrAlias. Use useLocation() + matchPath() to get it from the URL directly.
  const location = useLocation();
  const roomMatch =
    matchPath(HOME_ROOM_PATH, location.pathname) ??
    matchPath(DIRECT_ROOM_PATH, location.pathname) ??
    matchPath(SPACE_ROOM_PATH, location.pathname);
  const roomIdOrAlias = roomMatch?.params.roomIdOrAlias
    ? decodeURIComponent(roomMatch.params.roomIdOrAlias)
    : undefined;
  const currentRoomId = roomIdOrAlias
    ? roomIdOrAlias.startsWith('!')
      ? roomIdOrAlias
      : mx.getRooms().find((r) => r.getCanonicalAlias() === roomIdOrAlias)?.roomId ?? null
    : null;

  const handleCallKeyDown = useCallback(
    (evt: KeyboardEvent) => {
      if (!activeCallRoomId) return;
      if (!stopPropagation(evt)) return;
      if (isKeyHotkey('mod+shift+m', evt)) {
        evt.preventDefault();
        toggleAudio();
      } else if (isKeyHotkey('mod+shift+v', evt)) {
        evt.preventDefault();
        toggleVideo();
      } else if (isKeyHotkey('mod+shift+h', evt)) {
        evt.preventDefault();
        hangUp();
      }
    },
    [activeCallRoomId, hangUp, toggleAudio, toggleVideo]
  );

  const handleSpaceKeyDown = useCallback(
    (evt: KeyboardEvent) => {
      for (let n = 1; n <= 9; n++) {
        if (isKeyHotkey(`alt+${n}`, evt)) {
          const spaceId = spaceIds[n - 1];
          if (spaceId) {
            evt.preventDefault();
            navigate(getSpaceLobbyPath(getCanonicalAliasOrRoomId(mx, spaceId)));
            announce(`${mx.getRoom(spaceId)?.name ?? 'Space'} space`);
            setTimeout(() => document.getElementById('cinny-room-listbox')?.focus(), 80);
          }
          return;
        }
      }
    },
    [mx, navigate, spaceIds]
  );

  const handleNextUnreadKeyDown = useCallback(
    (evt: KeyboardEvent) => {
      if (!isKeyHotkey('alt+n', evt)) return;
      evt.preventDefault();
      navigateFirstUnread();
    },
    [navigateFirstUnread]
  );

const handleUnreadNavKeyDown = useCallback(
    (evt: KeyboardEvent) => {
      const isDown = isKeyHotkey('alt+shift+down', evt);
      const isUp = isKeyHotkey('alt+shift+up', evt);
      if (!isDown && !isUp) return;
      evt.preventDefault();
      if (isDown) navigateNextUnread();
      else navigatePrevUnread();
    },
    [navigateNextUnread, navigatePrevUnread]
  );

  const handleStartCallKeyDown = useCallback(
    (evt: KeyboardEvent) => {
      if (!isKeyHotkey('alt+j', evt)) return;
      if (!currentRoomId) return;
      evt.preventDefault();
      setActiveCallRoomId(currentRoomId, true);
    },
    [currentRoomId, setActiveCallRoomId]
  );

  const handlePeopleDrawerKeyDown = useCallback(
    (evt: KeyboardEvent) => {
      if (!isKeyHotkey('alt+p', evt)) return;
      evt.preventDefault();
      setPeopleDrawer((v) => !v);
    },
    [setPeopleDrawer]
  );

  const handleSectionTabKeyDown = useCallback((evt: KeyboardEvent) => {
    const isForward = isKeyHotkey('f6', evt);
    const isBackward = isKeyHotkey('shift+f6', evt);
    if (!isForward && !isBackward) return;

    const fixed = SECTION_FINDERS.map((fn) => fn()).filter((el): el is HTMLElement => el !== null);
    // Merge auto-discovered region landmarks, excluding any already covered by a fixed section
    const regions = getRegionSections().filter(
      (el) => !fixed.some((f) => f === el || f.contains(el) || el.contains(f))
    );
    // Sort the combined list by on-screen position (top→bottom, left→right)
    const sections = [...fixed, ...regions].sort((a, b) => {
      const rA = a.getBoundingClientRect();
      const rB = b.getBoundingClientRect();
      return rA.left !== rB.left ? rA.left - rB.left : rA.top - rB.top;
    });
    if (sections.length === 0) return;
    evt.preventDefault();

    const focused = document.activeElement;
    const currentIndex = sections.findIndex((el) => el === focused || el.contains(focused as Node));
    const step = isForward ? 1 : -1;
    const nextIndex =
      currentIndex === -1 ? 0 : (currentIndex + step + sections.length) % sections.length;

    const target = sections[nextIndex];
    target.focus();

    const label =
      SECTION_LABELS[target.id] ??
      target.closest<HTMLElement>('[data-section-label]')?.getAttribute('data-section-label') ??
      target.getAttribute('aria-label') ??
      'Section';
    announce(label);
  }, []);

  const { hashRouter } = useClientConfig();
  const hasMainSession =
    !!localStorage.getItem('cinny_hs_base_url') && !!localStorage.getItem('cinny_user_id');
  const secondarySessions = getSecondarySessions();

  const handleAccountSwitchKeyDown = useCallback(
    (evt: KeyboardEvent) => {
      const slots: Array<number | null> = [
        ...(hasMainSession ? [null] : []),
        ...secondarySessions.map(({ slot }) => slot),
      ];
      if (slots.length <= 1) return;
      if (!evt.altKey || !evt.shiftKey || evt.ctrlKey || evt.metaKey) return;
      const n = parseInt(evt.key, 10);
      if (isNaN(n) || n < 1 || n > 9) return;
      const target = slots[n - 1];
      if (target === undefined) return;
      evt.preventDefault();
      if (target === null) {
        sessionStorage.removeItem('cinny-account-slot');
        if (hashRouter?.enabled) window.location.reload();
        else window.location.assign('/');
      } else {
        sessionStorage.setItem('cinny-account-slot', String(target));
        if (hashRouter?.enabled) window.location.reload();
        else window.location.assign(`/account/${target}/`);
      }
    },
    [hasMainSession, secondarySessions, hashRouter]
  );

  useKeyDown(window, handleCallKeyDown);
  useKeyDown(window, handleSpaceKeyDown);
  useKeyDown(window, handleNextUnreadKeyDown);
  useKeyDown(window, handleUnreadNavKeyDown);
  useKeyDown(window, handleStartCallKeyDown);
  useKeyDown(window, handlePeopleDrawerKeyDown);
  useKeyDown(window, handleSectionTabKeyDown);
  useKeyDown(window, handleAccountSwitchKeyDown);

  return null;
}
