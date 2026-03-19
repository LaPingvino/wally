import React, { KeyboardEventHandler, useCallback, useEffect, useRef } from 'react';
import { Scroll } from 'folds';

import {
  Sidebar,
  SidebarContent,
  SidebarStackSeparator,
  SidebarStack,
} from '../../components/sidebar';
import {
  DirectTab,
  FavoritesTab,
  HomeTab,
  SpaceTabs,
  InboxTab,
  ExploreTab,
  SettingsTab,
  UnverifiedTab,
  SearchTab,
} from './sidebar';
import { CreateTab } from './sidebar/CreateTab';

export function SidebarNav() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);

  // Roving tabindex: only one sidebar button is tabbable at a time (tabIndex=0).
  // All others get tabIndex=-1 so the sidebar is a single Tab stop. Arrow keys
  // move focus within it. This matches the WAI-ARIA toolbar pattern.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const id = setTimeout(() => {
      const allBtns = Array.from(
        nav.querySelectorAll<HTMLElement>('button:not([disabled])')
      );
      allBtns.forEach((b, i) => b.setAttribute('tabindex', i === 0 ? '0' : '-1'));
    }, 0);
    return () => clearTimeout(id);
  }, []);

  const handleNavKeyDown: KeyboardEventHandler = useCallback((evt) => {
    if (evt.key !== 'ArrowUp' && evt.key !== 'ArrowDown') return;
    const nav = navRef.current;
    if (!nav) return;
    const buttons = Array.from(
      nav.querySelectorAll<HTMLElement>('button:not([disabled])')
    );
    const current = buttons.indexOf(evt.target as HTMLElement);
    if (current < 0) return;

    evt.preventDefault();
    const next = evt.key === 'ArrowDown'
      ? (current + 1) % buttons.length
      : (current - 1 + buttons.length) % buttons.length;

    // Move roving tabindex
    buttons[current]?.setAttribute('tabindex', '-1');
    buttons[next]?.setAttribute('tabindex', '0');
    buttons[next]?.focus();
  }, []);

  return (
    <Sidebar as="nav" aria-label="Main navigation" ref={navRef} onKeyDown={handleNavKeyDown}>
      <SidebarContent
        scrollable={
          <Scroll ref={scrollRef} variant="Background" size="0">
            <SidebarStack>
              <HomeTab />
              <DirectTab />
              <FavoritesTab />
            </SidebarStack>
            <SpaceTabs scrollRef={scrollRef} />
            <SidebarStackSeparator />
            <SidebarStack>
              <ExploreTab />
              <CreateTab />
            </SidebarStack>
          </Scroll>
        }
        sticky={
          <>
            <SidebarStackSeparator />
            <SidebarStack>
              <SearchTab />
              <UnverifiedTab />
              <InboxTab />
              <SettingsTab />
            </SidebarStack>
          </>
        }
      />
    </Sidebar>
  );
}
