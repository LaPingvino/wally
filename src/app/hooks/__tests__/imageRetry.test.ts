import { describe, expect, it } from 'vitest';
import { decideImageRetry } from '../useImageRetry';

const MAX_RETRIES = 4;

describe('decideImageRetry', () => {
  it('waits for the service worker instead of spending an attempt', () => {
    // The invariant that matters: while the page is uncontrolled, authenticated
    // media CANNOT load, so those failures say nothing about the image. Counting
    // them is how an icon ends up permanently letter-only on a slow start.
    expect(decideImageRetry(false, 0)).toEqual({ type: 'wait-for-sw' });
    expect(decideImageRetry(false, MAX_RETRIES)).toEqual({ type: 'wait-for-sw' });
    expect(decideImageRetry(false, 99)).toEqual({ type: 'wait-for-sw' });
  });

  it('retries while attempts remain, and fails only after the last one', () => {
    for (let i = 0; i < MAX_RETRIES; i += 1) {
      expect(decideImageRetry(true, i).type).toBe('retry');
    }
    expect(decideImageRetry(true, MAX_RETRIES)).toEqual({ type: 'fail' });
    expect(decideImageRetry(true, MAX_RETRIES + 1)).toEqual({ type: 'fail' });
  });

  it('backs off exponentially', () => {
    // rand = 0.5 → no jitter, so the bare ladder shows through.
    const delays = [0, 1, 2, 3].map((n) => {
      const d = decideImageRetry(true, n, 0.5);
      return d.type === 'retry' ? d.delayMs : -1;
    });
    expect(delays).toEqual([500, 1000, 2000, 4000]);
  });

  it('jitters within ±25% so hundreds of avatars do not retry in lockstep', () => {
    const at = (rand: number) => {
      const d = decideImageRetry(true, 0, rand);
      return d.type === 'retry' ? d.delayMs : -1;
    };
    expect(at(0)).toBe(375); // 500 * 0.75
    expect(at(1)).toBe(625); // 500 * 1.25
    // Distinct random values must give distinct delays — that spread IS the fix.
    expect(at(0)).not.toBe(at(1));
    [0, 0.25, 0.5, 0.75, 1].forEach((r) => {
      expect(at(r)).toBeGreaterThanOrEqual(375);
      expect(at(r)).toBeLessThanOrEqual(625);
    });
  });
});
