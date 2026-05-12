import { createClient, MatrixClient, IndexedDBStore, IndexedDBCryptoStore } from 'matrix-js-sdk';

import { cryptoCallbacks } from './secretStorageKeys';
import { clearNavToActivePathStore } from '../app/state/navToActivePath';
import { pushSessionToSW } from '../sw-session';
import { removeSecondarySession } from '../app/state/sessions';
import { logFailureEvent } from './diagnostics';

type Session = {
  baseUrl: string;
  accessToken: string;
  userId: string;
  deviceId: string;
  fallbackSdkStores?: boolean;
};

const getSessionDbNames = (session: Session) => {
  if (session.fallbackSdkStores) {
    return { sync: 'web-sync-store', crypto: 'crypto-store', rustCrypto: undefined };
  }
  return {
    sync: `sync${session.userId}`,
    crypto: `crypto${session.userId}`,
    rustCrypto: `matrix-js-sdk${session.userId}`,
  };
};

export const initClient = async (session: Session): Promise<MatrixClient> => {
  const dbNames = getSessionDbNames(session);

  const indexedDBStore = new IndexedDBStore({
    indexedDB: global.indexedDB,
    localStorage: global.localStorage,
    dbName: dbNames.sync,
  });

  const legacyCryptoStore = new IndexedDBCryptoStore(global.indexedDB, dbNames.crypto);

  const mx = createClient({
    baseUrl: session.baseUrl,
    accessToken: session.accessToken,
    userId: session.userId,
    store: indexedDBStore,
    cryptoStore: legacyCryptoStore,
    deviceId: session.deviceId,
    timelineSupport: true,
    threadSupport: true,
    cryptoCallbacks: cryptoCallbacks as any,
    verificationMethods: ['m.sas.v1'],
  });

  await Promise.all([
    indexedDBStore.startup(),
    mx.initRustCrypto(dbNames.rustCrypto ? { cryptoDatabasePrefix: dbNames.rustCrypto } : {}),
  ]);

  mx.setMaxListeners(50);

  // Wally uses MatrixRTC + direct LiveKit — disable the legacy 1:1 VoIP
  // CallEventHandler so it doesn't spam "discarding possible call event"
  // warnings for m.call.notify and other MatrixRTC events it doesn't understand.
  // Must also remove the Sync listener that tries to .start() them.
  if ((mx as any).startCallEventHandler) {
    mx.off('sync' as any, (mx as any).startCallEventHandler);
  }
  if ((mx as any).callEventHandler) {
    (mx as any).callEventHandler.stop?.();
    (mx as any).callEventHandler = undefined;
  }
  if ((mx as any).groupCallEventHandler) {
    (mx as any).groupCallEventHandler.stop?.();
    (mx as any).groupCallEventHandler = undefined;
  }

  // Annotate known benign MatrixRTC log noise from the Rust crypto SDK and
  // js-sdk internals so it's obvious these are harmless.
  installMatrixRTCLogFilter();

  return mx;
};

let rtcLogFilterInstalled = false;
function installMatrixRTCLogFilter(): void {
  if (rtcLogFilterInstalled) return;
  rtcLogFilterInstalled = true;

  const origWarn = console.warn.bind(console);
  console.warn = (...args: any[]) => {
    const msg = String(args[0] ?? '');
    // Rust crypto doesn't know about call E2EE key events — it decrypts the
    // Olm layer fine and forwards the inner event to MatrixRTCSession.  Keys
    // are delivered; the warning is cosmetic.  Print the original + an explanation.
    if (msg.includes('unexpected encrypted to-device event') && msg.includes('call.encryption_keys')) {
      origWarn(...args);
      console.info('[Wally] ^ This is fine — Rust crypto decrypted a call E2EE key but doesn\'t recognise the inner event type. The key is still delivered to MatrixRTC normally.');
      return;
    }
    origWarn(...args);
  };

  const origLog = console.log.bind(console);
  console.log = (...args: any[]) => {
    const msg = String(args[0] ?? '');
    // "No targets found for sending key" fires when you're the only call member.
    // Expected during join/leave transitions — nothing to send to.
    if (msg.includes('No targets found for sending key')) {
      origLog(...args);
      console.info('[Wally] ^ Normal — no other call members to send E2EE keys to right now.');
      return;
    }
    origLog(...args);
  };
}

