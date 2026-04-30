// Failure-mode event log.
//
// We have several layers of crash/corruption recovery. Until now, when a
// user reports "Wally needed the recovery key again," we have no record
// of which path fired or why — IDB probe failed? credentials wiped? a
// checkpoint restore that succeeded but the SDK still re-prompted? The
// recovery-key prompt itself? — so we have no basis to choose between
// fixing layer N vs. layer M.
//
// This module appends timestamped events to a Cache API entry (independent
// of localStorage and IDB, so it survives the failures we're trying to
// understand). On startup we dump the buffer to the console; the user can
// open devtools after a recovery event and read the trail.
//
// Cap at MAX_EVENTS so the buffer can't grow unbounded.

const DIAG_CACHE = 'cinny-diagnostics';
const DIAG_KEY = '/events';
const MAX_EVENTS = 200;

export type FailureEventKind =
  | 'idb_probe_failed'
  | 'creds_restored_from_cache'
  | 'idb_repair_started'
  | 'checkpoint_restored'
  | 'checkpoint_missing'
  | 'idb_wiped'
  | 'checkpoint_written'
  | 'checkpoint_failed'
  | 'recovery_key_prompt_shown'
  | 'startup'
  | 'unclean_shutdown_detected'
  | 'startup_idb_probe_failed'
  | 'startup_auto_repair'
  | 'startup_storage_estimate';

export interface FailureEvent {
  ts: number;
  kind: FailureEventKind;
  details?: Record<string, unknown>;
}

async function readEvents(): Promise<FailureEvent[]> {
  try {
    const cache = await caches.open(DIAG_CACHE);
    const resp = await cache.match(DIAG_KEY);
    if (!resp) return [];
    return (await resp.json()) as FailureEvent[];
  } catch {
    return [];
  }
}

