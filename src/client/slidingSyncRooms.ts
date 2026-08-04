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

type SlidingSyncLike = {
  modifyRoomSubscriptions: (s: Set<string>) => void;
  resend?: () => void;
};

const getSlidingSync = (mx: MatrixClient): SlidingSyncLike | undefined =>
  (mx as unknown as { getSlidingSync?: () => SlidingSyncLike | undefined }).getSlidingSync?.();

const subscribed = new Set<string>();

// Returns true when this call actually changed the subscription set —
// modifyRoomSubscriptions queues the resend itself, so a caller that also wants
// a bumpSync can skip it (it would be a second queued resend for the same
// change).
//
// The subscription goes out on the request AFTER the one in flight: the SDK's
// resend no longer aborts, because Continuwuity marks rooms as delivered when it
// BUILDS a response, so an aborted batch is lost for good — that was the
// "chat opens late / half-empty" bug. The opened room still fills immediately via
// RoomView's backgroundBackfill; the subscription just deepens it a beat later.
export function subscribeRoom(mx: MatrixClient, roomId: string): boolean {
  const ss = getSlidingSync(mx);
  if (!ss || subscribed.has(roomId)) return false;
  subscribed.add(roomId);
  try {
    ss.modifyRoomSubscriptions(new Set(subscribed));
    return true;
  } catch {
    // resend can throw if the sync isn't running yet; the subscription is
    // already recorded and will be sent on the next request.
    return false;
  }
}

// "Catch up now" — reissue the CURRENT sliding-sync request so the server
// recomputes and streams what changed, instead of leaving us waiting out the
// 30s wake-driven long poll.
//
// Only ever call this off a REAL local signal (we just joined a room, the user
// pressed refresh). Never on a timer and never blind: it is a queued resend, so
// a periodic poke is at best noise and at worst an extra round-trip per tick.
// (It no longer ABORTS the in-flight request — that was lossy against
// Continuwuity; see SlidingSync.resend in the fork.) Mirrors WukkieMail's
// MatrixSource.bumpSync.
//
// No-op under classic /sync — and deliberately NOT a /sync call, because every
// /sync that advances `since` deletes this device's to-device queue.
export function bumpSync(mx: MatrixClient): void {
  try {
    getSlidingSync(mx)?.resend?.();
  } catch {
    // not running yet / unsupported — the next poll picks the change up anyway
  }
}