export const startClient = async (mx: MatrixClient) => {
  // Prioritise a fast initial sync over a fully-populated cache. The flag
  // implies `lazyLoadMembers: true` and `initialSyncLimit: 1`, plus the
  // SDK's lazy-tolerant code paths so things like thread bootstrap, on-demand
  // thread-root fetching, and aggregations behave correctly while history
  // populates incrementally through pagination.
  await mx.startClient({
    fullLazyLoading: true,
  });
};

export const clearCacheAndReload = async (mx: MatrixClient) => {
  mx.stopClient();
  clearNavToActivePathStore(mx.getSafeUserId());
  await mx.store.deleteAllData();
  window.location.reload();
};

export const logoutClient = async (mx: MatrixClient) => {
  const slotStr = sessionStorage.getItem('wally-account-slot');
  const slot = slotStr !== null ? parseInt(slotStr, 10) : null;
  const isSecondary =
    window.location.pathname.startsWith('/account/') || slot !== null;

  await clearSessionBackup();
  pushSessionToSW();
  mx.stopClient();
  try {
    await mx.logout();
  } catch {
    // ignore if failed to logout
  }
  await mx.clearStores();

  if (isSecondary) {
    if (slot !== null) {
      removeSecondarySession(slot);
      sessionStorage.removeItem('wally-account-slot');
    } else {
      const pathSlotMatch = window.location.pathname.match(/^\/account\/(\d+)/);
      if (pathSlotMatch) removeSecondarySession(parseInt(pathSlotMatch[1], 10));
    }
    window.location.assign('/');
  } else {
    window.localStorage.clear();
    window.location.reload();
  }
};

export const clearLoginData = async () => {
  await clearSessionBackup();
  const dbs = await window.indexedDB.databases();

  dbs.forEach((idbInfo) => {
    const { name } = idbInfo;
    if (name) {
      window.indexedDB.deleteDatabase(name);
    }
  });

  window.localStorage.clear();
  window.location.reload();
};

// ---------------------------------------------------------------------------
// Session backup via Cache API — independent of both localStorage and IDB.
// If the OS discards the tab and wipes localStorage (Chromebooks), we can
// restore credentials from this backup without requiring a re-login.
// ---------------------------------------------------------------------------
const SESSION_BACKUP_CACHE = 'cinny-session-backup';
const SESSION_BACKUP_KEY = '/_session';

const SESSION_LS_KEYS = [
  'wally_access_token',
  'wally_device_id',
  'wally_user_id',
  'wally_hs_base_url',
] as const;

const SECONDARY_SESSIONS_KEY = 'wally_sessions';

/**
 * Snapshot current localStorage session credentials into the Cache API.
 * Call this periodically (e.g. on each visibility-change health check)
 * so the backup stays current.
 */
export const backupSessionToCache = async (): Promise<void> => {
  try {
    const data: Record<string, string | null> = {};
    for (const key of SESSION_LS_KEYS) {
      data[key] = localStorage.getItem(key);
    }
    // Also back up secondary accounts if present.
    data[SECONDARY_SESSIONS_KEY] = localStorage.getItem(SECONDARY_SESSIONS_KEY);

    // Only back up if we actually have a session.
    if (!data.cinny_access_token || !data.cinny_user_id) return;

    const cache = await caches.open(SESSION_BACKUP_CACHE);
    await cache.put(SESSION_BACKUP_KEY, new Response(JSON.stringify(data)));
  } catch {
    // Cache API unavailable (private browsing, etc.) — silently skip.
  }
};

/**
 * Restore session credentials from Cache API backup into localStorage.
 * Returns true if credentials were successfully restored.
 */
