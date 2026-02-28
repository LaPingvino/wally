import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Icon,
  IconButton,
  Icons,
  Scroll,
  Text,
  config,
} from 'folds';
import { useAtom } from 'jotai';
import { Page, PageContent, PageHeader } from '../../../components/page';
import { customShortcutKeysAtom } from '../../../state/keyboardShortcutsHelp';
import { SHORTCUT_DEFINITIONS, ShortcutDefinition } from '../../../hooks/useGlobalKeyboardShortcuts';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Display-only shortcuts (non-customizable) ─────────────────────────────────

type DisplayEntry = { key: string; description: string; category: string };

const DISPLAY_ONLY: DisplayEntry[] = [
  { key: 'alt+j', description: 'Start or join call in current room', category: 'Actions' },
  { key: 'alt+p', description: 'Toggle members panel', category: 'Actions' },
  { key: 'alt+shift+t', description: 'Toggle threads panel', category: 'Actions' },
  { key: 'alt+shift+c', description: 'Toggle chat panel (during call)', category: 'Actions' },
  { key: 'mod+shift+m', description: 'Toggle mute (in call)', category: 'Actions' },
  { key: 'mod+shift+v', description: 'Toggle video (in call)', category: 'Actions' },
  { key: 'mod+shift+h', description: 'End call', category: 'Actions' },
  { key: 'alt+f', description: 'Search in room', category: 'Search' },
  { key: 'alt+n', description: 'Go to next unread room', category: 'Navigation' },
  { key: 'alt+shift+\u2193', description: 'Next unread room', category: 'Navigation' },
  { key: 'alt+shift+\u2191', description: 'Previous unread room', category: 'Navigation' },
  { key: 'alt+1\u20139', description: 'Go to 1st\u20139th space', category: 'Navigation' },
  { key: 'alt+shift+1\u20139', description: 'Switch to 1st\u20139th account', category: 'Navigation' },
  { key: 'f6', description: 'Move to next section', category: 'Navigation' },
  { key: 'shift+f6', description: 'Move to previous section', category: 'Navigation' },
];

// ── ShortcutRow (editable) ────────────────────────────────────────────────────

type ShortcutRowProps = {
  def: ShortcutDefinition;
  effectiveKey: string;
  isRecording: boolean;
  hasCustom: boolean;
  onActivate: () => void;
  onReset: () => void;
};
function ShortcutRow({ def, effectiveKey, isRecording, hasCustom, onActivate, onReset }: ShortcutRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${def.description}: ${isRecording ? 'press new key combo' : formatShortcut(effectiveKey)}${hasCustom ? ', customized' : ''}. Press Enter to change.`}
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
        {def.description}
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
                aria-label={`Reset ${def.description} shortcut to default`}
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

// ── ReadOnlyRow ───────────────────────────────────────────────────────────────

function ReadOnlyRow({ entry }: { entry: DisplayEntry }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: config.space.S400,
        padding: `${config.space.S100} ${config.space.S100}`,
      }}
    >
      <Text size="T300" style={{ flex: 1, minWidth: 0 }}>
        {entry.description}
      </Text>
      <Box gap="200" alignItems="Center" style={{ flexShrink: 0 }}>
        <ShortcutKeys keyStr={entry.key} />
      </Box>
    </div>
  );
}

// ── KeyboardShortcuts page ────────────────────────────────────────────────────

type KeyboardShortcutsProps = {
  requestClose: () => void;
};
export function KeyboardShortcuts({ requestClose }: KeyboardShortcutsProps) {
  const [customKeys, setCustomKeys] = useAtom(customShortcutKeysAtom);
  const [recordingFor, setRecordingForState] = useState<string | null>(null);
  const recordingForRef = useRef<string | null>(null);

  const setRecordingFor = useCallback((val: string | null) => {
    recordingForRef.current = val;
    setRecordingForState(val);
  }, []);

  // Capture key combos while recording — runs all the time (page is always mounted when visible)
  useEffect(() => {
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
  }, [setRecordingFor, setCustomKeys]);

  const effectiveKey = (def: ShortcutDefinition) => customKeys[def.description] ?? def.defaultKey;
  const resetShortcut = (desc: string) =>
    setCustomKeys((prev) => {
      const next = { ...prev };
      delete next[desc];
      return next;
    });

  // Group editable shortcuts by category
  const editableByCategory = SHORTCUT_DEFINITIONS.reduce(
    (acc, def) => {
      if (!acc[def.category]) acc[def.category] = [];
      acc[def.category].push(def);
      return acc;
    },
    {} as Record<string, ShortcutDefinition[]>
  );

  // Group display-only shortcuts by category
  const displayByCategory = DISPLAY_ONLY.reduce(
    (acc, entry) => {
      if (!acc[entry.category]) acc[entry.category] = [];
      acc[entry.category].push(entry);
      return acc;
    },
    {} as Record<string, DisplayEntry[]>
  );

  return (
    <Page>
      <PageHeader outlined={false}>
        <Box grow="Yes" gap="200">
          <Box grow="Yes" alignItems="Center" gap="200">
            <Text size="H3" as="h1" truncate>
              Keyboard Shortcuts
            </Text>
          </Box>
          <Box shrink="No">
            <IconButton onClick={requestClose} variant="Surface" aria-label="Close">
              <Icon src={Icons.Cross} />
            </IconButton>
          </Box>
        </Box>
      </PageHeader>
      <Box grow="Yes">
        <Scroll hideTrack visibility="Hover">
          <PageContent>
            <Box direction="Column" gap="600">

              {/* Customizable shortcuts */}
              <Box direction="Column" gap="300">
                <Box direction="Column" gap="100">
                  <Text size="L400">Customizable Shortcuts</Text>
                  <Text size="T200" priority="300">
                    Click a shortcut row to rebind it. Press Escape to cancel.
                  </Text>
                </Box>
                {Object.entries(editableByCategory).map(([category, defs]) => (
                  <section key={category} aria-label={`${category} shortcuts`}>
                    <Text
                      size="L400"
                      as="h3"
                      style={{
                        margin: `${config.space.S200} 0 ${config.space.S100}`,
                        paddingLeft: config.space.S100,
                        opacity: 0.7,
                      }}
                    >
                      {category}
                    </Text>
                    {defs.map((def) => {
                      const isRecording = recordingFor === def.description;
                      const hasCustom = def.description in customKeys;
                      return (
                        <ShortcutRow
                          key={def.description}
                          def={def}
                          effectiveKey={effectiveKey(def)}
                          isRecording={isRecording}
                          hasCustom={hasCustom}
                          onActivate={() => !isRecording && setRecordingFor(def.description)}
                          onReset={() => resetShortcut(def.description)}
                        />
                      );
                    })}
                  </section>
                ))}
              </Box>

              {/* Display-only shortcuts */}
              <Box direction="Column" gap="300">
                <Box direction="Column" gap="100">
                  <Text size="L400">Other Shortcuts</Text>
                  <Text size="T200" priority="300">
                    These shortcuts are fixed and cannot be customized.
                  </Text>
                </Box>
                {Object.entries(displayByCategory).map(([category, entries]) => (
                  <section key={category} aria-label={`${category} shortcuts`}>
                    <Text
                      size="L400"
                      as="h3"
                      style={{
                        margin: `${config.space.S200} 0 ${config.space.S100}`,
                        paddingLeft: config.space.S100,
                        opacity: 0.7,
                      }}
                    >
                      {category}
                    </Text>
                    {entries.map((entry) => (
                      <ReadOnlyRow key={entry.description} entry={entry} />
                    ))}
                  </section>
                ))}
              </Box>

            </Box>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}
