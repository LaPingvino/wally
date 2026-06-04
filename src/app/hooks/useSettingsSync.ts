import { atom, useAtom, useSetAtom } from 'jotai';
import { useCallback, useEffect, useRef } from 'react';
import { MatrixEvent } from 'matrix-js-sdk';
import { settingsAtom } from '../state/settings';
import { useMatrixClient } from './useMatrixClient';
import { useAccountDataCallback } from './useAccountDataCallback';
import {
  SETTINGS_SYNC_EVENT_TYPE,
  deserializeFromSync,
  readSyncEnabled,
  serializeForSync,
  syncableEqual,
} from '../utils/settingsSync';

export type SyncStatus = 'idle' | 'syncing' | 'error';

const DEBOUNCE_MS = 2000;
// Bound on remembered echo tokens. Rapid edits queue several uploads in
// flight; one ref is not enough — a 4-deep ring is plenty for human-paced
// toggling while keeping the memory footprint trivial.
const ECHO_TOKEN_HISTORY = 4;

export const settingsSyncLastSyncedAtom = atom<number | null>(null);
export const settingsSyncStatusAtom = atom<SyncStatus>('idle');

const newToken = (): string => Math.random().toString(36).slice(2, 10);

export function useSettingsSyncEffect(): void {
  const mx = useMatrixClient();
  const [settings, setSettings] = useAtom(settingsAtom);
  const setLastSynced = useSetAtom(settingsSyncLastSyncedAtom);
  const setSyncStatus = useSetAtom(settingsSyncStatusAtom);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const syncEnabled = settings.settingsSyncEnabled;
  // Per-device opt-out: when paused this device is FULLY DECOUPLED — it neither
  // pushes its changes nor applies incoming ones, so a change made here after the
  // switch is a real local override that sticks (a one-way "still receive" pause
  // would let the next remote update steamroll it). Re-enabling rejoins and adopts
  // the shared settings. The account-level enable flag still mirrors independently
  // (applyRemoteEnabled), so the global on/off keeps following the account.
  const effectiveSync = syncEnabled && !settings.settingsSyncPausedLocally;

  // Block uploads until the initial load from account data has run.
  // Without this, a fresh enable of sync on a new device would race the
  // first event delivery and upload the local defaults, clobbering any
  // existing remote state.
  const initialLoadedRef = useRef(false);
  const pendingTokensRef = useRef<string[]>([]);

  // Mirror the cross-device ENABLE switch from account data onto this device,
  // REGARDLESS of the local switch — this is what makes "sync my settings" follow
  // the account. A device that reads `enabled: true` adopts sync (the gated
  // effects below then pull the synced settings); one that reads `false` stays off
  // and waits. Reads null (absent/old blob) leave the local switch untouched.
  const applyRemoteEnabled = useCallback(
    (content: unknown) => {
      const remote = readSyncEnabled(content);
      if (remote === null || remote === settingsRef.current.settingsSyncEnabled) return;
      setSettings({ ...settingsRef.current, settingsSyncEnabled: remote });
    },
    [setSettings]
  );

  // On mount, reconcile the enable flag from the SERVER-authoritative blob: under
  // sliding sync the local account-data copy can be starved on a restored pos, so
  // we fetch it and seed the local store — both so the flag is read, and so the
  // gated initial-load effect can then find the synced settings to apply.
  useEffect(() => {
    let cancelled = false;
    const loaded = mx.getAccountData(SETTINGS_SYNC_EVENT_TYPE)?.getContent();
    if (loaded) applyRemoteEnabled(loaded);
    mx.getAccountDataFromServer(SETTINGS_SYNC_EVENT_TYPE)
      .then((content) => {
        if (cancelled || !content) return;
        if (!mx.getAccountData(SETTINGS_SYNC_EVENT_TYPE)) {
          mx.store?.storeAccountDataEvents?.([
            new MatrixEvent({ type: SETTINGS_SYNC_EVENT_TYPE, content: content as Record<string, unknown> }),
          ]);
        }
        applyRemoteEnabled(content);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mx, applyRemoteEnabled]);

  useEffect(() => {
    if (!effectiveSync) {
      initialLoadedRef.current = false;
      pendingTokensRef.current = [];
      return;
    }
    const event = mx.getAccountData(SETTINGS_SYNC_EVENT_TYPE);
    if (event) {
      const { synctoken: _ignored, ...content } = event.getContent() as Record<string, unknown>;
      const merged = deserializeFromSync(content, settingsRef.current);
      if (merged) {
        if (!syncableEqual(merged, settingsRef.current)) {
          setSettings(merged);
        }
        setLastSynced(Date.now());
      }
    }
    initialLoadedRef.current = true;
  }, [mx, effectiveSync, setSettings, setLastSynced]);

  const onAccountData = useCallback(
    (event: MatrixEvent) => {
      if (event.getType() !== SETTINGS_SYNC_EVENT_TYPE) return;

      const rawContent = event.getContent() as Record<string, unknown>;
      // Reconcile the ENABLE flag first, UNGATED: a remote turn-on (or off) must
      // reach a device whose own switch is currently off. When this flips us on,
      // the gated initial-load effect re-runs and pulls the settings next.
      applyRemoteEnabled(rawContent);
      // Don't apply incoming settings while decoupled (paused) — only the enable
      // flag above is honoured then, so local overrides on this device survive.
      if (!settingsRef.current.settingsSyncEnabled || settingsRef.current.settingsSyncPausedLocally) return;

      const token = rawContent.synctoken;

      if (typeof token === 'string') {
        const idx = pendingTokensRef.current.indexOf(token);
        if (idx !== -1) {
          // Our own echo — drop it (and anything older) to keep the ring
          // bounded and ensure we don't re-recognize a recycled token.
          pendingTokensRef.current.splice(0, idx + 1);
          setLastSynced(Date.now());
          setSyncStatus('idle');
          return;
        }
      }

      const { synctoken: _ignored, ...content } = rawContent;
      const merged = deserializeFromSync(content, settingsRef.current);
      if (!merged) return;
      if (!syncableEqual(merged, settingsRef.current)) {
        setSettings(merged);
      }
      setLastSynced(Date.now());
    },
    [applyRemoteEnabled, setSettings, setLastSynced, setSyncStatus]
  );
  useAccountDataCallback(mx, onAccountData);

  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!effectiveSync) return undefined;
    if (!initialLoadedRef.current) return undefined;

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const token = newToken();
      const tokens = pendingTokensRef.current;
      tokens.push(token);
      if (tokens.length > ECHO_TOKEN_HISTORY) tokens.splice(0, tokens.length - ECHO_TOKEN_HISTORY);
      setSyncStatus('syncing');
      const content = { ...serializeForSync(settingsRef.current), synctoken: token };
      mx.setAccountData(SETTINGS_SYNC_EVENT_TYPE, content).catch(() => {
        const i = pendingTokensRef.current.indexOf(token);
        if (i !== -1) pendingTokensRef.current.splice(i, 1);
        setSyncStatus('error');
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timerRef.current);
  }, [mx, settings, effectiveSync, setSyncStatus]);

  // Propagate an explicit OFF to account data so other sessions stop too. This is
  // the one write the gated upload effect above can't make (it early-returns when
  // disabled). Only on a genuine true→false transition, and only if the blob still
  // says enabled — so MIRRORING a remote off (which already set the blob false)
  // doesn't write it back and loop.
  const prevSyncEnabledRef = useRef(syncEnabled);
  useEffect(() => {
    const was = prevSyncEnabledRef.current;
    prevSyncEnabledRef.current = syncEnabled;
    if (syncEnabled || !was) return; // only true -> false
    const content = mx.getAccountData(SETTINGS_SYNC_EVENT_TYPE)?.getContent();
    if (!content || content.enabled === false) return; // no blob, or already off (mirrored)
    const token = newToken();
    const tokens = pendingTokensRef.current;
    tokens.push(token);
    if (tokens.length > ECHO_TOKEN_HISTORY) tokens.splice(0, tokens.length - ECHO_TOKEN_HISTORY);
    // serializeForSync carries enabled:false now that the local switch is off.
    mx.setAccountData(SETTINGS_SYNC_EVENT_TYPE, {
      ...serializeForSync(settingsRef.current),
      synctoken: token,
    }).catch(() => {});
  }, [mx, syncEnabled]);
}
