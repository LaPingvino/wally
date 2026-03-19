import React, { ReactNode } from 'react';

interface RoomListboxProps {
  id?: string;
  'aria-label': string;
  items: string[];
  focusedIndex: number;
  // keyboard handling is done by PageNavContent's useNavArrowKeys
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  onFocus?: React.FocusEventHandler<HTMLDivElement>;
  children: ReactNode;
}

export function RoomListbox({
  id,
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
      id={id}
      role="listbox"
      aria-label={ariaLabel}
      aria-activedescendant={activedescendant}
      aria-orientation="vertical"
    >
      {children}
    </div>
  );
}
