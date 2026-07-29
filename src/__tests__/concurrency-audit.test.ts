/**
 * Structural concurrency audit — the static half of our race tooling.
 *
 * `go test -race` has no direct equivalent here: JS is single-threaded, so there
 * are no data races to detect. Our races are of two other kinds, and they need
 * two different instruments:
 *
 *  - ASYNC INTERLEAVING (read-modify-write across an await, stale response
 *    overwriting a newer one). Dynamic, and testable by enumerating orderings —
 *    see src/test/interleave.ts and mDirectConcurrency.test.ts.
 *
 *  - STALE DERIVATION, which has no await at all. A memo or selector computes
 *    from LIVE mutable SDK state while its dependencies only track something
 *    else, so when the underlying state changes nothing recomputes. This is what
 *    hid a whole space from the sidebar: useOrphanSpaces called
 *    `isSpace(mx.getRoom(id))` — a live read — but only re-ran when the room
 *    LIST changed, so a room whose m.room.create arrived later stayed filtered
 *    out until some unrelated event happened to disturb the list.
 *
 * This file is a TRIPWIRE, not a prover. It cannot tell a correctly-subscribed
 * live read from a dangerous one; it counts the hazard sites and fails when the
 * count grows, which forces the question to be asked at review time. Lowering a
 * baseline is always welcome. Raising one should come with a reason.
 */
/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const APP_DIR = join(__dirname, '..', 'app');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir)
    .filter((entry) => entry !== 'node_modules' && entry !== '__tests__')
    .flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return sourceFiles(full);
      return full.endsWith('.ts') || full.endsWith('.tsx') ? [full] : [];
    });

/** Body text of each call to `fn(`, matched by parentheses so concise arrows count too. */
const callTexts = (src: string, fn: string): string[] => {
  const out: string[] = [];
  const re = new RegExp(`\\b${fn}\\(`, 'g');
  let m = re.exec(src);
  while (m !== null) {
    const start = m.index + m[0].length - 1;
    let depth = 0;
    for (let j = start; j < src.length; j += 1) {
      if (src[j] === '(') depth += 1;
      else if (src[j] === ')') {
        depth -= 1;
        if (depth === 0) {
          out.push(src.slice(start, j + 1));
          break;
        }
      }
    }
    m = re.exec(src);
  }
  return out;
};