export const restoreSessionFromCache = async (): Promise<boolean> => {
  try {
    const cache = await caches.open(SESSION_BACKUP_CACHE);
    const resp = await cache.match(SESSION_BACKUP_KEY);
    if (!resp) return false;

    const data = await resp.json();
    if (!data.cinny_access_token || !data.cinny_user_id) return false;

    for (const key of SESSION_LS_KEYS) {
      const val = data[key];
      if (val) localStorage.setItem(key, val);
    }
    if (data[SECONDARY_SESSIONS_KEY]) {
      localStorage.setItem(SECONDARY_SESSIONS_KEY, data[SECONDARY_SESSIONS_KEY]);
    }
    logFailureEvent('creds_restored_from_cache');
    return true;
  } catch {
    return false;
  }
};

/** Remove the Cache API backup (on explicit logout). */
export const clearSessionBackup = async (): Promise<void> => {
  try {
    await caches.delete(SESSION_BACKUP_CACHE);
  } catch {
    // ignore
  }
};

/**
 * Delete all IndexedDB databases (removing corrupted data) while preserving
 * localStorage session credentials. The page reloads and the SDK reinitialises
 * fresh — the user stays logged in.
 *
 * If localStorage was also wiped (aggressive Chromebook tab discard), attempts
 * to restore credentials from the Cache API backup first.
 */
export const repairIDBAndReload = async () => {
  const hadCreds = !!localStorage.getItem('wally_access_token');
  await logFailureEvent('idb_repair_started', { hadCreds });

  // If localStorage creds are gone, try restoring from Cache API backup.
  if (!hadCreds) {
    await restoreSessionFromCache();
  }

  // Surface a banner on the next page load so the user knows what's happening
  // instead of staring at a generic splash. Cleared by ClientRoot once sync
  // completes. `checkpoint` vs `wipe` distinguishes the two recovery paths —
  // the wipe path is the one where E2EE may need re-verification.
  try {
    sessionStorage.setItem(
      'wally_recovering_from_crash',
      'pending'
    );
  } catch {
    // ignore — banner is best-effort
  }

  // Try restoring from checkpoint before nuking everything.
  const restored = await restoreFromCheckpoint();
  if (restored) {
    try {
      sessionStorage.setItem('wally_recovering_from_crash', 'checkpoint');
    } catch {
      // ignore
    }
    window.location.reload();
    return;
  }

  // No checkpoint available — full wipe.
  await logFailureEvent('idb_wiped');
  try {
    sessionStorage.setItem('wally_recovering_from_crash', 'wipe');
  } catch {
    // ignore
  }
  const dbs = await window.indexedDB.databases();
  dbs.forEach(({ name }) => {
    if (name) window.indexedDB.deleteDatabase(name);
  });
  window.location.reload();
};

// ---------------------------------------------------------------------------
// Crypto-store checkpoint system — Cache-API-backed snapshots.
//
// Earlier this lived as IDB-to-IDB clones (sibling DBs with a `_checkpoint`
// suffix). That had a structural problem: source and checkpoint live on
// the same volume, so the same dirty-shutdown that corrupts the live
// crypto DB can corrupt the checkpoint too. We now serialise the crypto
// databases into the Cache API instead, which is a separate storage tier
// and is far less likely to fail with the live IDB.
//
// The checkpoint trigger and the recovery flow (`repairIDBAndReload`)
// are unchanged in shape — only the storage medium and the
// serialise/deserialise primitives moved.
// ---------------------------------------------------------------------------

const CHECKPOINT_CACHE = 'cinny-crypto-checkpoint';
const CHECKPOINT_TS_KEY = 'wally_checkpoint_ts';

// matches RUST_SDK_STORE_PREFIX in matrix-js-sdk/lib/rust-crypto/constants.js
const RUST_SDK_STORE_PREFIX = 'matrix-js-sdk';

