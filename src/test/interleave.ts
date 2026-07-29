/**
 * Deterministic interleaving explorer — the closest useful analogue to Go's race
 * detector for this codebase.
 *
 * `go test -race` works by watching real memory accesses from real threads and
 * checking happens-before. None of that exists here: one thread, no shared
 * mutable memory between workers. What we have instead are ASYNC INTERLEAVINGS —
 * two operations suspended at `await` points, resuming in an order the runtime
 * picks and a test never varies. The classic shape is read-modify-write:
 *
 *     const state = await read();   // both operations read the SAME value
 *     state.push(x);
 *     await write(state);           // second write silently drops the first
 *
 * Running that twice in a test passes every time, because a test's fake `read`
 * resolves in call order. The bug only appears when the two overlap.
 *
 * So: the code under test suspends on test doubles that call `gate.wait()`, and
 * this explorer enumerates every order in which those suspension points can be
 * released, re-running from a fresh state each time and checking an invariant
 * after each complete run. A violation is reported with the exact schedule that
 * produced it, so it reproduces.
 *
 * LIMITS, because a detector you trust wrongly is worse than none:
 *  - It only sees suspension points routed through `gate.wait()`. Real timers,
 *    real network, and un-gated promises are invisible to it.
 *  - It explores orderings, not timings. Anything that depends on wall-clock
 *    duration is out of scope.
 *  - It cannot see non-async races at all — a derived value recomputed from
 *    live mutable state has no suspension point to gate. Those need the static
 *    audit instead (see src/__tests__/concurrency-audit.test.ts).
 */

export type Gate = {
  /** Suspend here until the explorer releases this point. Call from test doubles. */
  wait(label: string): Promise<void>;
};

type Waiter = { label: string; release: () => void };

export type InterleavingReport = {
  /** How many distinct interleavings were run. */
  explored: number;
  /** The schedules run, as the label order they released. */
  schedules: string[][];
};

const flush = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

export type ExploreOptions = {
  /** Start every concurrent operation. Must resolve when all of them are done. */
  run: (gate: Gate) => Promise<void>;
  /** Fresh state before each interleaving. */
  reset?: () => void;
  /** Throw to report a violation. Runs after each complete interleaving. */
  invariant: (schedule: string[]) => void;
  /** Safety cap on explored paths (combinatorial). Default 200. */
  maxPaths?: number;
};

/**
 * Explore every order in which the gated suspension points can resume, checking
 * the invariant after each. Throws on the first violating schedule.
 */
export const exploreInterleavings = async (
  options: ExploreOptions
): Promise<InterleavingReport> => {
  const { run, reset, invariant, maxPaths = 200 } = options;

  // A schedule is the choice index taken at each decision point. We cannot rewind
  // a running program, so each schedule is replayed from scratch; unexplored
  // branches discovered during a run are queued as new schedules.
  const queue: number[][] = [[]];
  const schedules: string[][] = [];
  let explored = 0;

  while (queue.length > 0) {
    if (explored >= maxPaths) break;
    const plan = queue.shift() as number[];
    reset?.();

    const pending: Waiter[] = [];
    const gate: Gate = {
      wait: (label: string) =>
        new Promise<void>((resolve) => {
          pending.push({ label, release: resolve });
        }),
    };

    let finished = false;
    const done = run(gate).then(
      () => {
        finished = true;
      },
      (err) => {
        finished = true;
        throw err;
      }
    );

    const taken: string[] = [];
    const branching: number[] = [];
    let depth = 0;

    // Drive the run: at each step let everything runnable settle, then release
    // exactly one suspension point.
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      await flush();
      if (finished || pending.length === 0) break;

      const choice = depth < plan.length ? plan[depth] : 0;
      branching[depth] = pending.length;
      const picked = pending.splice(Math.min(choice, pending.length - 1), 1)[0];
      taken.push(picked.label);
      picked.release();
      depth += 1;
    }

    // eslint-disable-next-line no-await-in-loop
    await done;
    explored += 1;
    schedules.push(taken);

    try {
      invariant(taken);
    } catch (err) {
      const detail = taken.length > 0 ? taken.join(' → ') : '(no suspension points)';
      throw new Error(
        `invariant violated by interleaving: ${detail}\n${(err as Error).message ?? String(err)}`
      );
    }

    // Fork the branches this run defaulted past.
    for (let i = plan.length; i < branching.length; i += 1) {
      for (let alt = 1; alt < branching[i]; alt += 1) {
        queue.push([...plan.slice(0, i), alt]);
      }
    }
  }

  return { explored, schedules };
};
