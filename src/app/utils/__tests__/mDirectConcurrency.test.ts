import { describe, expect, it } from 'vitest';
import { MatrixClient } from 'matrix-js-sdk';
import { addRoomIdToMDirect } from '../matrix';
import { exploreInterleavings, Gate } from '../../../test/interleave';

/**
 * m.direct is a read-modify-write against the server, so two taggings that
 * overlap both read the same base and the second write drops the first — the
 * room silently stops being a DM.
 *
 * Today every caller happens to serialise (rateLimitedActions is a sequential
 * for-loop), so this never fires in practice. That is exactly why it is worth a
 * test: the guarantee lives in the CALLERS, and one `Promise.all` would take it
 * away with nothing to notice. The invariant belongs to the function.
 */

type Content = Record<string, string[]>;

const makeMx = (gate: Gate, read: () => Content, write: (c: Content) => void) => {
  const emitted: unknown[] = [];
  const mx = {
    // Both the read and the write suspend, so the explorer can interleave them.
    getAccountDataFromServer: async () => {
      await gate.wait('read');
      return structuredClone(read());
    },
    setAccountData: async (_type: string, content: Content) => {
      await gate.wait('write');
      write(structuredClone(content));
    },
    getAccountData: () => undefined,
    store: { storeAccountDataEvents: () => undefined },
    emit: (...args: unknown[]) => {
      emitted.push(args);
      return true;
    },
  };
  return mx as unknown as MatrixClient;
};

describe('addRoomIdToMDirect under concurrency', () => {
  it('keeps every tagged room under every interleaving', async () => {
    let content: Content = {};

    const report = await exploreInterleavings({
      reset: () => {
        content = {};
      },
      run: async (gate) => {
        const mx = makeMx(
          gate,
          () => content,
          (next) => {
            content = next;
          }
        );
        await Promise.all([
          addRoomIdToMDirect(mx, '!room-a:server', '@alice:server'),
          addRoomIdToMDirect(mx, '!room-b:server', '@bob:server'),
        ]);
      },
      invariant: () => {
        expect(content['@alice:server'] ?? []).toContain('!room-a:server');
        expect(content['@bob:server'] ?? []).toContain('!room-b:server');
      },
    });

    // With the operation serialised there IS only one possible ordering — that
    // collapse of the interleaving space is exactly what the fix buys, so this
    // asserts 1, not "many". The explorer's ability to find violations when they
    // exist is proven separately, in src/test/__tests__/interleave.test.ts.
    expect(report.explored).toBe(1);
    expect(report.schedules[0]).toEqual(['read', 'write', 'read', 'write']);
  });
});
