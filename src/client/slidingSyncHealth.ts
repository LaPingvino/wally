import { ClientEvent, MatrixClient, MatrixEvent, SyncState } from 'matrix-js-sdk';

/**
 * Sliding-sync health monitor (diagnostic only).
 *
 * Three runtime modes (the top-bar indicator shows which one is live — it doubles as a test
 * readout so we learn what real servers do):
 *
 *   NO_SLIDING       classic /sync (user chose it, or the server lacks MSC4186). /sync IS the sync;
 *                    nothing to detect.
 *   SLIDING_HEALTHY  sliding sync, and the server delivers a self to-device round-trip promptly.
 *   SLIDING_DEGRADED sliding sync, but the round-trip measured slow. Informational only.
 *
 * The monitor probes the live sliding-sync path (a no-op self to-device, timed end-to-end),
 * re-probing on reconnect. Transitions are both-ways.
 *
 * THE FALLBACK HEARTBEAT IS GONE — DO NOT BRING IT BACK. The old "degraded" remedy ran an
 * unconsumed classic /sync long-poll to poke the sliding connection. That /sync's advancing
 * `since` token makes Continuwuity DELETE the device's to-device messages up to that token
 * (v3 remove_to_device_events runs on every request), and the heartbeat discarded what it
 * received — so megolm key shares and verification events were shredded before the dedicated
 * encryption sliding-sync could read them (its long-poll loses the ms-scale race against the
 * heartbeat's immediate re-poll). The bootstrap call even consumed-and-discarded the entire
 * offline to-device queue on each start. Symptoms: intermittent UTDs that "self-heal" via key
 * re-requests, and SAS verifications dying with m.timeout. The premise was also a misdiagnosis:
 * Continuwuity's v5 long-poll DOES wake on data (it returns an empty response and the SDK
 * re-polls immediately); the room connection's real latency comes from the missing conn_id
 * (full-window recompute per request), which no poke can fix. Any future remedy must CONSUME
 * to-device properly (single consumer per device stream) — to-device is delete-on-ack.
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
// Let the first sync's boot storm (rehydrate, initial window, OlmMachine init, to-device backlog)
// drain before probing, so we measure steady-state long-poll latency, not reload latency.
const SETTLE_DELAY_MS = 6000;

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

const hasSlidingSync = (mx: MatrixClient): boolean =>
  Boolean((mx as unknown as { getSlidingSync?: () => unknown }).getSlidingSync?.());

/**
 * Probe the sliding-sync path: send a no-op to-device to our own device and time how long sliding
 * sync takes to deliver it back. Returns true if it was SLOW (degraded), false if prompt (healthy).
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
  // so we can tell "slow but works" (real server latency) from "self to-device never echoes" (the
  // probe itself is invalid, NOT a latency signal). The mode verdict below still uses the faster
  // PROBE_TIMEOUT_MS budget.
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

/**
 * Start the health monitor for a started client. Sets the mode (diagnostic only — no fallback
 * mechanism, see the header) and re-probes on reconnect so transitions go both ways.
 * Returns a stop function.
 */
export const startSlidingSyncHealth = (mx: MatrixClient): (() => void) => {
  if (!hasSlidingSync(mx)) {
    setMode('no_sliding'); // classic /sync — nothing to monitor
    return () => undefined;
  }

  setMode('sliding_healthy'); // optimistic until a probe says otherwise
  let stopped = false;
  let probing = false;
  let lastProbeAt = 0;

  const apply = (degraded: boolean): void => {
    if (stopped) return;
    setMode(degraded ? 'sliding_degraded' : 'sliding_healthy');
  };

  const probe = async (): Promise<void> => {
    if (probing || stopped) return;
    probing = true;
    lastProbeAt = Date.now();
    try {
      const degraded = await probeIsDegraded(mx);
      // A single slow probe could be a network blip — confirm before reporting degraded.
      // A healthy result is trusted immediately.
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
  };
};
