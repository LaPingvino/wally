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
// How long to keep watching for the probe's eventual round-trip (diagnostic only — distinguishes
// "slow but works" from "never echoes"); does not affect the mode verdict.
const PROBE_DIAGNOSTIC_MS = 15000;
// Re-probe at most this often (on reconnects) — server health is per-session-stable, so we don't
// poll continuously; we just re-check when the connection is re-established.
const REPROBE_MIN_INTERVAL_MS = 60_000;
const HEARTBEAT_TIMEOUT_MS = 30000;
// Leading-edge: the first poke after idle fires IMMEDIATELY (no added latency).
// Further activity within the cooldown coalesces into a single trailing poke.
const POKE_COOLDOWN_MS = 150;
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

interface SyncWakeResponse {
  next_batch: string;
  rooms?: {
    join?: Record<string, { timeline?: { events?: unknown[] } }>;
    invite?: Record<string, unknown>;
    leave?: Record<string, unknown>;
  };
}

// Did this /sync return carry a ROOM change worth re-polling the sliding connection
// for — a new timeline event in a joined room, or any invite/leave? A to-device-only
// wake (key shares during a crypto handshake) doesn't need the room connection
// re-polled (the dedicated encryption sync owns to-device), so skip those.
const hasRoomChange = (resp: SyncWakeResponse): boolean => {
  const r = resp.rooms;
  if (!r) return false;
  if (r.invite && Object.keys(r.invite).length > 0) return true;
  if (r.leave && Object.keys(r.leave).length > 0) return true;
  if (r.join && Object.values(r.join).some((j) => (j.timeline?.events?.length ?? 0) > 0)) return true;
  return false;
};

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
  const t0 = Date.now();
  let onArrive: (ms: number | null) => void = () => undefined;
  const arrival = new Promise<number | null>((resolve) => {
    onArrive = resolve;
  });
  const onToDevice = (event: MatrixEvent): void => {
    if (
      event.getType() === PROBE_EVENT_TYPE &&
      (event.getContent() as { nonce?: string }).nonce === nonce
    ) {
      onArrive(Date.now() - t0);
    }
  };
  mx.on(ClientEvent.ToDeviceEvent, onToDevice);
  const giveUp = setTimeout(() => onArrive(null), PROBE_DIAGNOSTIC_MS);

  // Diagnostic (fire-and-forget): report the EVENTUAL round-trip time — or that it never came back —
  // so we can tell "slow but works" (real server latency ⇒ fallback justified) from "self to-device
  // never echoes" (the probe itself is invalid, NOT a latency signal). The mode verdict below still
  // uses the faster PROBE_TIMEOUT_MS budget.
  arrival
    .then((ms) => {
      clearTimeout(giveUp);
      mx.removeListener(ClientEvent.ToDeviceEvent, onToDevice);
      // eslint-disable-next-line no-console
      console.info(
        ms === null
          ? `[wally] sliding-sync probe: NO round-trip within ${PROBE_DIAGNOSTIC_MS}ms — self to-device may not echo (probe invalid, not a server-latency signal)`
          : `[wally] sliding-sync probe: round-tripped in ${ms}ms`
      );
    })
    .catch(() => undefined);

  try {
    const contentMap = new Map([[userId, new Map([[deviceId, { nonce }]])]]);
    await mx.sendToDevice(PROBE_EVENT_TYPE, contentMap);
  } catch {
    onArrive(null);
    return false; // couldn't even send → don't penalise the server
  }

  return Promise.race([
    arrival.then((ms) => ms === null || ms > PROBE_TIMEOUT_MS),
    new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(true), PROBE_TIMEOUT_MS);
    }),
  ]);
};

class SyncWakeHeartbeat {
  private stopped = false;

  private abort?: AbortController;

  private pokeCooldown?: ReturnType<typeof setTimeout>;

  private pokeQueued = false;

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
    if (this.pokeCooldown) clearTimeout(this.pokeCooldown);
  }

  private pokeSliding(): void {
    if (this.pokeCooldown) {
      this.pokeQueued = true; // activity during cooldown → one trailing poke when it ends
      return;
    }
    getSlidingSync(this.mx)?.poke?.(); // leading edge: poke NOW, no added latency
    this.pokeCooldown = setTimeout(() => {
      this.pokeCooldown = undefined;
      if (this.pokeQueued) {
        this.pokeQueued = false;
        this.pokeSliding();
      }
    }, POKE_COOLDOWN_MS);
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
        const resp = await this.mx.http.authedRequest<SyncWakeResponse>(
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
        // Only poke when the wake actually carries a room change — skip to-device-
        // only wakes (key shares) that don't need the room connection re-polled.
        if (!bootstrap && !this.stopped && hasRoomChange(resp)) this.pokeSliding();
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
