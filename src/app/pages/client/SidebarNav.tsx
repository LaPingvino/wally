import React, { KeyboardEventHandler, useCallback, useRef } from 'react';
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

  // Arrow key navigation between sidebar buttons (roving focus)
  const handleNavKeyDown: KeyboardEventHandler = useCallback((evt) => {
    if (evt.key !== 'ArrowUp' && evt.key !== 'ArrowDown') return;
    const nav = navRef.current;
    if (!nav) return;
    const buttons = Array.from(
      nav.querySelectorAll<HTMLElement>('button:not([disabled]), [role="button"]:not([aria-disabled="true"])')
    );
    const current = buttons.indexOf(evt.target as HTMLElement);
    if (current < 0) return;

    evt.preventDefault();
    const next = evt.key === 'ArrowDown'
      ? (current + 1) % buttons.length
      : (current - 1 + buttons.length) % buttons.length;
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
