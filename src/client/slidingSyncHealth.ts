import {
  ClientEvent,
  ClientPrefix,
  MatrixClient,
  MatrixEvent,
  Method,
  SyncState,
} from 'matrix-js-sdk';

/**
 * Sliding-sync health monitor + graceful latency fallback.
 *
 * Three runtime modes (the top-bar indicator shows which one is live — it doubles as a test
 * readout so we learn what real servers do):
 *
 *   NO_SLIDING       classic /sync (user chose it, or the server lacks MSC4186). /sync IS the sync;
 *                    nothing to detect or fall back to.
 *   SLIDING_HEALTHY  sliding sync, and the server surfaces new data promptly — its long-poll wakes
 *                    early on activity and the loop self-heals in ~2 round-trips. Native, no extra
 *                    connection.
 *   SLIDING_DEGRADED sliding sync, but the long-poll is slow to deliver (e.g. Continuwuity's v5
 *                    holds the poll instead of returning new data promptly). We fall back to an
 *                    unconsumed classic /sync "heartbeat" that pokes the sliding connection on every
 *                    return — classic /sync wakes correctly on every server, so latency stays low.
 *
 * The monitor probes the live sliding-sync path (a no-op self to-device, timed end-to-end) to pick
 * SLIDING_HEALTHY vs SLIDING_DEGRADED, re-probing on reconnect so a fixed/upgraded server recovers
 * to healthy (and a regressed one falls back) without a reload. Transitions are both-ways.
 */

export type SyncMode = 'no_sliding' | 'sliding_healthy' | 'sliding_degraded';

const PROBE_EVENT_TYPE = 'eu.kiefte.wally.sync_wake_probe';
// Healthy delivery is well under a second; a slow/holding server only surfaces the probe at ~the
// poll interval. 2.5s separates them without false-positiving on a slow network.
const PROBE_TIMEOUT_MS = 2500;
// Re-probe at most this often (on reconnects) — server health is per-session-stable, so we don't
// poll continuously; we just re-check when the connection is re-established.
const REPROBE_MIN_INTERVAL_MS = 60_000;
const HEARTBEAT_TIMEOUT_MS = 30000;
const POKE_DEBOUNCE_MS = 150;
// Let the first sync's boot storm (rehydrate, initial window, OlmMachine init, to-device backlog)
// drain before probing, so we measure steady-state long-poll latency, not reload latency.
const SETTLE_DELAY_MS = 6000;

const BOOTSTRAP_FILTER = JSON.stringify({
  presence: { types: [] },
  account_data: { types: [] },
  room: { rooms: [] },
});
const WAKE_FILTER = JSON.stringify({
  presence: { types: [] },
  account_data: { types: [] },
  room: {
    timeline: { limit: 1 },
    state: { types: [] },
    ephemeral: { types: [] },
    account_data: { types: [] },
  },
});

// ---- mode observable (consumed by the top-bar indicator) ------------------------------------------
let currentMode: SyncMode = 'no_sliding';
const modeListeners = new Set<() => void>();
const setMode = (mode: SyncMode): void => {
  if (currentMode === mode) return;
  currentMode = mode;
  modeListeners.forEach((cb) => cb());
};
export const getSyncMode = (): SyncMode => currentMode;
export const subscribeSyncMode = (cb: () => void): (() => void) => {
  modeListeners.add(cb);
  return () => {
    modeListeners.delete(cb);
  };
};

type SlidingSyncLike = { poke?: () => void };
const getSlidingSync = (mx: MatrixClient): SlidingSyncLike | undefined =>
  (mx as unknown as { getSlidingSync?: () => SlidingSyncLike | undefined }).getSlidingSync?.();

/**
 * Probe the sliding-sync path: send a no-op to-device to our own device and time how long sliding
 * sync takes to deliver it back. Returns true if it was SLOW (degraded), false if prompt (healthy).
 * Pokes are not involved, so the measurement reflects the server's native behaviour.
 */
const probeIsDegraded = async (mx: MatrixClient): Promise<boolean> => {
  const userId = mx.getUserId();
  const deviceId = mx.getDeviceId();
  if (!userId || !deviceId) return false; // can't probe → assume healthy

  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let resolveReceived: (delivered: boolean) => void = () => undefined;
  const received = new Promise<boolean>((resolve) => {
    resolveReceived = resolve;
  });
  const onToDevice = (event: MatrixEvent): void => {
    if (
      event.getType() === PROBE_EVENT_TYPE &&
      (event.getContent() as { nonce?: string }).nonce === nonce
    ) {
      resolveReceived(true);
    }
  };
  mx.on(ClientEvent.ToDeviceEvent, onToDevice);
  const t0 = Date.now();
  try {
    const contentMap = new Map([[userId, new Map([[deviceId, { nonce }]])]]);
    await mx.sendToDevice(PROBE_EVENT_TYPE, contentMap);
    const delivered = await Promise.race([
      received,
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), PROBE_TIMEOUT_MS);
      }),
    ]);
    const ms = Date.now() - t0;
    // eslint-disable-next-line no-console
    console.info(
      `[wally] sliding-sync probe: ${
        delivered ? `delivered in ${ms}ms` : `no delivery within ${PROBE_TIMEOUT_MS}ms`
      }`
    );
    return !delivered; // not delivered in time ⇒ degraded
  } catch {
    return false; // probe failed → be conservative: assume healthy
  } finally {
    mx.removeListener(ClientEvent.ToDeviceEvent, onToDevice);
  }
};

