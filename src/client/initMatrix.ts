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