/**
 * Names of databases that hold crypto material worth checkpointing.
 *
 * Discovers existing DBs via `indexedDB.databases()` and filters to ones
 * that look crypto-related. Crucially we DO NOT call `indexedDB.open()`
 * to verify existence — that creates a new DB if the name doesn't exist,
 * and deleting the stub would race with anything the SDK is doing in
 * parallel (we previously deleted matrix-sdk-crypto-meta this way during
 * its brief no-stores window, breaking decryption of the main store).
 *
 * Both `<prefix>::matrix-sdk-crypto` and `<prefix>::matrix-sdk-crypto-meta`
 * are required: the meta store holds the encryption key for the main one.
 */
async function getCryptoDbNames(): Promise<string[]> {
  const result = new Set<string>();
  try {
    const dbs = await indexedDB.databases();
    for (const info of dbs) {
      const n = info.name;
      if (!n) continue;
      // matrix-js-sdk's own healthcheck DBs — transient, never useful.
      if (n.startsWith('checkIndexedDBSupport-')) continue;
      // Our own probe DBs.
      if (n.startsWith('cinny-startup-probe-')) continue;
      if (n.startsWith('idb-health-')) continue;
      if (
        n.includes('matrix-sdk-crypto') ||
        n.startsWith('crypto@') ||
        n.startsWith('matrix-js-sdk@')
      ) {
        result.add(n);
      }
    }
  } catch {
    // databases() unsupported — fall back to known names only.
    const userId = localStorage.getItem('wally_user_id');
    result.add(`${RUST_SDK_STORE_PREFIX}::matrix-sdk-crypto`);
    result.add(`${RUST_SDK_STORE_PREFIX}::matrix-sdk-crypto-meta`);
    if (userId) {
      result.add(`crypto${userId}`);
      result.add(`matrix-js-sdk${userId}`);
    }
  }
  return Array.from(result);
}

// JSON doesn't carry binary or non-plain types. The crypto stores hold
// Uint8Array values everywhere; the rust store also stashes whole
// ArrayBuffers. Tag them on the way out and reverse on the way in. Maps
// and Sets get the same treatment so we don't lose state if the SDK
// adopts them later.
type Tagged =
  | { __t: 'u8'; v: string }
  | { __t: 'ab'; v: string }
  | { __t: 'date'; v: number }
  | { __t: 'map'; v: [unknown, unknown][] }
  | { __t: 'set'; v: unknown[] };

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

