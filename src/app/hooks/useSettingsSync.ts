import { atom, useAtom, useSetAtom } from 'jotai';
import { useCallback, useEffect, useRef } from 'react';
import { MatrixEvent } from 'matrix-js-sdk';
import { settingsAtom } from '../state/settings';
import { useMatrixClient } from './useMatrixClient';
import { useAccountDataCallback } from './useAccountDataCallback';
import {
  SETTINGS_SYNC_EVENT_TYPE,
  deserializeFromSync,
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

  // Block uploads until the initial load from account data has run.
  // Without this, a fresh enable of sync on a new device would race the
  // first event delivery and upload the local defaults, clobbering any
  // existing remote state.
  const initialLoadedRef = useRef(false);
  const pendingTokensRef = useRef<string[]>([]);

  useEffect(() => {
    if (!syncEnabled) {
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
  }, [mx, syncEnabled, setSettings, setLastSynced]);

  const onAccountData = useCallback(
    (event: MatrixEvent) => {
      if (event.getType() !== SETTINGS_SYNC_EVENT_TYPE) return;
      if (!settingsRef.current.settingsSyncEnabled) return;

      const rawContent = event.getContent() as Record<string, unknown>;
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
    [setSettings, setLastSynced, setSyncStatus]
  );
  useAccountDataCallback(mx, onAccountData);

  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!syncEnabled) return undefined;
    if (!initialLoadedRef.current) return undefined;

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const token = newToken();
      const tokens = pendingTokensRef.current;
      tokens.push(token);
      if (tokens.length > ECHO_TOKEN_HISTORY) tokens.splice(0, tokens.length - ECHO_TOKEN_HISTORY);
      setSyncStatus('syncing');
      const content = { ...serializeForSync(settingsRef.current), synctoken: token };
      mx.setAccountData(SETTINGS_SYNC_EVENT_TYPE, content as Record<string, unknown>).catch(() => {
        const i = pendingTokensRef.current.indexOf(token);
        if (i !== -1) pendingTokensRef.current.splice(i, 1);
        setSyncStatus('error');
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timerRef.current);
  }, [mx, settings, syncEnabled, setSyncStatus]);
}
