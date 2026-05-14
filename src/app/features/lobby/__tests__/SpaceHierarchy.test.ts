/**
 * Regression tests for the space-lobby visibility filter.
 *
 * Bug: on a space whose /hierarchy response omits child rooms (observed on
 * nexy7574.co.uk / Conduwuit-family servers), non-admin users saw only the
 * rooms that the server happened to return — even rooms they were already
 * joined to went missing. The fix: never hide a joined room.
 */

import { describe, it, expect } from 'vitest';
import { MatrixError } from 'matrix-js-sdk';
import { isInaccessibleChildRoom } from '../accessibility';

describe('isInaccessibleChildRoom', () => {
  const base = { inHierarchy: false, joined: false, fetching: false, error: null };

  it('treats still-loading as accessible (avoid flicker)', () => {
    expect(isInaccessibleChildRoom({ ...base, fetching: true })).toBe(false);
  });

  it('shows rooms present in /hierarchy', () => {
    expect(isInaccessibleChildRoom({ ...base, inHierarchy: true })).toBe(false);
  });

  it('shows joined rooms even when /hierarchy omits them (regression)', () => {
    expect(isInaccessibleChildRoom({ ...base, joined: true })).toBe(false);
  });

  it('hides rooms the user has not joined and that /hierarchy omits', () => {
    expect(isInaccessibleChildRoom(base)).toBe(true);
  });

  it('hides on explicit M_FORBIDDEN when not joined', () => {
    const err = new MatrixError({ errcode: 'M_FORBIDDEN', error: 'no' });
    expect(isInaccessibleChildRoom({ ...base, error: err })).toBe(true);
  });

  it('shows on non-forbidden MatrixError (server flaky, do not hide)', () => {
    const err = new MatrixError({ errcode: 'M_UNKNOWN', error: 'oops' });
    expect(isInaccessibleChildRoom({ ...base, error: err })).toBe(false);
  });

  it('shows on generic non-Matrix error (network etc.)', () => {
    expect(isInaccessibleChildRoom({ ...base, error: new Error('network') })).toBe(false);
  });

  it('joined wins over M_FORBIDDEN — joined rooms are always visible', () => {
    const err = new MatrixError({ errcode: 'M_FORBIDDEN', error: 'no' });
    expect(isInaccessibleChildRoom({ ...base, joined: true, error: err })).toBe(false);
  });
});
