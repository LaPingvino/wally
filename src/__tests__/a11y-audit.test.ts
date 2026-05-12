/**
 * Structural accessibility audit.
 *
 * These tests grep the source code for a11y patterns and anti-patterns,
 * catching regressions without needing to render components. They verify:
 * - Key components have proper ARIA roles and labels
 * - Interactive elements aren't missing accessible names
 * - Native `<dialog>` is used instead of custom overlays for modal dialogs
 * - Landmark roles exist for screen reader navigation
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const SRC_DIR = join(__dirname, '..', 'app');

function getAllTsxFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === '__tests__') continue;
    if (statSync(full).isDirectory()) {
      files.push(...getAllTsxFiles(full));
    } else if (full.endsWith('.tsx') || full.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

function readSrc(relativePath: string): string {
  return readFileSync(join(SRC_DIR, relativePath), 'utf-8');
}

describe('Landmark roles', () => {
  it('Sidebar renders as <nav> with aria-label', () => {
    const src = readSrc('components/sidebar/Sidebar.tsx');
    expect(src).toMatch(/aria-label.*Spaces|aria-label="Spaces"/);
    expect(src).toMatch(/<.*nav|as.*=.*'nav'/);
  });

  it('PageNav (room list panel) has navigation landmark', () => {
    const src = readSrc('components/page/Page.tsx');
    expect(src).toMatch(/<nav[\s>]|as="nav"/);
    expect(src).toMatch(/aria-label.*Room list|aria-label="Room list"/);
  });

  it('Page (main content) renders as <main>', () => {
    const src = readSrc('components/page/Page.tsx');
    // Should use 'main' as the default element
    expect(src).toMatch(/as.*=.*'main'|<main/);
  });

  it('Timeline has role="log" and aria-label', () => {
    const src = readSrc('features/room/RoomTimeline.tsx');
    expect(src).toMatch(/role="log"/);
    expect(src).toMatch(/aria-label="Message timeline"/);
  });
});

describe('Room list listbox pattern', () => {
  it('RoomListbox has role="listbox"', () => {
    const src = readSrc('components/room-listbox/RoomListbox.tsx');
    expect(src).toMatch(/role="listbox"/);
  });

  it('PageNavContent has useNavArrowKeys for DOM focus navigation', () => {
    const src = readSrc('components/page/Page.tsx');
    expect(src).toMatch(/useNavArrowKeys/);
    expect(src).toMatch(/id="wally-room-listbox"/);
    expect(src).toMatch(/tabIndex=\{0\}/);
  });

  it('RoomListbox uses aria-activedescendant', () => {
    const src = readSrc('components/room-listbox/RoomListbox.tsx');
    expect(src).toMatch(/aria-activedescendant/);
  });

  it('RoomNavItem has role="option"', () => {
    const src = readSrc('features/room-nav/RoomNavItem.tsx');
    expect(src).toMatch(/role="option"/);
  });

  it('RoomNavItem default tabIndex is -1 (not individually tabbable)', () => {
    const src = readSrc('features/room-nav/RoomNavItem.tsx');
    expect(src).toMatch(/tabIndex=\{tabIndex \?\? -1\}/);
  });

  it('Keyboard hook supports arrow keys, Home, End, PageUp, PageDown', () => {
    const src = readSrc('hooks/useRoomListKeyboard.ts');
    expect(src).toMatch(/arrowdown/i);
    expect(src).toMatch(/arrowup/i);
    expect(src).toMatch(/home/i);
    expect(src).toMatch(/end/i);
    expect(src).toMatch(/pagedown/i);
    expect(src).toMatch(/pageup/i);
  });
});

describe('Native dialog migration', () => {
  it('NativeDialog component uses native <dialog> element', () => {
    const src = readSrc('components/NativeDialog.tsx');
    expect(src).toMatch(/<dialog/);
    expect(src).toMatch(/showModal\(\)/);
  });

  it('NativeDialog handles Escape via onCancel', () => {
    const src = readSrc('components/NativeDialog.tsx');
    expect(src).toMatch(/onCancel/);
  });

  it('NativeDialog handles backdrop click', () => {
    const src = readSrc('components/NativeDialog.tsx');
    expect(src).toMatch(/e\.target === ref\.current/);
  });

  // Verify key dialogs use NativeDialog instead of Overlay+FocusTrap
  const dialogFiles = [
    'components/leave-room-prompt/LeaveRoomPrompt.tsx',
    'components/leave-space-prompt/LeaveSpacePrompt.tsx',
    'components/join-address-prompt/JoinAddressPrompt.tsx',
    'components/keyboard-shortcuts-help/KeyboardShortcutsHelp.tsx',
    'components/UIAFlowOverlay.tsx',
    'features/create-room/CreateRoomModal.tsx',
    'features/create-space/CreateSpaceModal.tsx',
    'features/common-settings/general/RoomEncryption.tsx',
    'features/common-settings/general/RoomUpgrade.tsx',
    'features/add-existing/AddExisting.tsx',
    'features/search/Search.tsx',
  ];

  for (const file of dialogFiles) {
    it(`${file} uses NativeDialog`, () => {
      const src = readSrc(file);
      expect(src).toMatch(/NativeDialog/);
      // Should NOT use the old Overlay+FocusTrap pattern for its main dialog
      // (some files may still have FocusTrap for sub-elements like menus)
    });
  }
});

describe('F6 section cycling', () => {
  it('GlobalKeyboardShortcuts handles F6 and Shift+F6', () => {
    const src = readSrc('components/GlobalKeyboardShortcuts.tsx');
    expect(src).toMatch(/f6/i);
    expect(src).toMatch(/shift\+f6/i);
  });

  it('F6 targets room listbox', () => {
    const src = readSrc('components/GlobalKeyboardShortcuts.tsx');
    expect(src).toMatch(/wally-room-listbox/);
  });
});

describe('Call accessibility', () => {
  it('CallView has ARIA announcer for participant changes', () => {
    const src = readSrc('features/call/CallView.tsx');
    expect(src).toMatch(/aria-live|CallAriaAnnouncer|announce/);
  });

  it('Call controls have aria-label and aria-pressed', () => {
    const src = readSrc('features/call/CallView.tsx');
    expect(src).toMatch(/aria-label/);
    expect(src).toMatch(/aria-pressed/);
  });
});

describe('NativeDialog must not wrap folds Modal', () => {
  it('no file imports both NativeDialog and uses <Modal> inside it', () => {
    const allFiles = getAllTsxFiles(SRC_DIR);
    for (const file of allFiles) {
      const src = readFileSync(file, 'utf-8');
      if (src.includes('NativeDialog') && file.includes('Modal500')) continue; // wrapper is fine
      if (src.includes('NativeDialog') && file.includes('NativeDialog')) continue; // self
      if (src.includes('NativeDialog') && src.match(/<Modal[\s>]/)) {
        const rel = file.replace(SRC_DIR + '/', '');
        throw new Error(
          `${rel} wraps <Modal> inside NativeDialog — remove the Modal, NativeDialog provides its own styling`
        );
      }
    }
  });
});

describe('NativeDialog CSS variants', () => {
  it('NativeDialog.css.ts exports both default and 500 variants', () => {
    const src = readSrc('components/NativeDialog.css.ts');
    expect(src).toMatch(/export const NativeDialog\b/);
    expect(src).toMatch(/export const NativeDialog500\b/);
  });

  it('Modal500 uses NativeDialog500 (fixed-size) variant', () => {
    const src = readSrc('components/Modal500.tsx');
    expect(src).toMatch(/NativeDialog500/);
  });
});

describe('No interactive elements without accessible names', () => {
  it('all <IconButton> usages have aria-label', () => {
    // Sample the most critical files
    const criticalFiles = [
      'features/room-nav/RoomNavItem.tsx',
      'features/room/RoomViewHeader.tsx',
      'features/call/CallView.tsx',
    ];

    for (const file of criticalFiles) {
      const src = readSrc(file);
      // Find IconButton opening tags — match until the closing >
      // that follows the component's last prop (look for > preceded by
      // a quote, brace, or word char, not inside JSX expressions)
      const iconButtonBlocks: string[] = [];
      let idx = 0;
      while (true) {
        const start = src.indexOf('<IconButton', idx);
        if (start === -1) break;
        // Find the matching > that closes this JSX tag.
        // Track brace depth to skip over {() => ...} expressions.
        let braceDepth = 0;
        let end = start + 11;
        while (end < src.length) {
          if (src[end] === '{') braceDepth++;
          else if (src[end] === '}') braceDepth--;
          else if (src[end] === '>' && braceDepth === 0) break;
          end++;
        }
        iconButtonBlocks.push(src.substring(start, end + 1));
        idx = end + 1;
      }

      for (const btn of iconButtonBlocks) {
        expect(
          btn.includes('aria-label') || btn.includes('aria-labelledby'),
          `IconButton in ${file} missing accessible name: ${btn.substring(0, 120).replace(/\n/g, ' ')}...`
        ).toBe(true);
      }
    }
  });
});
