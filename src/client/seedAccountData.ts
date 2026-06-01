import { ClientEvent, MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { AccountDataEvent } from '../types/matrix/accountData';

// Global account-data seeding for sliding sync.
//
// Under simplified sliding sync the homeserver (Continuwuity) only resends
// GLOBAL account-data that CHANGED since the persisted pos — and on a restored
// pos it resends nothing. The SDK fork seeds m.direct / m.ignored_user_list /
// m.push_rules, but everything ELSE cinny reads comes up empty on reload:
//  - secret-storage + cross-signing → encryption looks un-set-up AND device
//    verification can't complete (the cross-signing keys live here), which is
//    the user-visible "emoji compare connects then stalls".
//  - in.cinny.spaces → sidebar space order resets to default.
//  - eu.kiefte.wally.settings → synced settings revert to device defaults.
//  - im.ponies.* / io.element.recent_emoji → custom + recent emoji vanish.
//
// Fetch each straight from the server once on startup, inject into the store,
// and emit ClientEvent.AccountData so the reactive hooks (which already listen
// for it, e.g. mDirectList) pick the value up. Idempotent: anything already
// present locally is left untouched.

const seedOne = async (mx: MatrixClient, type: string): Promise<Record<string, unknown> | null> => {
  const local = mx.getAccountData(type as never)?.getContent() as Record<string, unknown> | undefined;
  if (local && Object.keys(local).length > 0) return local;
  try {
    const content = (await mx.getAccountDataFromServer(type as never)) as Record<string, unknown> | null;
    if (!content || Object.keys(content).length === 0) return null;
    const ev = new MatrixEvent({ type, content });
    const prev = mx.getAccountData(type as never);
    mx.store.storeAccountDataEvents([ev]);
    mx.emit(ClientEvent.AccountData, ev, prev);
    return content;
  } catch {
    // not set / not reachable — callers fall back to defaults
    return null;
  }
};

export const seedAccountData = (mx: MatrixClient): void => {
  void (async () => {
    // Simple global types cinny reads directly.
    await Promise.all(
      [
        AccountDataEvent.CinnySpaces,
        AccountDataEvent.WallySettings,
        AccountDataEvent.PoniesUserEmotes,
        AccountDataEvent.PoniesEmoteRooms,
        AccountDataEvent.ElementRecentEmoji,
      ].map((t) => seedOne(mx, t))
    );

    // Secret storage + cross-signing: needed for the encryption banner state
    // and — the important one — to COMPLETE SAS device verification. Two-step:
    // the default-key event names the key id, then fetch that specific key.
    // (Use the canonical Matrix type strings; cinny's enum abbreviates the
    // self/user cross-signing keys without the `_signing` suffix.)
    const defaultKey = await seedOne(mx, AccountDataEvent.SecretStorageDefaultKey);
    const keyId = defaultKey?.key as string | undefined;
    await Promise.all([
      keyId ? seedOne(mx, `m.secret_storage.key.${keyId}`) : Promise.resolve(null),
      seedOne(mx, 'm.cross_signing.master'),
      seedOne(mx, 'm.cross_signing.self_signing'),
      seedOne(mx, 'm.cross_signing.user_signing'),
      seedOne(mx, 'm.megolm_backup.v1'),
    ]);
  })();
};
