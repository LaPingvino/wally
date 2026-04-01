import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Text,
  config,
  Header,
  IconButton,
  Icon,
  Icons,
} from 'folds';
import { useAtom } from 'jotai';
import { keyboardShortcutsHelpAtom, customShortcutKeysAtom } from '../../state/keyboardShortcutsHelp';
import { KeyboardShortcut } from '../../hooks/useGlobalKeyboardShortcuts';
import { NativeDialog } from '../NativeDialog';
import * as dialogCss from '../NativeDialog.css';

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

function ShortcutKeys({ keyStr }: { keyStr: string }) {
  const formatted = formatShortcut(keyStr);
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
            <span aria-hidden="true" style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>+</span>
          )}
        </React.Fragment>
      ))}
    </span>
  );
}

/** Convert a KeyboardEvent to an is-hotkey format string, or null for pure modifiers */
function eventToBinding(evt: KeyboardEvent): string | null {
  const { key } = evt;
  if (['Control', 'Alt', 'Shift', 'Meta', 'CapsLock', 'Tab', 'Escape'].includes(key)) return null;
  const parts: string[] = [];
  if (evt.ctrlKey || evt.metaKey) parts.push('mod');
  if (evt.altKey) parts.push('alt');
  if (evt.shiftKey) parts.push('shift');
  parts.push(key === ' ' ? 'space' : key.toLowerCase());
  return parts.join('+');
}

const TITLE_ID = 'kb-shortcuts-help-title';

