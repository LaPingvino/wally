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
const HEARTBEAT_INTERVAL_MS = 5_000;
// Gap larger than this means the previous session ended without firing
// pagehide — almost certainly an OS/browser crash or a forced tab discard.
const CRASH_GAP_MS = 60_000;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

const writeHeartbeat = (): void => {
  try {
    localStorage.setItem(HEARTBEAT_KEY, String(Date.now()));
  } catch {
    // private browsing / quota exceeded — give up silently
  }
};

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
 * Quick IDB integrity probe — open a throwaway DB and verify a basic
 * read/write cycle. Mirrors the SessionHealthMonitor probe but suitable
 * for synchronous use at startup.
 *
 * Returns true if IDB looks healthy, false if the probe failed.
 */
async function probeIdbHealth(): Promise<boolean> {
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
          // ignore — open will surface the error
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
      // Hard cap: if no event fires within 5s the DB is wedged.
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
 * Run the startup integrity check: capture context, detect crash gaps, and
 * probe IDB health. Logs results to the diagnostics buffer. The caller decides
 * what to do with the result (typically: trigger auto-repair if !idbHealthy).
 */
export async function runStartupIntegrityCheck(): Promise<StartupIntegrityResult> {
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
    await logFailureEvent('unclean_shutdown_detected', {
      gapMs: heartbeatGapMs,
      visibilityState: document.visibilityState,
    });
  }

  if (storage) {
    await logFailureEvent('startup_storage_estimate', storage);
  }

  const idbHealthy = await probeIdbHealth();
  if (!idbHealthy) {
    await logFailureEvent('startup_idb_probe_failed', {
      uncleanShutdown,
      heartbeatGapMs,
      storage,
    });
  }

  return { uncleanShutdown, idbHealthy, storage, heartbeatGapMs };
}
