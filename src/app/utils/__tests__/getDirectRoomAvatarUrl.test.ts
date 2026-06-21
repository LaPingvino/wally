/**
 * Regression test for getDirectRoomAvatarUrl (src/app/utils/room.ts).
 *
 * Bridges (mautrix-whatsapp) map broadcast channels into m.direct, so Cinny treats them as DMs.
 * Such a channel's only "other member" is the user's OWN ghost (carrying the user's face). The
 * per-member DM fallback would then render the user's avatar, overriding the bridge's correct
 * m.room.avatar (the channel photo). The fix: an explicit room avatar wins; the member fallback is
 * only used when there is no room avatar (native Matrix DMs).
 */

import { describe, it, expect } from 'vitest';
import type { MatrixClient, Room, RoomMember } from 'matrix-js-sdk';
import { getDirectRoomAvatarUrl } from '../room';

const member = (mxc?: string): RoomMember =>
  ({ getMxcAvatarUrl: () => mxc }) as unknown as RoomMember;

type RoomOpts = { roomMxc?: string; memberMxc?: string };
const makeRoom = ({ roomMxc, memberMxc }: RoomOpts): Room =>
  ({
    roomId: '!r:server',
    getMxcAvatarUrl: () => roomMxc,
    getAvatarFallbackMember: () => (memberMxc !== undefined ? member(memberMxc) : undefined),
  }) as unknown as Room;

// mxcUrlToHttp just echoes the mxc so we can assert which source was chosen.
const mx = {
  mxcUrlToHttp: (mxc: string) => `http:${mxc}`,
} as unknown as MatrixClient;

describe('getDirectRoomAvatarUrl', () => {
  it('prefers the explicit room avatar (bridge channel photo) over the member fallback', () => {
    const room = makeRoom({ roomMxc: 'mxc://chan/photo', memberMxc: 'mxc://me/ghost' });
    expect(getDirectRoomAvatarUrl(mx, room)).toBe('http:mxc://chan/photo');
  });

  it('falls back to the DM partner member when there is no room avatar', () => {
    const room = makeRoom({ roomMxc: undefined, memberMxc: 'mxc://partner/face' });
    expect(getDirectRoomAvatarUrl(mx, room)).toBe('http:mxc://partner/face');
  });

  it('returns undefined when neither a room avatar nor a fallback member avatar exists', () => {
    const room = makeRoom({ roomMxc: undefined, memberMxc: undefined });
    expect(getDirectRoomAvatarUrl(mx, room)).toBeUndefined();
  });
});