export function KeyboardShortcutsHelp({ shortcuts }: KeyboardShortcutsHelpProps) {
  const [open, setOpen] = useAtom(keyboardShortcutsHelpAtom);
  const [customKeys, setCustomKeys] = useAtom(customShortcutKeysAtom);
  const listRef = useRef<HTMLDivElement>(null);

  // recordingFor: description of the shortcut being rebound, or null
  const [recordingFor, setRecordingForState] = useState<string | null>(null);
  const recordingForRef = useRef<string | null>(null);
  const setRecordingFor = useCallback((val: string | null) => {
    recordingForRef.current = val;
    setRecordingForState(val);
  }, []);

  // Focused row: 0 = close button, 1..N = shortcut rows
  const [focusedRow, setFocusedRow] = useState(0);

  // Capture key combos while recording
  useEffect(() => {
    if (!open) return;
    const handler = (evt: KeyboardEvent) => {
      if (recordingForRef.current === null) return;
      evt.preventDefault();
      evt.stopPropagation();
      if (evt.key === 'Escape') {
        setRecordingFor(null);
        return;
      }
      const binding = eventToBinding(evt);
      if (binding) {
        const desc = recordingForRef.current;
        setCustomKeys((prev) => ({ ...prev, [desc]: binding }));
        setRecordingFor(null);
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [open, setRecordingFor, setCustomKeys]);

  const handleClose = useCallback(() => {
    // If recording a shortcut, don't close — the capture handler handles Escape
    if (recordingForRef.current !== null) return;
    setOpen(false);
    setRecordingFor(null);
  }, [setOpen, setRecordingFor]);

  if (!open) return null;

  const effectiveKey = (s: KeyboardShortcut) => customKeys[s.description] ?? s.defaultKey;
  const resetShortcut = (desc: string) =>
    setCustomKeys((prev) => {
      const next = { ...prev };
      delete next[desc];
      return next;
    });

  // Flat ordered list for roving tabindex (close button at index 0)
  const allRows = shortcuts;

  return (
    <NativeDialog open={open} onClose={handleClose} className={dialogCss.NativeDialog500}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
      >
            <Box direction="Column" gap="400" style={{ padding: config.space.S400 }}>

              {/* Header */}
              <Box direction="Row" justifyContent="SpaceBetween" alignItems="Center">
                <Header id={TITLE_ID} size="400">Keyboard Shortcuts</Header>
                <IconButton
                  size="300"
                  onClick={handleClose}
                  aria-label="Close keyboard shortcuts"
                  tabIndex={focusedRow === 0 ? 0 : -1}
                  onFocus={() => setFocusedRow(0)}
                >
                  <Icon src={Icons.Cross} size="200" />
                </IconButton>
              </Box>

              {/* Arrow-navigable shortcut list — plain div for reliable tabIndex + text selection */}
              <div
                ref={listRef}
                style={{ overflowY: 'auto', maxHeight: '60vh', userSelect: 'text' }}
                onKeyDown={(evt) => {
                  // ArrowUp/Down navigate between rows (including close button at row 0)
                  if (evt.key !== 'ArrowDown' && evt.key !== 'ArrowUp') return;
                  evt.preventDefault();
                  const next =
                    evt.key === 'ArrowDown'
                      ? Math.min(focusedRow + 1, allRows.length)
                      : Math.max(focusedRow - 1, 0);
                  setFocusedRow(next);
                  if (next === 0) {
                    listRef.current
                      ?.closest('[role="dialog"]')
                      ?.querySelector<HTMLElement>('button[aria-label="Close keyboard shortcuts"]')
                      ?.focus();
                  } else {
                    listRef.current
                      ?.querySelector<HTMLElement>(`[data-row-index="${next}"]`)
                      ?.focus();
                  }
                }}
              >
                {Object.entries(
                  shortcuts.reduce(
                    (acc, s) => {
                      if (!acc[s.category]) acc[s.category] = [];
                      acc[s.category].push(s);
                      return acc;
                    },
                    {} as Record<string, KeyboardShortcut[]>
                  )
                ).map(([category, items]) => (
                  <section key={category} aria-label={`${category} shortcuts`}>
                    <Text
                      size="L400"
                      as="h3"
                      style={{
                        margin: `${config.space.S200} 0 ${config.space.S100}`,
                        paddingLeft: config.space.S100,
                      }}
                    >
                      {category}
                    </Text>
                    {items.map((shortcut) => {
                      const rowIdx = allRows.indexOf(shortcut) + 1;
                      const isRecording = recordingFor === shortcut.description;
                      const hasCustom = shortcut.description in customKeys;
                      return (
                        <ShortcutRow
                          key={shortcut.description}
                          shortcut={shortcut}
                          effectiveKey={effectiveKey(shortcut)}
                          isRecording={isRecording}
                          hasCustom={hasCustom}
                          rowIndex={rowIdx}
                          tabIndex={focusedRow === rowIdx ? 0 : -1}
                          onFocus={() => setFocusedRow(rowIdx)}
                          onActivate={() => !isRecording && setRecordingFor(shortcut.description)}
                          onReset={() => resetShortcut(shortcut.description)}
                        />
                      );
                    })}
                  </section>
                ))}
              </div>
            </Box>
      </div>
    </NativeDialog>
  );
}

// ── ShortcutRow ───────────────────────────────────────────────────────────────

type ShortcutRowProps = {
  shortcut: KeyboardShortcut;
  effectiveKey: string;
  isRecording: boolean;
  hasCustom: boolean;
  rowIndex: number;
  tabIndex: number;
  onFocus: () => void;
  onActivate: () => void;
  onReset: () => void;
};
function ShortcutRow({
  shortcut,
  effectiveKey,
  isRecording,
  hasCustom,
  rowIndex,
  tabIndex,
  onFocus,
  onActivate,
  onReset,
}: ShortcutRowProps) {
  return (
    <div
      data-row-index={rowIndex}
      role="button"
      tabIndex={tabIndex}
      aria-label={`${shortcut.description}: ${isRecording ? 'press new key combo' : formatShortcut(effectiveKey)}${hasCustom ? ', customized' : ''}. Press Enter to change.`}
      onFocus={onFocus}
      onClick={onActivate}
      onKeyDown={(evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') {
          evt.preventDefault();
          onActivate();
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: config.space.S400,
        padding: `${config.space.S100} ${config.space.S100}`,
        borderRadius: config.radii.R300,
        cursor: 'pointer',
        outline: isRecording ? `2px solid var(--bg-surface-border)` : undefined,
        background: isRecording ? 'var(--bg-surface-low)' : undefined,
        userSelect: 'text',
      }}
    >
      <Text size="T300" style={{ flex: 1, minWidth: 0 }}>
        {shortcut.description}
      </Text>
      <Box gap="200" alignItems="Center" style={{ flexShrink: 0 }}>
        {isRecording ? (
          <Text size="T200" priority="300" style={{ fontStyle: 'italic' }}>
            Press keys… (Esc to cancel)
          </Text>
        ) : (
          <>
            <ShortcutKeys keyStr={effectiveKey} />
            {hasCustom && (
              <IconButton
                size="300"
                fill="None"
                title="Reset to default"
                aria-label={`Reset ${shortcut.description} shortcut to default`}
                tabIndex={-1}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  onReset();
                }}
              >
                <Icon src={Icons.Cross} size="100" />
              </IconButton>
            )}
          </>
        )}
      </Box>
    </div>
  );
}