async function writeEvents(events: FailureEvent[]): Promise<void> {
  try {
    const cache = await caches.open(DIAG_CACHE);
    await cache.put(
      DIAG_KEY,
      new Response(JSON.stringify(events), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
  } catch {
    // ignore
  }
}

/**
 * Append a single failure event. Best-effort: any storage failure is
 * swallowed because diagnostics must never themselves break the app.
 */
export async function logFailureEvent(
  kind: FailureEventKind,
  details?: Record<string, unknown>
): Promise<void> {
  const event: FailureEvent = { ts: Date.now(), kind };
  if (details) event.details = details;
  const events = await readEvents();
  events.push(event);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  await writeEvents(events);
}

/** Fetch the full buffer. */
export async function getFailureLog(): Promise<FailureEvent[]> {
  return readEvents();
}

/**
 * Print the buffer to console. Call once at startup so anyone opening
 * devtools after a recovery event sees the trail without having to know
 * about the Cache API entry.
 */
export async function dumpFailureLog(): Promise<void> {
  const events = await readEvents();
  if (events.length === 0) return;
  // eslint-disable-next-line no-console
  console.groupCollapsed(`[Wally] failure log (${events.length} events)`);
  for (const ev of events) {
    // eslint-disable-next-line no-console
    console.log(new Date(ev.ts).toISOString(), ev.kind, ev.details ?? '');
  }
  // eslint-disable-next-line no-console
  console.groupEnd();
}

/** Clear the diagnostics buffer (e.g. on explicit logout). */
export async function clearFailureLog(): Promise<void> {
  try {
    await caches.delete(DIAG_CACHE);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Crash detection + startup IDB probe.
//
// The recurring "Failed to load. Query failed: UnknownError" prompt almost
// always traces back to a Chromebook OS crash that interrupts an in-flight
// IndexedDB transaction. The next page load opens that DB in an inconsistent
// state and matrix-js-sdk throws on the first crypto query.
//
// We detect the unclean-shutdown case via a localStorage heartbeat and run a
// startup IDB probe BEFORE matrix-js-sdk gets near it. If the probe fails we
// trigger the existing repair flow automatically — the user never sees the
// scary prompt for this category of failure.
// ---------------------------------------------------------------------------

const HEARTBEAT_KEY = 'cinny_heartbeat_ms';
const HEARTBEAT_CONTEXT_KEY = 'cinny_heartbeat_context';
const HEARTBEAT_INTERVAL_MS = 5_000;
// Gap larger than this means the previous session ended without firing
// pagehide — almost certainly an OS/browser crash or a forced tab discard.
const CRASH_GAP_MS = 60_000;

// Active context the app reports for forensics. Updated via setHeartbeatContext.
const heartbeatContext: Record<string, unknown> = {};
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

const writeHeartbeat = (): void => {
  try {
    localStorage.setItem(HEARTBEAT_KEY, String(Date.now()));
    if (Object.keys(heartbeatContext).length > 0) {
      localStorage.setItem(HEARTBEAT_CONTEXT_KEY, JSON.stringify(heartbeatContext));
    }
  } catch {
    // private browsing / quota exceeded — give up silently
  }
};

/**
 * Update the per-tick context that gets written alongside the heartbeat.
 * Use this to record what the app was doing when (if) the OS kills us:
 *   setHeartbeatContext({ syncing: true, lastEventTs: Date.now() })
 * Keys merge; pass undefined to clear a key.
 */
export function setHeartbeatContext(patch: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete heartbeatContext[k];
    else heartbeatContext[k] = v;
  }
}

function readHeartbeatContext(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(HEARTBEAT_CONTEXT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Begin writing a heartbeat to localStorage every 5s. Idempotent. */
export function startHeartbeat(): void {
  if (heartbeatTimer !== null) return;
  writeHeartbeat();
  heartbeatTimer = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);
  // Best-effort clean-shutdown marker. Not load-bearing — the heartbeat gap
  // detection works without it. pagehide fires more reliably than
  // beforeunload on Chromebook tab discard.
  window.addEventListener('pagehide', writeHeartbeat);
}

/**
 * Read the previous heartbeat. Returns the gap in milliseconds, or null if
 * there's no prior heartbeat to compare against (first run, private mode).
 */
function readHeartbeatGapMs(): number | null {
  try {
    const raw = localStorage.getItem(HEARTBEAT_KEY);
    if (!raw) return null;
    const last = Number(raw);
    if (!Number.isFinite(last) || last <= 0) return null;
    return Date.now() - last;
  } catch {
    return null;
  }
}

/**
 * Open a single existing IDB by name and run a no-op read transaction
 * across all of its object stores. Returns true if the DB opens AND a
 * trivial cursor read on every store completes; false on any error.
 *
 * This is what we actually need to detect the Chromebook-crash scenario:
 * a fresh-throwaway-DB probe will pass even when the real crypto DB has
 * a corrupted index, because the OS only fails operations on the bad
 * file. Probing the real DBs by name catches that case.
 */
function probeExistingIdb(name: string): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (ok: boolean, reason?: string) => {
      if (settled) return;
      settled = true;
      resolve(reason ? { ok, reason } : { ok });
    };
    try {
      // Don't pass a version — we want to open whatever's there.
      const req = indexedDB.open(name);
      req.onerror = () => settle(false, `open onerror: ${String(req.error)}`);
      req.onblocked = () => settle(false, 'open onblocked');
      req.onupgradeneeded = () => {
        // The DB doesn't exist (would be created here). Treat as ok —
        // the absence of a DB isn't the failure mode we're looking for.
      };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const stores = Array.from(db.objectStoreNames);
          if (stores.length === 0) {
            db.close();
            settle(true);
            return;
          }
          const tx = db.transaction(stores, 'readonly');
          tx.onerror = () => {
            db.close();
            settle(false, `tx onerror: ${String(tx.error)}`);
          };
          tx.onabort = () => {
            db.close();
            settle(false, `tx onabort: ${String(tx.error)}`);
          };
          tx.oncomplete = () => {
            db.close();
            settle(true);
          };
          // Touch every store with a count() so the underlying btree pages
          // get exercised. count() is cheap but enough to surface index
          // corruption.
          for (const s of stores) {
            const cReq = tx.objectStore(s).count();
            cReq.onerror = () => {
              try {
                tx.abort();
              } catch {
                // ignore
              }
            };
          }
        } catch (e) {
          db.close();
          settle(false, `tx threw: ${String(e)}`);
        }
      };
      // Hard cap.
      setTimeout(() => settle(false, 'timeout'), 5_000);
    } catch (e) {
      settle(false, `open threw: ${String(e)}`);
    }
  });
}

