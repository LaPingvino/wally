const attemptIndexedDBOpen = (): Promise<boolean> =>
  new Promise((resolve) => {
    const dbName = `checkIndexedDBSupport-${Date.now()}`;
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(dbName);
    } catch {
      resolve(false);
      return;
    }
    req.onsuccess = () => {
      resolve(true);
      indexedDB.deleteDatabase(dbName);
    };
    req.onerror = () => {
      resolve(false);
      indexedDB.deleteDatabase(dbName);
    };
  });

// Retry up to 3 times with 500ms gaps — browsers can briefly block IndexedDB
// immediately after clearing site data (e.g. clear-cookies in private mode).
export const checkIndexedDBSupport = async (): Promise<boolean> => {
  for (let i = 0; i < 3; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 500));
    if (await attemptIndexedDBOpen()) return true;
  }
  return false;
};
