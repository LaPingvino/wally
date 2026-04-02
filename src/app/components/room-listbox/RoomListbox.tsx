import React, { ReactNode } from 'react';

interface RoomListboxProps {
  'aria-label': string;
  items: string[];
  focusedIndex: number;
  children: ReactNode;
}

/**
 * Semantic listbox wrapper for room items.
 * Keyboard handling and focus live on the parent PageNavContent scroll container
 * (which has the id, tabIndex, onKeyDown, onFocus). This component provides
 * role="listbox" and aria-activedescendant for screen readers.
 */
export function RoomListbox({
  'aria-label': ariaLabel,
  items,
  focusedIndex,
  children,
}: RoomListboxProps) {
  const activedescendant =
    focusedIndex >= 0 && items[focusedIndex]
      ? `room-option-${items[focusedIndex]}`
      : undefined;

  return (
    <div
      role="listbox"
      aria-label={ariaLabel}
      aria-activedescendant={activedescendant}
      aria-orientation="vertical"
    >
      {children}
    </div>
  );
}
