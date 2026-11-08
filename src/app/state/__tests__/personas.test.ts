import { describe, it, expect } from 'vitest';
import { createStore } from 'jotai';
import { savedPersonasAtom } from '../personas';

describe('savedPersonasAtom', () => {
  it('applies a function update to the list as it is then (async avatar uploads)', () => {
    const store = createStore();
    store.set(savedPersonasAtom, [{ displayname: 'A', avatar_url: 'https://x/a.png' }]);
    // An edit lands while an upload for A is in flight…
    store.set(savedPersonasAtom, (prev) => [...prev, { displayname: 'B' }]);
    // …and the upload patches A without undoing it.
    store.set(savedPersonasAtom, (prev) =>
      prev.map((p) => (p.displayname === 'A' ? { ...p, avatar_url: 'mxc://x/a' } : p))
    );
    expect(store.get(savedPersonasAtom)).toEqual([
      { displayname: 'A', avatar_url: 'mxc://x/a' },
      { displayname: 'B' },
    ]);
  });
});
