import type { MatrixClient } from 'matrix-js-sdk';

// Per-room sliding-sync subscriptions.
//
// Under sliding sync the room LIST is delivered lean (timeline_limit 1), so a
// room that hasn't been backfilled opens with ~1 event and only the members of
// whoever is already in that lean window. Subscribing a room re-delivers it at
// the subscription timeline_limit (50 in the fork) plus the `$LAZY` member
// events for those senders; SlidingSyncSdk merges the extra events into the
// existing live timeline as scrollback. So a single subscribe-on-open inflates
// the chat to a usable depth + sender names in one round-trip — which is the
// difference that makes WukkieMail's rooms come up complete and cinny's didn't.
//
// No-op under classic /sync: getSlidingSync() returns undefined there, so the
// classic pagination path is left entirely untouched. Mirrors WukkieMail's
// MatrixSource.subscribeRoom.

type SlidingSyncLike = { modifyRoomSubscriptions: (s: Set<string>) => void };

const subscribed = new Set<string>();

export function subscribeRoom(mx: MatrixClient, roomId: string): void {
  const ss = (
    mx as unknown as { getSlidingSync?: () => SlidingSyncLike | undefined }
  ).getSlidingSync?.();
  if (!ss || subscribed.has(roomId)) return;
  subscribed.add(roomId);
  try {
    ss.modifyRoomSubscriptions(new Set(subscribed));
  } catch {
    // resend can throw if the sync isn't running yet; the subscription is
    // already recorded and will be sent on the next request.
  }
}
