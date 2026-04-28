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
  | 'startup';

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
