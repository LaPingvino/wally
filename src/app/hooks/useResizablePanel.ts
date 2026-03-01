import { useCallback, useRef, useState } from 'react';
import React from 'react';

export function useResizablePanel(
  defaultWidth: number,
  minWidth: number,
  maxWidth: number,
  storageKey?: string,
): { width: number; onDividerPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void } {
  const getInitial = () => {
    if (!storageKey) return defaultWidth;
    const s = localStorage.getItem(storageKey);
    return s ? Math.max(minWidth, Math.min(maxWidth, Number(s))) : defaultWidth;
  };
  const widthRef = useRef<number>(getInitial());
  const [width, setWidth] = useState<number>(widthRef.current);

  const onDividerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startWidth = widthRef.current;
      const onMove = (me: PointerEvent) => {
        // Divider is LEFT of panel → drag left = wider
        const w = Math.max(minWidth, Math.min(maxWidth, startWidth - (me.clientX - startX)));
        widthRef.current = w;
        setWidth(w);
      };
      const onUp = () => {
        if (storageKey) localStorage.setItem(storageKey, String(widthRef.current));
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [minWidth, maxWidth, storageKey],
  );

  return { width, onDividerPointerDown };
}
