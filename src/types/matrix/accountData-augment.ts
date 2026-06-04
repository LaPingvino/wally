// Module augmentation: register Wally/cinny custom account-data AND state event
// types into the SDK's `AccountDataEvents` / `StateEvents` maps. Without this,
// `mx.getAccountData(...)` / `mx.setAccountData(...)` / `mx.sendStateEvent(...)`
// for these app-specific types fail typechecking ("Argument of type '…' is not
// assignable to parameter of type 'keyof AccountDataEvents' / 'keyof StateEvents'")
// and call sites resort to `as any`. The content types here are the same ones the
// call sites already read/write, so reads via `getContent<T>()` and writes line up.
//
// Keys are written as string literals (matching the SDK's own style for custom
// namespaces, e.g. "org.matrix.msc4155.*") so this file needs only type imports.
import type { SettingsSyncContent } from '../../app/utils/settingsSync';
import type { EmoteRoomsContent, PackContent } from '../../app/plugins/custom-emoji/types';
import type { IRecentEmojiContent } from '../../app/plugins/recent-emoji';
import type { InCinnySpacesContent } from '../../app/hooks/useSidebarItems';

declare module 'matrix-js-sdk' {
  interface AccountDataEvents {
    'eu.kiefte.wally.settings': SettingsSyncContent;
    'in.cinny.spaces': InCinnySpacesContent;
    'io.element.recent_emoji': IRecentEmojiContent;
    'im.ponies.user_emotes': PackContent;
    'im.ponies.emote_rooms': EmoteRoomsContent;
  }

  interface StateEvents {
    // Per-room sticker/emoji pack (im.ponies) — sent via mx.sendStateEvent.
    'im.ponies.room_emotes': PackContent;
  }
}
