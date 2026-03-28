import { createClient, MatrixClient, IndexedDBStore, IndexedDBCryptoStore } from 'matrix-js-sdk';

import { cryptoCallbacks } from './secretStorageKeys';
import { clearNavToActivePathStore } from '../app/state/navToActivePath';
import { pushSessionToSW } from '../sw-session';
import { removeSecondarySession } from '../app/state/sessions';

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

  return mx;
};

export const startClient = async (mx: MatrixClient) => {
  await mx.startClient({
    lazyLoadMembers: true,
    initialSyncLimit: 1,
  });
};

export const clearCacheAndReload = async (mx: MatrixClient) => {
  mx.stopClient();
  clearNavToActivePathStore(mx.getSafeUserId());
  await mx.store.deleteAllData();
  window.location.reload();
};

export const logoutClient = async (mx: MatrixClient) => {
  const slotStr = sessionStorage.getItem('cinny-account-slot');
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
      sessionStorage.removeItem('cinny-account-slot');
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
  'cinny_access_token',
  'cinny_device_id',
  'cinny_user_id',
  'cinny_hs_base_url',
] as const;

const SECONDARY_SESSIONS_KEY = 'cinny_sessions';

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
  // If localStorage creds are gone, try restoring from Cache API backup.
  if (!localStorage.getItem('cinny_access_token')) {
    await restoreSessionFromCache();
  }

  // Try restoring from checkpoint before nuking everything.
  const restored = await restoreFromCheckpoint();
  if (restored) {
    window.location.reload();
    return;
  }

  // No checkpoint available — full wipe.
  const dbs = await window.indexedDB.databases();
  dbs.forEach(({ name }) => {
    if (name) window.indexedDB.deleteDatabase(name);
  });
  window.location.reload();
};

// ---------------------------------------------------------------------------
// IndexedDB checkpoint system — periodic snapshots of crypto stores.
//
// After a successful startup + sync, we clone the crypto databases to
// checkpoint copies. On corruption, we restore from the checkpoint instead
// of wiping everything (which forces recovery password re-entry).
// ---------------------------------------------------------------------------
const CHECKPOINT_SUFFIX = '_checkpoint';
const CHECKPOINT_TS_KEY = 'cinny_checkpoint_ts';

/** Names of databases that hold crypto material worth checkpointing. */
function getCryptoDbNames(): string[] {
  const userId = localStorage.getItem('cinny_user_id');
  if (!userId) return [];
  return [
    `crypto${userId}`,            // legacy crypto store
    `matrix-js-sdk${userId}`,     // rust crypto store
  ];
}

/**
 * Clone an IndexedDB database to a new name.
 * Opens source read-only, recreates all object stores + indexes in dest,
 * and copies every record.
 */
async function cloneIDB(srcName: string, destName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const openSrc = indexedDB.open(srcName);
    openSrc.onerror = () => resolve(false);
    openSrc.onsuccess = () => {
      const srcDb = openSrc.result;
      const version = srcDb.version;
      const storeNames = Array.from(srcDb.objectStoreNames);

      if (storeNames.length === 0) {
        srcDb.close();
        resolve(false);
        return;
      }

      // Delete existing checkpoint first.
      const delReq = indexedDB.deleteDatabase(destName);
      delReq.onsuccess = () => createAndCopy();
      delReq.onerror = () => createAndCopy();

      function createAndCopy() {
        const openDest = indexedDB.open(destName, version);
        openDest.onupgradeneeded = () => {
          const destDb = openDest.result;
          for (const storeName of storeNames) {
            const srcStore = srcDb.transaction(storeName, 'readonly').objectStore(storeName);
            const destStore = destDb.createObjectStore(storeName, {
              keyPath: srcStore.keyPath as string | string[] | null,
              autoIncrement: srcStore.autoIncrement,
            });
            for (const idxName of Array.from(srcStore.indexNames)) {
              const idx = srcStore.index(idxName);
              destStore.createIndex(idxName, idx.keyPath, {
                unique: idx.unique,
                multiEntry: idx.multiEntry,
              });
            }
          }
        };
        openDest.onsuccess = () => {
          const destDb = openDest.result;
          // Copy data store by store.
          let pending = storeNames.length;
          if (pending === 0) {
            srcDb.close();
            destDb.close();
            resolve(true);
            return;
          }

          for (const storeName of storeNames) {
            const srcTx = srcDb.transaction(storeName, 'readonly');
            const destTx = destDb.transaction(storeName, 'readwrite');
            const srcStore = srcTx.objectStore(storeName);
            const destStore = destTx.objectStore(storeName);

            const cursorReq = srcStore.openCursor();
            cursorReq.onsuccess = () => {
              const cursor = cursorReq.result;
              if (cursor) {
                destStore.put(cursor.value);
                cursor.continue();
              }
            };

            destTx.oncomplete = () => {
              pending--;
              if (pending === 0) {
                srcDb.close();
                destDb.close();
                resolve(true);
              }
            };
            destTx.onerror = () => {
              pending--;
              if (pending === 0) {
                srcDb.close();
                destDb.close();
                resolve(false);
              }
            };
          }
        };
        openDest.onerror = () => {
          srcDb.close();
          resolve(false);
        };
      }
    };
  });
}

/**
 * Create a checkpoint of all crypto databases.
 * Call after a successful startup + initial sync.
 */
export const checkpointCryptoStores = async (): Promise<void> => {
  const dbNames = getCryptoDbNames();
  let ok = true;
  for (const name of dbNames) {
    const success = await cloneIDB(name, name + CHECKPOINT_SUFFIX);
    if (!success) ok = false;
  }
  if (ok && dbNames.length > 0) {
    localStorage.setItem(CHECKPOINT_TS_KEY, String(Date.now()));
  }
};

/**
 * Restore crypto databases from their checkpoint copies.
 * Returns true if at least one checkpoint was restored.
 */
async function restoreFromCheckpoint(): Promise<boolean> {
  const ts = localStorage.getItem(CHECKPOINT_TS_KEY);
  if (!ts) return false;

  const dbNames = getCryptoDbNames();
  if (dbNames.length === 0) return false;

  // Verify checkpoints exist before deleting originals.
  const allDbs = await indexedDB.databases();
  const allDbNames = new Set(allDbs.map((d) => d.name));
  const checkpointNames = dbNames.map((n) => n + CHECKPOINT_SUFFIX);
  const hasCheckpoints = checkpointNames.some((n) => allDbNames.has(n));
  if (!hasCheckpoints) return false;

  let restored = false;
  for (const name of dbNames) {
    const cpName = name + CHECKPOINT_SUFFIX;
    if (!allDbNames.has(cpName)) continue;

    // Delete corrupted original.
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });

    // Clone checkpoint back to original.
    const ok = await cloneIDB(cpName, name);
    if (ok) restored = true;
  }

  // Also delete the sync store — it'll rebuild from server.
  const userId = localStorage.getItem('cinny_user_id');
  if (userId) {
    indexedDB.deleteDatabase(`sync${userId}`);
    indexedDB.deleteDatabase('web-sync-store');
  }

  return restored;
}