/**
 * Probe every existing IDB the browser knows about. Catches the
 * Chromebook-crash scenario where any one of the SDK's databases
 * (matrix-js-sdk crypto store, sync store, secret storage etc.) has
 * a corrupted index. Returns null on success, or first failure detail.
 */
async function probeCryptoIdbs(): Promise<{ db: string; reason: string } | null> {
  let dbs: { name?: string; version?: number }[];
  try {
    dbs = await indexedDB.databases();
  } catch (e) {
    return { db: '<list>', reason: `databases() threw: ${String(e)}` };
  }
  for (const info of dbs) {
    if (!info.name) continue;
    // Skip transient/throwaway DBs:
    //   - our own probe DBs from this and the legacy session-health probe
    //   - matrix-js-sdk's healthcheck DBs (created+deleted in a tight
    //     loop during init; opening one as it's being deleted times out
    //     and triggers a false-positive auto-repair).
    if (info.name.startsWith('cinny-startup-probe-')) continue;
    if (info.name.startsWith('idb-health-')) continue;
    if (info.name.startsWith('checkIndexedDBSupport-')) continue;
    // eslint-disable-next-line no-await-in-loop
    const r = await probeExistingIdb(info.name);
    if (!r.ok) return { db: info.name, reason: r.reason ?? 'unknown' };
  }
  return null;
}

/**
 * Light fallback probe — a fresh throwaway DB read/write.
 * Catches the case where IDB itself is completely wedged (rare).
 */
async function probeFreshIdb(): Promise<boolean> {
  const dbName = `cinny-startup-probe-${Date.now()}`;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try {
        indexedDB.deleteDatabase(dbName);
      } catch {
        // ignore
      }
      resolve(ok);
    };
    try {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        try {
          req.result.createObjectStore('s');
        } catch {
          // ignore
        }
      };
      req.onsuccess = () => {
        try {
          const db = req.result;
          const tx = db.transaction('s', 'readwrite');
          tx.objectStore('s').put('v', 'k');
          tx.oncomplete = () => {
            db.close();
            settle(true);
          };
          tx.onerror = () => {
            db.close();
            settle(false);
          };
          tx.onabort = () => {
            db.close();
            settle(false);
          };
        } catch {
          settle(false);
        }
      };
      req.onerror = () => settle(false);
      req.onblocked = () => settle(false);
      setTimeout(() => settle(false), 5_000);
    } catch {
      settle(false);
    }
  });
}

export interface StartupIntegrityResult {
  /** Whether the previous session ended without a clean shutdown. */
  uncleanShutdown: boolean;
  /** Whether the startup IDB probe succeeded. */
  idbHealthy: boolean;
  /** Storage estimate, when supported. */
  storage?: { usage?: number; quota?: number };
  /** Heartbeat gap in ms, when known. */
  heartbeatGapMs: number | null;
}

/**
 * Expose the failure log on `window.wallyDiag` so you can call
 * `wallyDiag()` (or `await wallyDiag.json()`) from devtools at any time
 * to inspect what's been logged — even when the app failed to load.
 */
export function exposeDiagnosticsOnWindow(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (w.wallyDiag) return;
  const fn = () => {
    void dumpFailureLog();
  };
  fn.json = () => getFailureLog();
  fn.clear = () => clearFailureLog();
  w.wallyDiag = fn;
}

