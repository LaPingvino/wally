import { describe, expect, it } from 'vitest';
import { exploreInterleavings, Gate } from '../interleave';

/**
 * Self-test for the interleaving explorer.
 *
 * A detector that cannot be shown to detect is worse than none: every downstream
 * test would pass for the wrong reason. So this pins both directions — it finds
 * the violation in a knowingly racy operation, and it does not cry wolf over a
 * serialised one.
 */

/** Read-modify-write with no mutual exclusion — the classic lost update. */
const makeStore = () => {
  let value: string[] = [];
  return {
    get: () => value,
    reset: () => {
      value = [];
    },
    racyAppend: async (gate: Gate, item: string): Promise<void> => {
      await gate.wait(`read:${item}`);
      const next = [...value, item];
      await gate.wait(`write:${item}`);
      value = next;
    },
  };
};

describe('exploreInterleavings', () => {
  it('finds the interleaving that loses an update', async () => {
    const store = makeStore();

    await expect(
      exploreInterleavings({
        reset: () => store.reset(),
        run: async (gate) => {
          await Promise.all([store.racyAppend(gate, 'a'), store.racyAppend(gate, 'b')]);
        },
        invariant: () => {
          expect(store.get()).toHaveLength(2);
        },
      })
    ).rejects.toThrow(/invariant violated by interleaving/);
  });

  it('names the schedule that broke it, so the failure reproduces', async () => {
    const store = makeStore();
    let message = '';
    try {
      await exploreInterleavings({
        reset: () => store.reset(),
        run: async (gate) => {
          await Promise.all([store.racyAppend(gate, 'a'), store.racyAppend(gate, 'b')]);
        },
        invariant: () => {
          expect(store.get()).toHaveLength(2);
        },
      });
    } catch (err) {
      message = (err as Error).message;
    }
    // Both reads must precede a write for an update to be lost — the report has
    // to show that shape, not merely say "something went wrong".
    expect(message).toMatch(/read:a.*read:b|read:b.*read:a/);
    expect(message).toMatch(/→/);
  });

  it('passes a serialised operation, and collapses it to a single ordering', async () => {
    const store = makeStore();
    let chain: Promise<unknown> = Promise.resolve();
    const serialAppend = (gate: Gate, item: string): Promise<void> => {
      const run = chain.then(() => store.racyAppend(gate, item));
      chain = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    };

    const report = await exploreInterleavings({
      reset: () => {
        store.reset();
        chain = Promise.resolve();
      },
      run: async (gate) => {
        await Promise.all([serialAppend(gate, 'a'), serialAppend(gate, 'b')]);
      },
      invariant: () => {
        expect(store.get()).toHaveLength(2);
      },
    });

    expect(report.explored).toBe(1);
    expect(report.schedules[0]).toEqual(['read:a', 'write:a', 'read:b', 'write:b']);
  });

  it('explores more than one ordering when operations genuinely overlap', async () => {
    const seen: string[][] = [];
    const report = await exploreInterleavings({
      run: async (gate) => {
        await Promise.all([gate.wait('x'), gate.wait('y')]);
      },
      invariant: (schedule) => {
        seen.push(schedule);
      },
    });
    expect(report.explored).toBe(2);
    expect(seen).toContainEqual(['x', 'y']);
    expect(seen).toContainEqual(['y', 'x']);
  });
});
