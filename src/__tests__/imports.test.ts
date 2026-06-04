/**
 * Import sanity checks — catch missing JSX component imports before they become runtime errors.
 *
 * Background: Vite transpiles TypeScript without type-checking, so a missing import like
 *   import { Box } from 'folds'  // <-- Button accidentally omitted
 *   ...
 *   <Button>...</Button>         // <-- ReferenceError at runtime
 * will build and ship fine but crash for users.  The deploy now runs `tsc --noEmit` as a gate
 * (the tree is at 0 errors), so this is a second, faster guard focused specifically on the
 * "Cannot find name" class of error — undefined JSX component names — which is the most likely
 * cause of a sudden ReferenceError in production.
 */
/// <reference types="node" />
import { execSync } from 'child_process';
import { describe, it, expect } from 'vitest';
import { resolve } from 'path';

// import.meta.dirname exists at runtime (Node 20.11+/vitest) but isn't on the
// typed ImportMeta here.
const ROOT = resolve((import.meta as unknown as { dirname: string }).dirname, '../..');

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
