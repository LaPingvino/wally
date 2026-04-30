/**
 * Import sanity checks — catch missing JSX component imports before they become runtime errors.
 *
 * Background: Vite transpiles TypeScript without type-checking, so a missing import like
 *   import { Box } from 'folds'  // <-- Button accidentally omitted
 *   ...
 *   <Button>...</Button>         // <-- ReferenceError at runtime
 * will build and ship fine but crash for users.  Running `tsc --noEmit` would catch it, but
 * tsc has pre-existing API-mismatch errors from the deps upgrade that we haven't fixed yet.
 *
 * These tests focus specifically on the "Cannot find name" class of error — undefined JSX
 * component names — which is the most likely cause of a sudden ReferenceError in production.
 */
import { execSync } from 'child_process';
import { describe, it, expect } from 'vitest';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '../..');

describe('TypeScript: no undefined JSX component names', () => {
  it('has no "Cannot find name" errors in any source file', { timeout: 180_000 }, () => {
    let stdout = '';
    try {
      execSync('npx tsc --noEmit', { cwd: ROOT, stdio: 'pipe' });
    } catch (e: any) {
      stdout = e.stdout?.toString() ?? '';
    }

    const undefinedNameErrors = stdout
      .split('\n')
      .filter((line) => line.includes("Cannot find name '") || line.includes("Cannot find module '"));

    if (undefinedNameErrors.length > 0) {
      expect.fail(
        `Missing imports detected (these cause runtime ReferenceErrors):\n\n` +
          undefinedNameErrors.join('\n'),
      );
    }
  });
});
