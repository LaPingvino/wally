import { atom } from 'jotai';

const STORAGE_KEY = 'settings';
export type DateFormat = 'D MMM YYYY' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY/MM/DD' | '';
export type MessageSpacing = '0' | '100' | '200' | '300' | '400' | '500';
export enum MessageLayout {
  Modern = 0,
  Compact = 1,
  Bubble = 2,
}
export enum EmojiFont {
  System = 'system',
  Twemoji = 'twemoji',
  NotoColorEmojiBahai = 'noto-bahai',
}

export interface Settings {
  themeId?: string;
  useSystemTheme: boolean;
  lightThemeId?: string;
  darkThemeId?: string;
  monochromeMode?: boolean;
  isMarkdown: boolean;
  editorToolbar: boolean;
  emojiFont: EmojiFont;
  twitterEmoji?: boolean; // deprecated, kept for migration
  pageZoom: number;
  hideActivity: boolean;

  isPeopleDrawer: boolean;
  memberSortFilterIndex: number;
  enterForNewline: boolean;
  messageLayout: MessageLayout;
  messageSpacing: MessageSpacing;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
  mediaAutoLoad: boolean;
  urlPreview: boolean;
  encUrlPreview: boolean;
  showHiddenEvents: boolean;
  legacyUsernameColor: boolean;

  showNotifications: boolean;
  isNotificationSounds: boolean;
  inRoomActivitySound: boolean;
  inboxUnreadNotifications: boolean;
  // Minimum seconds between inbox unread notifications (0 = ~1s debounce only)
  inboxNotifBatchDelay: number;
  callRingScope: 'dm' | 'nonVoice' | 'all';
  callRingtoneUrl: string | null;
  callAutoJoin: boolean;

  hour24Clock: boolean;
  dateFormatString: string;

  developerTools: boolean;
  issueTracker: boolean;
  multiAccount: boolean;
  roomSortOrder: 'activity' | 'az' | 'unread' | 'admin';
  perMessageProfiles: boolean;
}

const defaultSettings: Settings = {
  themeId: undefined,
  useSystemTheme: true,
  lightThemeId: undefined,
  darkThemeId: undefined,
  monochromeMode: false,
  isMarkdown: true,
  editorToolbar: false,
  emojiFont: EmojiFont.System,
  pageZoom: 100,
  hideActivity: false,

  isPeopleDrawer: true,
  memberSortFilterIndex: 0,
  enterForNewline: false,
  messageLayout: 0,
  messageSpacing: '400',
  hideMembershipEvents: false,
  hideNickAvatarEvents: true,
  mediaAutoLoad: true,
  urlPreview: true,
  encUrlPreview: false,
  showHiddenEvents: false,
  legacyUsernameColor: false,

  showNotifications: true,
  isNotificationSounds: true,
  inRoomActivitySound: true,
  inboxUnreadNotifications: false,
  inboxNotifBatchDelay: 60,
  callRingScope: 'nonVoice',
  callRingtoneUrl: null,
  callAutoJoin: false,

  hour24Clock: false,
  dateFormatString: 'D MMM YYYY',

  developerTools: false,
  issueTracker: false,
  multiAccount: false,
  roomSortOrder: 'activity',
  perMessageProfiles: false,
};

export const getSettings = () => {
  const settings = localStorage.getItem(STORAGE_KEY);
  if (settings === null) return defaultSettings;
  const parsed = JSON.parse(settings) as Settings;

  // Migrate old twitterEmoji boolean to new emojiFont enum
  if (parsed.twitterEmoji !== undefined && parsed.emojiFont === undefined) {
    parsed.emojiFont = parsed.twitterEmoji ? EmojiFont.Twemoji : EmojiFont.System;
    delete parsed.twitterEmoji;
  }

  return {
    ...defaultSettings,
    ...parsed,
  };
};

export const setSettings = (settings: Settings) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
};

const baseSettings = atom<Settings>(getSettings());
export const settingsAtom = atom<Settings, [Settings], undefined>(
  (get) => get(baseSettings),
  (get, set, update) => {
    set(baseSettings, update);
    setSettings(update);
  }
);
