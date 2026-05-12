// Migrates legacy storage keys to the wally_* / wally-* namespace.
// Runs once per page load on app boot. After 5.0 ships and a deprecation
// window has passed, the legacy reads can be deleted along with this file.

type StorageKind = 'local' | 'session';

type Mapping =
  | { kind: StorageKind; legacy: string; next: string }
  | { kind: StorageKind; legacyPrefix: string; nextPrefix: string };

const MAPPINGS: Mapping[] = [
  { kind: 'local', legacy: 'cinny_hs_base_url', next: 'wally_hs_base_url' },
  { kind: 'local', legacy: 'cinny_user_id', next: 'wally_user_id' },
  { kind: 'local', legacy: 'cinny_device_id', next: 'wally_device_id' },
  { kind: 'local', legacy: 'cinny_access_token', next: 'wally_access_token' },
  { kind: 'local', legacy: 'cinny_toolbar_config', next: 'wally_toolbar_config' },
  { kind: 'local', legacy: 'cinny_sessions', next: 'wally_sessions' },
  { kind: 'local', legacy: 'cinny_device_keys_last', next: 'wally_device_keys_last' },
  { kind: 'local', legacy: 'cinny_mem_reset_at', next: 'wally_mem_reset_at' },
  { kind: 'local', legacy: 'cinny_startup_auto_repair_pending', next: 'wally_startup_auto_repair_pending' },
  { kind: 'local', legacy: 'cinny_activity_dismissed_before', next: 'wally_activity_dismissed_before' },
  { kind: 'local', legacy: 'cinny_activity_dismissed_items', next: 'wally_activity_dismissed_items' },
  { kind: 'local', legacy: 'cinny_hide_read_rooms', next: 'wally_hide_read_rooms' },
  { kind: 'local', legacy: 'cinny_custom_bindings', next: 'wally_custom_bindings' },
  { kind: 'local', legacy: 'cinny_this_session_start', next: 'wally_this_session_start' },
  { kind: 'local', legacy: 'cinny_prev_session_start', next: 'wally_prev_session_start' },
  { kind: 'local', legacy: 'cinny_mem_reports', next: 'wally_mem_reports' },
  { kind: 'local', legacy: 'cinny_thread_panel_width', next: 'wally_thread_panel_width' },
  { kind: 'local', legacy: 'cinny_widget_panel_width', next: 'wally_widget_panel_width' },
  { kind: 'local', legacy: 'cinny_member_panel_width', next: 'wally_member_panel_width' },
  { kind: 'local', legacy: 'cinny_heartbeat_ms', next: 'wally_heartbeat_ms' },
  { kind: 'local', legacy: 'cinny_heartbeat_context', next: 'wally_heartbeat_context' },
  { kind: 'local', legacy: 'cinny_checkpoint_ts', next: 'wally_checkpoint_ts' },
  { kind: 'local', legacyPrefix: 'cinny-issue-view-', nextPrefix: 'wally-issue-view-' },
  { kind: 'session', legacy: 'cinny_active_call', next: 'wally_active_call' },
  { kind: 'session', legacy: 'cinny_recovering_from_crash', next: 'wally_recovering_from_crash' },
  { kind: 'session', legacy: 'cinny-account-slot', next: 'wally-account-slot' },
];

const MIGRATION_MARKER = 'wally_storage_migrated_v1';

function storageFor(kind: StorageKind): Storage {
  return kind === 'local' ? localStorage : sessionStorage;
}

function migrateExactKey(s: Storage, legacy: string, next: string): void {
  const legacyVal = s.getItem(legacy);
  if (legacyVal === null) return;
  if (s.getItem(next) === null) s.setItem(next, legacyVal);
  s.removeItem(legacy);
}

function migratePrefixedKeys(s: Storage, legacyPrefix: string, nextPrefix: string): void {
  // Collect first — mutating storage while iterating its length is unsafe.
  const matches: string[] = [];
  for (let i = 0; i < s.length; i += 1) {
    const k = s.key(i);
    if (k && k.startsWith(legacyPrefix)) matches.push(k);
  }
  for (const legacyKey of matches) {
    const suffix = legacyKey.slice(legacyPrefix.length);
    const nextKey = nextPrefix + suffix;
    const val = s.getItem(legacyKey);
    if (val === null) continue;
    if (s.getItem(nextKey) === null) s.setItem(nextKey, val);
    s.removeItem(legacyKey);
  }
}

let done = false;

export function runStorageMigration(): void {
  if (done) return;
  done = true;
  try {
    if (localStorage.getItem(MIGRATION_MARKER) === '1') return;
    for (const m of MAPPINGS) {
      const s = storageFor(m.kind);
      if ('legacy' in m) migrateExactKey(s, m.legacy, m.next);
      else migratePrefixedKeys(s, m.legacyPrefix, m.nextPrefix);
    }
    localStorage.setItem(MIGRATION_MARKER, '1');
  } catch {
    // Storage can be unavailable (private mode in some browsers); fail silent.
  }
}
