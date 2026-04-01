import React, { useRef, useEffect, ReactNode, useCallback } from 'react';

interface NativeDialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Thin wrapper around the native <dialog> element with showModal().
 *
 * Replaces the Overlay + OverlayBackdrop + OverlayCenter + FocusTrap pattern
 * with built-in browser features:
 * - Focus trapping (automatic with showModal)
 * - Backdrop (::backdrop pseudo-element)
 * - Escape to close (cancel event)
 * - Inert background (everything behind is non-interactive)
 * - Return focus on close (browser handles this)
 */
export function NativeDialog({ open, onClose, children, className, style }: NativeDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleCancel = useCallback(
    (e: React.SyntheticEvent<HTMLDialogElement>) => {
      e.preventDefault();
      onClose();
    },
    [onClose]
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      // Only close if clicking the backdrop (the dialog element itself), not its children
      if (e.target === ref.current) {
        onClose();
      }
    },
    [onClose]
  );

  return (
    <dialog
      ref={ref}
      className={className}
      style={style}
      onCancel={handleCancel}
      onClick={handleBackdropClick}
    >
      {children}
    </dialog>
  );
}
