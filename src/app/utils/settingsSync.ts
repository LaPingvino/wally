import { Settings } from '../state/settings';
import { AccountDataEvent } from '../../types/matrix/accountData';

// Account data event type used to persist synced settings on the homeserver.
// Namespaced under `eu.kiefte.wally` to match other Wally-specific account
// data keys.
export const SETTINGS_SYNC_EVENT_TYPE = AccountDataEvent.WallySettings;

export const SETTINGS_SYNC_VERSION = 1;

// Whitelist of keys that participate in cross-device sync. Anything not on
// this list stays device-local. Whitelist (rather than blacklist) so that
// adding a new local-only setting later does not inadvertently leak across
// devices.
export const SYNCABLE_KEYS = [
  'themeId',
  'useSystemTheme',
  'lightThemeId',
  'darkThemeId',
  'monochromeMode',
  'isMarkdown',
  'editorToolbar',
  'emojiFont',
  'hideActivity',
  'noticeInboxOnlyDefault',
  'noticesMarkUnread',
  'enterForNewline',
  'messageLayout',
  'messageSpacing',
  'hideMembershipEvents',
  'hideNickAvatarEvents',
  'mediaAutoLoad',
  'urlPreview',
  'encUrlPreview',
  'showHiddenEvents',
  'legacyUsernameColor',
  'isNotificationSounds',
  'inRoomActivitySound',
  'reactionToMeSound',
  'inboxUnreadNotifications',
  'inboxNotifBatchDelay',
  'callRingScope',
  'callAutoJoin',
  'hour24Clock',
  'dateFormatString',
  'issueTracker',
  'roomSortOrder',
  'perMessageProfiles',
  'captionPosition',
  'hideBlockedUserReactions',
  'unreadNavBar',
] as const satisfies ReadonlyArray<keyof Settings>;

export type SyncableKey = (typeof SYNCABLE_KEYS)[number];

export type SettingsSyncContent = {
  v: number;
  settings: Partial<Pick<Settings, SyncableKey>>;
  // Random token written by the uploading device so its own echo back via
  // ClientEvent.AccountData can be filtered out instead of round-tripping.
  synctoken?: string;
};

const pickSyncable = (settings: Settings): Partial<Pick<Settings, SyncableKey>> => {
  const out: Record<string, unknown> = {};
  for (const key of SYNCABLE_KEYS) {
    out[key] = settings[key];
  }
  return out as Partial<Pick<Settings, SyncableKey>>;
};

export const serializeForSync = (settings: Settings): SettingsSyncContent => ({
  v: SETTINGS_SYNC_VERSION,
  settings: pickSyncable(settings),
});

// Validate incoming account data and merge it into current settings.
// Returns null when the data is invalid or from an incompatible schema
// version. Only whitelisted keys are taken from the remote payload —
// everything else stays from `currentSettings`.
export const deserializeFromSync = (
  data: unknown,
  currentSettings: Settings
): Settings | null => {
  if (!data || typeof data !== 'object') return null;
  const content = data as Record<string, unknown>;
  if (content.v !== SETTINGS_SYNC_VERSION) return null;
  const remote = content.settings;
  if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return null;
  const remoteObj = remote as Record<string, unknown>;

  const merged: Settings = { ...currentSettings };
  for (const key of SYNCABLE_KEYS) {
    if (key in remoteObj) {
      (merged as unknown as Record<string, unknown>)[key] = remoteObj[key];
    }
  }
  return merged;
};

// Shallow compare two settings objects across syncable keys only. Faster
// and more predictable than JSON.stringify when the only change is e.g. a
// non-syncable field.
export const syncableEqual = (a: Settings, b: Settings): boolean => {
  for (const key of SYNCABLE_KEYS) {
    if (a[key] !== b[key]) return false;
  }
  return true;
};

export const exportSettingsAsJson = (settings: Settings): void => {
  const payload = JSON.stringify(serializeForSync(settings), null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wally-settings-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

export const importSettingsFromJson = (
  currentSettings: Settings
): Promise<Settings | null> =>
  new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target?.result as string);
          resolve(deserializeFromSync(data, currentSettings));
        } catch {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