function pack(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Uint8Array) {
    return { __t: 'u8', v: bytesToBase64(value) } satisfies Tagged;
  }
  if (value instanceof ArrayBuffer) {
    return { __t: 'ab', v: bytesToBase64(new Uint8Array(value)) } satisfies Tagged;
  }
  if (value instanceof Date) {
    return { __t: 'date', v: value.getTime() } satisfies Tagged;
  }
  if (value instanceof Map) {
    return {
      __t: 'map',
      v: Array.from(value.entries()).map(([k, v]) => [pack(k), pack(v)]),
    } satisfies Tagged;
  }
  if (value instanceof Set) {
    return { __t: 'set', v: Array.from(value).map(pack) } satisfies Tagged;
  }
  if (Array.isArray(value)) return value.map(pack);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value)) out[k] = pack((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

function unpack(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(unpack);
  if (typeof value === 'object') {
    const tagged = value as Partial<Tagged>;
    if (tagged.__t === 'u8' && typeof tagged.v === 'string') return base64ToBytes(tagged.v);
    if (tagged.__t === 'ab' && typeof tagged.v === 'string') return base64ToBytes(tagged.v).buffer;
    if (tagged.__t === 'date' && typeof tagged.v === 'number') return new Date(tagged.v);
    if (tagged.__t === 'map' && Array.isArray(tagged.v)) {
      return new Map((tagged.v as [unknown, unknown][]).map(([k, v]) => [unpack(k), unpack(v)]));
    }
    if (tagged.__t === 'set' && Array.isArray(tagged.v)) {
      return new Set((tagged.v as unknown[]).map(unpack));
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value)) out[k] = unpack((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

interface IndexMeta {
  name: string;
  keyPath: string | string[];
  unique: boolean;
  multiEntry: boolean;
}
interface StoreMeta {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  indexes: IndexMeta[];
}
interface DbDump {
  name: string;
  version: number;
  stores: StoreMeta[];
  // Records are keyed per store. For stores with a keyPath, the primary
  // key lives inside the value, so `key` is omitted; for keyless stores,
  // we carry it explicitly.
  records: Record<string, { key?: unknown; value: unknown }[]>;
}

async function dumpIDB(dbName: string): Promise<DbDump | null> {
  return new Promise((resolve) => {
    const open = indexedDB.open(dbName);
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const db = open.result;
      const storeNames = Array.from(db.objectStoreNames);
      if (storeNames.length === 0) {
        db.close();
        resolve(null);
        return;
      }

      const dump: DbDump = {
        name: dbName,
        version: db.version,
        stores: [],
        records: {},
      };

      // Single read transaction over all stores so we get a consistent
      // snapshot — earlier we opened a fresh transaction per store, which
      // the SDK could have written to in between.
      const tx = db.transaction(storeNames, 'readonly');
      let pending = storeNames.length;

      for (const storeName of storeNames) {
        const store = tx.objectStore(storeName);
        const meta: StoreMeta = {
          name: storeName,
          keyPath: store.keyPath as string | string[] | null,
          autoIncrement: store.autoIncrement,
          indexes: [],
        };
        for (const idxName of Array.from(store.indexNames)) {
          const idx = store.index(idxName);
          meta.indexes.push({
            name: idxName,
            keyPath: idx.keyPath as string | string[],
            unique: idx.unique,
            multiEntry: idx.multiEntry,
          });
        }
        dump.stores.push(meta);
        dump.records[storeName] = [];

        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            dump.records[storeName].push(
              meta.keyPath
                ? { value: pack(cursor.value) }
                : { key: pack(cursor.primaryKey), value: pack(cursor.value) }
            );
            cursor.continue();
          } else {
            pending -= 1;
            if (pending === 0) {
              db.close();
              resolve(dump);
            }
          }
        };
        cursorReq.onerror = () => {
          pending -= 1;
          if (pending === 0) {
            db.close();
            resolve(dump);
          }
        };
      }

      tx.onerror = () => {
        // Best-effort: return whatever stores already finished.
        db.close();
        resolve(dump);
      };
    };
  });
}

async function restoreIDB(dump: DbDump): Promise<boolean> {
  // Wipe the live DB first. We're called from the recovery path where
  // the live DB is already presumed broken or being replaced.
  await new Promise<void>((r) => {
    const req = indexedDB.deleteDatabase(dump.name);
    req.onsuccess = () => r();
    req.onerror = () => r();
  });

  return new Promise((resolve) => {
    const open = indexedDB.open(dump.name, dump.version);
    open.onupgradeneeded = () => {
      const db = open.result;
      for (const meta of dump.stores) {
        const store = db.createObjectStore(meta.name, {
          keyPath: meta.keyPath ?? undefined,
          autoIncrement: meta.autoIncrement,
        });
        for (const idx of meta.indexes) {
          store.createIndex(idx.name, idx.keyPath, {
            unique: idx.unique,
            multiEntry: idx.multiEntry,
          });
        }
      }
    };
    open.onsuccess = () => {
      const db = open.result;
      const storeNames = dump.stores.map((s) => s.name);
      if (storeNames.length === 0) {
        db.close();
        resolve(true);
        return;
      }
      const tx = db.transaction(storeNames, 'readwrite');
      for (const meta of dump.stores) {
        const store = tx.objectStore(meta.name);
        const recs = dump.records[meta.name] ?? [];
        for (const rec of recs) {
          const value = unpack(rec.value);
          if (meta.keyPath) {
            store.put(value);
          } else {
            store.put(value, unpack(rec.key) as IDBValidKey);
          }
        }
      }
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
    };
    open.onerror = () => resolve(false);
  });
}

async function writeCheckpointBlob(name: string, dump: DbDump): Promise<boolean> {
  try {
    const cache = await caches.open(CHECKPOINT_CACHE);
    await cache.put(
      `/${name}`,
      new Response(JSON.stringify(dump), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
    return true;
  } catch {
    return false;
  }
}

async function readCheckpointBlob(name: string): Promise<DbDump | null> {
  try {
    const cache = await caches.open(CHECKPOINT_CACHE);
    const resp = await cache.match(`/${name}`);
    if (!resp) return null;
    return (await resp.json()) as DbDump;
  } catch {
    return null;
  }
}

/**
 * Snapshot all crypto databases to the Cache API. Called after initial
 * sync settles and on a periodic timer.
 */
export const checkpointCryptoStores = async (): Promise<void> => {
  const dbNames = await getCryptoDbNames();
  if (dbNames.length === 0) return;

  let ok = true;
  for (const name of dbNames) {
    const dump = await dumpIDB(name);
    if (!dump) {
      ok = false;
      logFailureEvent('checkpoint_failed', { db: name, reason: 'dump_returned_null' });
      continue;
    }
    const written = await writeCheckpointBlob(name, dump);
    if (!written) {
      ok = false;
      logFailureEvent('checkpoint_failed', { db: name, reason: 'cache_put_failed' });
    }
  }
  if (ok) {
    localStorage.setItem(CHECKPOINT_TS_KEY, String(Date.now()));
    logFailureEvent('checkpoint_written', { dbs: dbNames });
  }
};

/**
 * List every checkpoint blob currently in the Cache API and return their
 * DB names. Robust against `indexedDB.databases()` not listing names we
 * have blobs for (post-crash, the live DB may be gone but the blob is
 * still in cache — we want to restore it anyway).
 */
async function listCheckpointBlobNames(): Promise<string[]> {
  try {
    const cache = await caches.open(CHECKPOINT_CACHE);
    const reqs = await cache.keys();
    return reqs
      .map((r) => {
        try {
          const u = new URL(r.url);
          // We store blobs at `/${dbName}` — strip the leading slash.
          return decodeURIComponent(u.pathname).replace(/^\//, '');
        } catch {
          return '';
        }
      })
      .filter((n) => n.length > 0);
  } catch {
    return [];
  }
}

/**
 * Restore crypto databases from their Cache-API checkpoints.
 * Returns true if at least one DB was restored.
 */
async function restoreFromCheckpoint(): Promise<boolean> {
  // Source the names from the Cache API itself, not from the live IDB
  // list. The live DBs may have just been wiped/damaged but the blobs
  // survive — and we want to restore every blob we've got.
  const cacheNames = await listCheckpointBlobNames();
  // Union with current crypto DB names as a belt-and-braces safety net
  // (covers a future case where the cache key format changes).
  const fromIdb = await getCryptoDbNames();
  const dbNames = Array.from(new Set([...cacheNames, ...fromIdb]));
  if (dbNames.length === 0) {
    logFailureEvent('checkpoint_missing', { reason: 'no_user_id' });
    return false;
  }

  const dumps: { name: string; dump: DbDump }[] = [];
  for (const name of dbNames) {
    const dump = await readCheckpointBlob(name);
    if (dump) dumps.push({ name, dump });
  }
  if (dumps.length === 0) {
    logFailureEvent('checkpoint_missing', { reason: 'no_blobs', dbs: dbNames });
    return false;
  }

  let restored = false;
  for (const { name, dump } of dumps) {
    const ok = await restoreIDB(dump);
    if (ok) restored = true;
    else logFailureEvent('checkpoint_failed', { db: name, reason: 'restore_failed' });
  }

  // Also delete the sync store — it'll rebuild from server.
  const userId = localStorage.getItem('wally_user_id');
  if (userId) {
    indexedDB.deleteDatabase(`sync${userId}`);
    indexedDB.deleteDatabase('web-sync-store');
  }

  if (restored) {
    logFailureEvent('checkpoint_restored', { dbs: dumps.map((d) => d.name) });
  }
  return restored;
}
