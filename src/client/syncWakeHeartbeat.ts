import {
  ClientEvent,
  ClientPrefix,
  MatrixClient,
  MatrixEvent,
  Method,
} from 'matrix-js-sdk';

/**
 * Sync-wake heartbeat: gives instant incoming-message latency under simplified sliding sync even on
 * homeservers whose sliding-sync long-poll doesn't return promptly with new data.
 *
 * The bug (e.g. Continuwuity's `v5` handler): the sliding-sync long-poll DOES wake when new data
 * arrives, but returns the response it computed BEFORE the wait — an empty payload with an advanced
 * pos — so fresh events only surface on the NEXT round-trip. The SDK works around it by polling at a
 * short timeout, which caps latency at the poll interval. Classic `/sync`, by contrast, wakes AND
 * rebuilds on every server, so it returns new data instantly.
 *
 * So we run a cheap, *unconsumed* classic `/sync` long-poll purely as a wake SIGNAL: its body is
 * discarded (it never touches the store), and whenever it returns — i.e. the server saw activity —
 * we `poke()` the sliding-sync connection to re-issue its request immediately and pick the data up.
 * This is server-agnostic: it relies only on classic `/sync` waking, which is universal.
 *
 * We only do this on servers that actually have the bug (a startup probe decides), so well-behaved
 * servers pay nothing. The probe result also drives a user-facing warning ({@link useSyncWakeBug}).
 */

// Custom no-op to-device event we send to our own device to measure sliding-sync wake latency.
const PROBE_EVENT_TYPE = 'eu.kiefte.wally.sync_wake_probe';
// A well-behaved server delivers the self to-device through sliding sync in well under a second; a
// buggy one only surfaces it on the next poll (>= the current sliding poll interval). 2.5s cleanly
// separates the two without false-positiving on a slow network.
const PROBE_TIMEOUT_MS = 2500;
// Long idle poll for the heartbeat — it only needs to return when something happens.
const HEARTBEAT_TIMEOUT_MS = 30000;
// Coalesce a burst of activity into a single poke.
const POKE_DEBOUNCE_MS = 150;

// Lean filters: we never want this /sync to do real work, only to WAKE.
//  - bootstrap: grab a `since` token with essentially no payload (no rooms at all).
//  - wake: return on activity with at most one timeline event per affected room, no state/ephemeral.
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

// ---- user-facing "your server has the sliding-sync wake bug" signal -------------------------------
let wakeBugDetected = false;
const wakeBugListeners = new Set<() => void>();

const setWakeBug = (value: boolean): void => {
  if (wakeBugDetected === value) return;
  wakeBugDetected = value;
  wakeBugListeners.forEach((cb) => cb());
};

export const getSyncWakeBug = (): boolean => wakeBugDetected;
export const subscribeSyncWakeBug = (cb: () => void): (() => void) => {
  wakeBugListeners.add(cb);
  return () => {
    wakeBugListeners.delete(cb);
  };
};

type SlidingSyncLike = { poke?: () => void };
const getSlidingSync = (mx: MatrixClient): SlidingSyncLike | undefined =>
  (mx as unknown as { getSlidingSync?: () => SlidingSyncLike | undefined }).getSlidingSync?.();

/**
 * Probe whether the server surfaces new data through sliding sync promptly. Sends a no-op to-device
 * event to our own device and times how long sliding sync takes to deliver it back. Fast ⇒ healthy;
 * timeout ⇒ the wake-without-rebuild bug. Pokes are NOT enabled during the probe, so the measurement
 * isn't contaminated by our own workaround.
 */
const probeWakeBug = async (mx: MatrixClient): Promise<boolean> => {
  const userId = mx.getUserId();
  const deviceId = mx.getDeviceId();
  if (!userId || !deviceId) return false; // can't probe → assume healthy (don't warn / don't run)

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
  try {
    const contentMap = new Map([[userId, new Map([[deviceId, { nonce }]])]]);
    await mx.sendToDevice(PROBE_EVENT_TYPE, contentMap);
    const delivered = await Promise.race([
      received,
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), PROBE_TIMEOUT_MS);
      }),
    ]);
    return !delivered; // delivered fast ⇒ healthy ⇒ not buggy
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
    if (this.pokeTimer) return; // debounce: one poke per window of activity
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
        // The bootstrap call returns the current backlog — don't treat that as "new activity".
        if (!bootstrap && !this.stopped) this.pokeSliding();
      } catch {
        if (this.stopped) break;
        // Abort / network blip → brief pause so we don't tight-loop, then resume.
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
          setTimeout(resolve, 2000);
        });
      }
    }
  }
}

/**
 * Start the sync-wake workaround for a started client. No-op under classic sync (no sliding-sync
 * connection to poke). Probes the server once; only on a buggy server does it run the heartbeat and
 * raise the user-facing warning. Returns a stop function.
 */
export const startSyncWake = (mx: MatrixClient): (() => void) => {
  if (!getSlidingSync(mx)) return () => undefined; // classic sync → nothing to wake

  let heartbeat: SyncWakeHeartbeat | undefined;
  let cancelled = false;

  probeWakeBug(mx)
    .then((buggy) => {
      if (cancelled) return;
      setWakeBug(buggy);
      if (buggy) {
        heartbeat = new SyncWakeHeartbeat(mx);
        heartbeat.start();
      }
    })
    .catch(() => undefined);

  return () => {
    cancelled = true;
    heartbeat?.stop();
    setWakeBug(false);
  };
};