class SyncWakeHeartbeat {
  private stopped = false;

  private abort?: AbortController;

  private pokeTimer?: ReturnType<typeof setTimeout>;

  private readonly mx: MatrixClient;

  public constructor(mx: MatrixClient) {
    this.mx = mx;
  }

  public start(): void {
    this.loop().catch(() => undefined);
  }

  public stop(): void {
    this.stopped = true;
    this.abort?.abort();
    if (this.pokeTimer) clearTimeout(this.pokeTimer);
  }

  private pokeSliding(): void {
    if (this.pokeTimer) return; // debounce a burst of activity into one poke
    this.pokeTimer = setTimeout(() => {
      this.pokeTimer = undefined;
      getSlidingSync(this.mx)?.poke?.();
    }, POKE_DEBOUNCE_MS);
  }

  private async loop(): Promise<void> {
    let since: string | undefined;
    while (!this.stopped) {
      this.abort = new AbortController();
      const bootstrap = since === undefined;
      const query: Record<string, string> = {
        timeout: String(bootstrap ? 0 : HEARTBEAT_TIMEOUT_MS),
        filter: bootstrap ? BOOTSTRAP_FILTER : WAKE_FILTER,
      };
      if (since) query.since = since;
      try {
        // eslint-disable-next-line no-await-in-loop
        const resp = await this.mx.http.authedRequest<{ next_batch: string }>(
          Method.Get,
          '/sync',
          query,
          undefined,
          {
            prefix: ClientPrefix.V3,
            localTimeoutMs: HEARTBEAT_TIMEOUT_MS + 10000,
            abortSignal: this.abort.signal,
          }
        );
        since = resp.next_batch;
        if (!bootstrap && !this.stopped) this.pokeSliding();
      } catch {
        if (this.stopped) break;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
          setTimeout(resolve, 2000);
        });
      }
    }
  }
}

/**
 * Start the health monitor for a started client. Sets the mode, runs the fallback heartbeat only
 * while degraded, and re-probes on reconnect so transitions go both ways. Returns a stop function.
 */
export const startSlidingSyncHealth = (mx: MatrixClient): (() => void) => {
  if (!getSlidingSync(mx)) {
    setMode('no_sliding'); // classic /sync — nothing to monitor
    return () => undefined;
  }

  setMode('sliding_healthy'); // optimistic until a probe says otherwise
  let heartbeat: SyncWakeHeartbeat | undefined;
  let stopped = false;
  let probing = false;
  let lastProbeAt = 0;

  const apply = (degraded: boolean): void => {
    if (stopped) return;
    if (degraded) {
      if (!heartbeat) {
        heartbeat = new SyncWakeHeartbeat(mx);
        heartbeat.start();
      }
      setMode('sliding_degraded');
    } else {
      if (heartbeat) {
        heartbeat.stop();
        heartbeat = undefined;
      }
      setMode('sliding_healthy');
    }
  };

  const probe = async (): Promise<void> => {
    if (probing || stopped) return;
    probing = true;
    lastProbeAt = Date.now();
    try {
      const degraded = await probeIsDegraded(mx);
      // A single slow probe could be a network blip — confirm before falling back, so we don't
      // spin up the heartbeat on a fluke. A healthy result is trusted immediately.
      if (degraded && !stopped) {
        await new Promise((resolve) => {
          setTimeout(resolve, 3000);
        });
        const stillDegraded = await probeIsDegraded(mx);
        apply(stillDegraded);
      } else {
        apply(false);
      }
    } finally {
      probing = false;
    }
  };

  let initialProbeDone = false;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  // Probe in STEADY STATE, not during the reload storm. The first sync cycle kicks off cache
  // rehydrate, the initial window, OlmMachine init and a to-device backlog drain — all of which make
  // a to-device round-trip slow for reasons unrelated to the long-poll wake we want to measure.
  // Probing then would false-positive "degraded". So wait for the first sync, let it settle, then
  // probe the long-poll behaviour cleanly.
  const onSync = (state: SyncState, prev: SyncState | null): void => {
    if (state !== SyncState.Syncing && state !== SyncState.Prepared) return;
    if (!initialProbeDone) {
      initialProbeDone = true;
      settleTimer = setTimeout(() => probe().catch(() => undefined), SETTLE_DELAY_MS);
      return;
    }
    // Reconnect re-probe (server may have been fixed/upgraded, or newly degraded), throttled so
    // routine sync churn doesn't probe constantly.
    if (prev === SyncState.Syncing || prev === null) return;
    if (Date.now() - lastProbeAt < REPROBE_MIN_INTERVAL_MS) return;
    probe().catch(() => undefined);
  };
  mx.on(ClientEvent.Sync, onSync);

  return () => {
    stopped = true;
    mx.removeListener(ClientEvent.Sync, onSync);
    if (settleTimer) clearTimeout(settleTimer);
    heartbeat?.stop();
  };
};
