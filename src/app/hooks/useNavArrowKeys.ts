import { useCallback, RefObject } from 'react';

/**
 * Arrow-key navigation for all focusable items inside a scrollable container.
 * Works across static NavItems, Favorites, and virtualized room items.
 * Attach the returned onKeyDown to the scroll container element.
 */
// Only target primary navigation elements (NavButton, NavLink) — not nested
// action buttons inside room items (call, chat, more options).
const FOCUSABLE = '[data-nav-item]';

export function useNavArrowKeys(scrollRef: RefObject<HTMLElement | null>) {
  return useCallback(
    (evt: React.KeyboardEvent | KeyboardEvent) => {
      if (evt.key !== 'ArrowDown' && evt.key !== 'ArrowUp') return;
      if (evt.ctrlKey || evt.altKey || evt.metaKey || evt.shiftKey) return;
      const container = scrollRef.current;
      if (!container) return;

      const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
      const active = document.activeElement as HTMLElement;
      const idx = items.indexOf(active);
      // Only handle when focus is already inside the container
      if (idx < 0 && !container.contains(active)) return;

      evt.preventDefault();
      let next: number;
      if (idx < 0) {
        next = 0;
      } else if (evt.key === 'ArrowDown') {
        next = Math.min(idx + 1, items.length - 1);
      } else {
        next = Math.max(idx - 1, 0);
      }
      items[next]?.focus({ preventScroll: true });
      items[next]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    [scrollRef]
  );
}
