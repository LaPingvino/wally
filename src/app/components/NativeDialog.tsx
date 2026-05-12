import React, { useRef, useEffect, ReactNode, useCallback, useState } from 'react';
import { PopOutContainerProvider } from 'folds';

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
  // Once the dialog mounts we expose it as the PopOut portal container so
  // dropdowns / menus inside the modal render *inside* the dialog. The
  // browser marks everything outside an open <dialog> as inert when
  // showModal() is used — without this, portaled menus are non-clickable.
  const [popoutContainer, setPopoutContainer] = useState<HTMLDialogElement | undefined>(undefined);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      setPopoutContainer(dialog);
    } else if (!open && dialog.open) {
      dialog.close();
      setPopoutContainer(undefined);
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
      <PopOutContainerProvider value={popoutContainer}>{children}</PopOutContainerProvider>
    </dialog>
  );
}