/** Brace-matched bodies of each useEffect callback. */
const effectBodies = (src: string): string[] => {
  const out: string[] = [];
  const re = /useEffect\(/g;
  let m = re.exec(src);
  while (m !== null) {
    const open = src.indexOf('{', m.index + m[0].length);
    if (open >= 0) {
      let depth = 0;
      for (let j = open; j < src.length; j += 1) {
        if (src[j] === '{') depth += 1;
        else if (src[j] === '}') {
          depth -= 1;
          if (depth === 0) {
            out.push(src.slice(open, j + 1));
            break;
          }
        }
      }
    }
    m = re.exec(src);
  }
  return out;
};

/** Reads that go straight to live, mutable SDK state rather than to a snapshot. */
const LIVE_READ =
  /mx\.getRoom\(|\.getMyMembership\(|\.currentState|\.isSpaceRoom\(|getStateEvent\(|\.getMembers\(/;

/** Effects that start async work and cannot cancel it. Pure, so it can be self-tested. */
const unguardedAsyncEffects = (src: string): number =>
  effectBodies(src).filter((body) => {
    const isAsync = body.includes('await ') || body.includes('.then(');
    const guarded = body.includes('return () =>') || body.includes('return cleanup');
    return isAsync && !guarded;
  }).length;

/** Memo/selector bodies that read live SDK state. Pure, so it can be self-tested. */
const liveStateDerivations = (src: string): number =>
  ['useMemo', 'useCallback']
    .flatMap((fn) => callTexts(src, fn))
    .filter((text) => LIVE_READ.test(text)).length;

const files = sourceFiles(APP_DIR).map((path) => ({ path, src: readFileSync(path, 'utf-8') }));

/**
 * NEGATIVE CONTROLS.
 *
 * Every check below is a ratchet of the form "no more than N", which a detector
 * that silently stopped matching would pass with flying colours — zero is always
 * ≤ N. So each detector is first pointed at source it MUST flag, and the counts
 * over the real tree are floored as well as capped. Without this the suite would
 * go green precisely when it stopped working.
 */
describe('the detectors themselves', () => {
  it('flags an async effect with no cleanup', () => {
    expect(
      unguardedAsyncEffects(`
        useEffect(() => {
          fetchThing().then(setThing);
        }, [id]);
      `)
    ).toBe(1);
  });

  it('does not flag an async effect that cleans up', () => {
    expect(
      unguardedAsyncEffects(`
        useEffect(() => {
          let alive = true;
          fetchThing().then((t) => { if (alive) setThing(t); });
          return () => { alive = false; };
        }, [id]);
      `)
    ).toBe(0);
  });

  it('flags a live read inside a CONCISE arrow body', () => {
    // The shape that matters: useOrphanSpaces is written exactly like this, and
    // the first version of this scan matched only braced bodies and missed it.
    expect(
      liveStateDerivations(`
        const selector = useCallback((roomId) => isSpace(mx.getRoom(roomId)), [mx, roomToParents]);
      `)
    ).toBe(1);
  });

  it('flags a live read inside a braced body, and ignores a snapshot read', () => {
    expect(
      liveStateDerivations(`
        const a = useMemo(() => {
          return rooms.filter((r) => r.getMyMembership() === 'join');
        }, [rooms]);
      `)
    ).toBe(1);
    expect(
      liveStateDerivations(`
        const b = useMemo(() => snapshot.rooms.filter((r) => r.joined), [snapshot]);
      `)
    ).toBe(0);
  });
});

describe('async effects', () => {
  // An async effect with no cleanup cannot cancel itself, so a response that
  // arrives after the inputs changed still lands — the stale-response race.
  const BASELINE = 7;

  it(`has no more than ${BASELINE} effects that start async work without a cleanup`, () => {
    const offenders: string[] = [];
    files.forEach(({ path, src }) => {
      const n = unguardedAsyncEffects(src);
      for (let i = 0; i < n; i += 1) offenders.push(path.replace(APP_DIR, 'app'));
    });
    expect(
      offenders.length,
      `Unguarded async effects:\n  ${offenders.join('\n  ')}\n\n` +
        'Give the effect a cleanup that cancels or ignores its result, or lower the baseline.'
    ).toBeLessThanOrEqual(BASELINE);
    // Floor: if this ever reads 0 the scan has broken, not the codebase improved.
    // Drop the floor deliberately when the last one is genuinely fixed.
    expect(offenders.length, 'scan appears broken — it matched nothing').toBeGreaterThan(0);
  });
});

describe('derivations over live state', () => {
  // Not all of these are bugs — many are event-driven and correctly subscribed.
  // The count is a ratchet so a NEW one has to be justified.
  const BASELINE = 55;

  it(`has no more than ${BASELINE} memo/selector bodies reading live SDK state`, () => {
    let count = 0;
    const where: string[] = [];
    files.forEach(({ path, src }) => {
      const n = liveStateDerivations(src);
      count += n;
      if (n > 0) where.push(path.replace(APP_DIR, 'app'));
    });

    // ANCHOR: roomList.ts holds the selectors behind the "space missing from the
    // sidebar" bug — the canonical instance of this hazard. If the scan stops
    // seeing it, the scan is broken, whatever the total says.
    expect(where.join('\n'), 'anchor site no longer detected — scan is broken').toContain(
      'state/hooks/roomList.ts'
    );
    expect(
      count,
      'A memo/selector reading live SDK state only recomputes when its deps change, ' +
        'so state that changes underneath it is invisible until something else moves. ' +
        'Either derive from a subscribed snapshot, or subscribe to the event that ' +
        `changes it.\nSites:\n  ${[...new Set(where)].join('\n  ')}`
    ).toBeLessThanOrEqual(BASELINE);
  });
});

describe('event listeners', () => {
  it('removes every listener it adds, per file', () => {
    const ADD = /addEventListener\(|\.on\(/g;
    const REM = /removeEventListener\(|\.off\(|\.removeListener\(/g;
    // A file that subscribes far more than it unsubscribes is where leaks live.
    // Equality is too strict (conditional subscriptions are normal), so this
    // only catches a gross imbalance.
    const bad: string[] = [];
    files.forEach(({ path, src }) => {
      const adds = (src.match(ADD) ?? []).length;
      const rems = (src.match(REM) ?? []).length;
      if (adds >= 4 && rems === 0) bad.push(`${path.replace(APP_DIR, 'app')} (+${adds}/-0)`);
    });
    expect(bad, `Files that subscribe but never unsubscribe:\n  ${bad.join('\n  ')}`).toEqual([]);
  });
});
