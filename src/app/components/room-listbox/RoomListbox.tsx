import React, { ReactNode } from 'react';

interface RoomListboxProps {
  id?: string;
  'aria-label': string;
  items: string[];
  focusedIndex: number;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  onFocus?: React.FocusEventHandler<HTMLDivElement>;
  children: ReactNode;
}

/**
 * Single tab-stop room list container.
 * Tab lands here; arrow keys move between rooms via aria-activedescendant.
 * Individual room items have tabIndex={-1} so they're not separate tab stops.
 */
export function RoomListbox({
  id,
  'aria-label': ariaLabel,
  items,
  focusedIndex,
  onKeyDown,
  onFocus,
  children,
}: RoomListboxProps) {
  const activedescendant =
    focusedIndex >= 0 && items[focusedIndex]
      ? `room-option-${items[focusedIndex]}`
      : undefined;

  return (
    <div
      id={id}
      role="listbox"
      aria-label={ariaLabel}
      aria-activedescendant={activedescendant}
      aria-orientation="vertical"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
    >
      {children}
    </div>
  );
}
