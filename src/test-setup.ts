// Vitest global setup.
//
// Some modules read `localStorage` at import time (e.g. state/settings.ts → getSettings()), and the
// happy-dom environment doesn't always expose a global `localStorage`. Provide a minimal in-memory
// shim if it's absent so importing those modules in a test doesn't throw.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string): string | null => (store.has(k) ? (store.get(k) as string) : null),
      setItem: (k: string, v: string): void => {
        store.set(k, String(v));
      },
      removeItem: (k: string): void => {
        store.delete(k);
      },
      clear: (): void => {
        store.clear();
      },
      key: (i: number): string | null => Array.from(store.keys())[i] ?? null,
      get length(): number {
        return store.size;
      },
    },
  });
}