/**
 * Run the startup integrity check: capture context, detect crash gaps, and
 * probe IDB health. Logs results to the diagnostics buffer. The caller decides
 * what to do with the result (typically: trigger auto-repair if !idbHealthy).
 *
 * Always dumps the existing failure log to console first so anyone opening
 * devtools after a recovery sees the trail without depending on later
 * components mounting.
 */
export async function runStartupIntegrityCheck(): Promise<StartupIntegrityResult> {
  // Dump prior log first thing — we want it visible even if startup
  // bails partway through. logFailureEvent('startup') is fire-and-forget
  // so it doesn't block the integrity check.
  void logFailureEvent('startup');
  await dumpFailureLog();
  exposeDiagnosticsOnWindow();

  const heartbeatGapMs = readHeartbeatGapMs();
  const uncleanShutdown =
    heartbeatGapMs !== null && heartbeatGapMs > CRASH_GAP_MS;

  let storage: { usage?: number; quota?: number } | undefined;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      storage = { usage: est.usage, quota: est.quota };
    }
  } catch {
    // ignore
  }

  if (uncleanShutdown) {
    const lastContext = readHeartbeatContext();
    await logFailureEvent('unclean_shutdown_detected', {
      gapMs: heartbeatGapMs,
      visibilityState: document.visibilityState,
      // What the app was doing at the last heartbeat — blank means no
      // consumer set context yet (e.g., crash before initial sync).
      lastContext: lastContext ?? null,
    });
  }

  if (storage) {
    await logFailureEvent('startup_storage_estimate', storage);
  }

  // Probe the actual crypto DBs by name first — that's where the
  // Chromebook crash damage actually lives. A fresh-DB probe is only a
  // last-ditch sanity check.
  const cryptoFault = await probeCryptoIdbs();
  let idbHealthy = cryptoFault === null;
  let probeReason: { db?: string; reason?: string } | undefined;
  if (cryptoFault) {
    probeReason = cryptoFault;
  } else {
    const freshOk = await probeFreshIdb();
    if (!freshOk) {
      idbHealthy = false;
      probeReason = { reason: 'fresh_db_probe_failed' };
    }
  }
  if (!idbHealthy) {
    await logFailureEvent('startup_idb_probe_failed', {
      uncleanShutdown,
      heartbeatGapMs,
      storage,
      ...probeReason,
    });
  }

  return { uncleanShutdown, idbHealthy, storage, heartbeatGapMs };
}

/**
 * Hook a global unhandledrejection listener that catches IDB UnknownErrors
 * fired from background promises (e.g. matrix-sdk-crypto's internal
 * queries). Even when these don't crash the app, they signal that crypto
 * is degraded and the user is heading toward the "unverified" state.
 *
 * Calls `onCryptoIdbError` once per page lifetime (rate-limited) so the
 * caller can decide whether to prompt for repair.
 */
export function installCryptoIdbErrorListener(
  onCryptoIdbError: (info: { message: string; stack?: string }) => void
): () => void {
  let fired = false;
  const handler = (ev: PromiseRejectionEvent) => {
    if (fired) return;
    const reason = ev.reason;
    const message =
      reason instanceof Error ? reason.message : String(reason ?? '');
    const stack = reason instanceof Error ? reason.stack : undefined;
    if (!/Query failed|UnknownError|IDBDatabase|IDBTransaction/i.test(message)) {
      return;
    }
    fired = true;
    void logFailureEvent('startup_idb_probe_failed', {
      source: 'unhandledrejection',
      message,
      stack: stack?.split('\n').slice(0, 5).join('\n'),
    });
    try {
      onCryptoIdbError({ message, stack });
    } catch {
      // never break startup
    }
  };
  window.addEventListener('unhandledrejection', handler);
  return () => window.removeEventListener('unhandledrejection', handler);
}
