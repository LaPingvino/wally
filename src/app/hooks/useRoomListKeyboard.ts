import { useCallback, useEffect, useState } from 'react';
import { Virtualizer } from '@tanstack/react-virtual';
import { isKeyHotkey } from 'is-hotkey';

interface UseRoomListKeyboardOptions {
  items: string[];
  selectedRoomId: string | undefined;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  onNavigate: (roomId: string) => void;
  enabled?: boolean;
  onTypeChar?: (key: string) => void;
}

export const useRoomListKeyboard = ({
  items,
  selectedRoomId,
  virtualizer,
  onNavigate,
  enabled = true,
  onTypeChar,
}: UseRoomListKeyboardOptions) => {
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  useEffect(() => {
    if (focusedIndex >= items.length) {
      setFocusedIndex(items.length - 1);
    }
  }, [items.length, focusedIndex]);

  // Called when the listbox div receives focus (e.g. via Tab)
  const handleFocus = useCallback(() => {
    if (focusedIndex < 0) {
      const selectedIndex = selectedRoomId ? items.indexOf(selectedRoomId) : 0;
      const idx = selectedIndex >= 0 ? selectedIndex : 0;
      setFocusedIndex(idx);
      virtualizer.scrollToIndex(idx, { align: 'auto' });
    }
  }, [focusedIndex, items, selectedRoomId, virtualizer]);

  const handleKeyDown = useCallback(
    (evt: React.KeyboardEvent<HTMLDivElement>) => {
      if (!enabled) return;

      if (isKeyHotkey('arrowdown', evt)) {
        evt.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev < 0 ? 0 : Math.min(prev + 1, items.length - 1);
          virtualizer.scrollToIndex(next, { align: 'auto' });
          return next;
        });
        return;
      }

      if (isKeyHotkey('arrowup', evt)) {
        evt.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev < 0 ? items.length - 1 : Math.max(prev - 1, 0);
          virtualizer.scrollToIndex(next, { align: 'auto' });
          return next;
        });
        return;
      }

      if (isKeyHotkey('home', evt)) {
        evt.preventDefault();
        setFocusedIndex(0);
        virtualizer.scrollToIndex(0, { align: 'start' });
        return;
      }

      if (isKeyHotkey('end', evt)) {
        evt.preventDefault();
        const lastIndex = items.length - 1;
        setFocusedIndex(lastIndex);
        virtualizer.scrollToIndex(lastIndex, { align: 'end' });
        return;
      }

      if ((isKeyHotkey('enter', evt) || isKeyHotkey('space', evt)) && focusedIndex >= 0) {
        // Let child buttons (e.g. phone icon) handle their own Enter/Space
        if (evt.target !== evt.currentTarget) return;
        evt.preventDefault();
        const roomId = items[focusedIndex];
        if (roomId) {
          onNavigate(roomId);
        }
        return;
      }

      if (isKeyHotkey('pagedown', evt)) {
        evt.preventDefault();
        setFocusedIndex((prev) => {
          const next = Math.min(prev + 10, items.length - 1);
          virtualizer.scrollToIndex(next, { align: 'auto' });
          return next;
        });
        return;
      }

      if (isKeyHotkey('pageup', evt)) {
        evt.preventDefault();
        setFocusedIndex((prev) => {
          const next = Math.max(prev - 10, 0);
          virtualizer.scrollToIndex(next, { align: 'auto' });
          return next;
        });
        return;
      }

      // Single printable character: redirect to search modal (via onTypeChar callback)
      if (evt.key.length === 1 && !evt.ctrlKey && !evt.altKey && !evt.metaKey && onTypeChar) {
        evt.preventDefault();
        onTypeChar(evt.key);
      }
    },
    [enabled, items, focusedIndex, virtualizer, onNavigate, onTypeChar]
  );

  return {
    focusedIndex,
    handleKeyDown,
    handleFocus,
    setFocusedIndex,
  };
};
