import React, { useCallback, useRef } from 'react';
import {
  Box,
  Text,
  config,
  Header,
  Scroll,
  IconButton,
  Icon,
  Icons,
  Modal,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
} from 'folds';
import { useAtom } from 'jotai';
import FocusTrap from 'focus-trap-react';
import { keyboardShortcutsHelpAtom } from '../../state/keyboardShortcutsHelp';
import { KeyboardShortcut } from '../../hooks/useGlobalKeyboardShortcuts';
import { stopPropagation } from '../../utils/keyboard';

interface KeyboardShortcutsHelpProps {
  shortcuts: KeyboardShortcut[];
}

function formatShortcut(key: string): string {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  return key
    .replace('mod', isMac ? 'Cmd' : 'Ctrl')
    .split('+')
    .map((k) => k.charAt(0).toUpperCase() + k.slice(1))
    .join('+');
}

// Render each key segment as its own <kbd> element for screen reader semantics.
function ShortcutKeys({ keyStr }: { keyStr: string }) {
  const formatted = formatShortcut(keyStr);
  // Handle ranges like "Alt+1–9" or "Alt+Shift+1–9" — treat as a single kbd
  if (formatted.includes('\u2013') || formatted.includes('\u2014')) {
    return <kbd style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{formatted}</kbd>;
  }
  const parts = formatted.split('+');
  return (
    <span aria-label={formatted}>
      {parts.map((part, i) => (
        <React.Fragment key={part}>
          <kbd style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{part}</kbd>
          {i < parts.length - 1 && (
            <span aria-hidden="true" style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>
              {'+'}
            </span>
          )}
        </React.Fragment>
      ))}
    </span>
  );
}

const TITLE_ID = 'kb-shortcuts-help-title';

export function KeyboardShortcutsHelp({ shortcuts }: KeyboardShortcutsHelpProps) {
  const [open, setOpen] = useAtom(keyboardShortcutsHelpAtom);
  const triggerRef = useRef<HTMLElement | null>(null);

  const handleOpen = useCallback(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    setTimeout(() => {
      if (triggerRef.current && document.body.contains(triggerRef.current)) {
        (triggerRef.current as HTMLElement).focus();
      }
      triggerRef.current = null;
    }, 50);
  }, [setOpen]);

  if (!open) return null;

  // Record trigger when first rendered (open just became true)
  if (!triggerRef.current) {
    handleOpen();
  }

  const groupedShortcuts = shortcuts.reduce(
    (acc, shortcut) => {
      if (!acc[shortcut.category]) acc[shortcut.category] = [];
      acc[shortcut.category].push(shortcut);
      return acc;
    },
    {} as Record<string, KeyboardShortcut[]>
  );

  return (
    <Overlay open={open} backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            onDeactivate: handleClose,
            clickOutsideDeactivates: true,
            escapeDeactivates: stopPropagation,
          }}
        >
          <Modal
            size="500"
            variant="Background"
            role="dialog"
            aria-modal="true"
            aria-labelledby={TITLE_ID}
          >
            <Box direction="Column" gap="400" style={{ padding: config.space.S400 }}>
              <Box direction="Row" justifyContent="SpaceBetween" alignItems="Center">
                <Header id={TITLE_ID} size="400">Keyboard Shortcuts</Header>
                <IconButton size="300" onClick={handleClose} aria-label="Close keyboard shortcuts">
                  <Icon src={Icons.Cross} size="200" />
                </IconButton>
              </Box>
              <Scroll style={{ maxHeight: '60vh' }}>
                <Box direction="Column" gap="300">
                  {Object.entries(groupedShortcuts).map(([category, items]) => (
                    <section key={category} aria-label={`${category} shortcuts`}>
                      <Text size="L400" as="h3" style={{ marginBottom: config.space.S100 }}>
                        {category}
                      </Text>
                      <dl style={{ margin: 0 }}>
                        {items.map((shortcut) => (
                          <Box
                            key={shortcut.key}
                            direction="Row"
                            justifyContent="SpaceBetween"
                            gap="400"
                            as="div"
                          >
                            <dt style={{ listStyle: 'none' }}>
                              <Text size="T300">{shortcut.description}</Text>
                            </dt>
                            <dd style={{ margin: 0 }}>
                              <ShortcutKeys keyStr={shortcut.key} />
                            </dd>
                          </Box>
                        ))}
                      </dl>
                    </section>
                  ))}
                </Box>
              </Scroll>
            </Box>
          </Modal>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
