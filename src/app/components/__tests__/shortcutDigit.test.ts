import { describe, it, expect } from 'vitest';
import { shortcutDigit } from '../GlobalKeyboardShortcuts';

describe('shortcutDigit', () => {
  it('reads the physical key, whatever the layout types', () => {
    expect(shortcutDigit({ code: 'Digit1', key: '!' })).toBe(1); // US, Shift held
    expect(shortcutDigit({ code: 'Digit1', key: '&' })).toBe(1); // AZERTY
    expect(shortcutDigit({ code: 'Digit3', key: '£' })).toBe(3); // macOS Option
    expect(shortcutDigit({ code: 'Numpad9', key: '9' })).toBe(9);
  });

  it('falls back to the key without a code, and ignores 0 and non-digits', () => {
    expect(shortcutDigit({ code: '', key: '4' })).toBe(4);
    expect(shortcutDigit({ code: 'Digit0', key: '0' })).toBeNull();
    expect(shortcutDigit({ code: 'KeyA', key: 'a' })).toBeNull();
    expect(shortcutDigit({ code: '', key: '!' })).toBeNull();
  });
});
