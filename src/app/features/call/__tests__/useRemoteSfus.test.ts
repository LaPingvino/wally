import { describe, it, expect } from 'vitest';
import type { RemoteParticipant } from 'livekit-client';
import type { CallMembership } from 'matrix-js-sdk/lib/matrixrtc/CallMembership';
import { homeSfuByIdentity, mergeParticipants, remoteServiceUrls } from '../useRemoteSfus';

const OWN = 'https://jwt.kiefte.eu';
const POLI = 'https://jwt.poliglota.social.br';

const member = (sender: string, deviceId: string, url?: string) =>
  ({
    sender,
    deviceId,
    getPreferredFoci: () => (url ? [{ type: 'livekit', livekit_service_url: url, livekit_alias: '!r' }] : []),
  }) as unknown as CallMembership;

const participant = (identity: string, tracks = 1) =>
  ({ identity, trackPublications: new Map(Array.from({ length: tracks }, (_, i) => [String(i), {}])) }) as unknown as RemoteParticipant;

const me = { userId: '@joop:chat.kiefte.eu', deviceId: 'ME' };

describe('remoteServiceUrls', () => {
  it('lists the other SFUs members publish on, once each, not ours or our own device', () => {
    const ms = [
      member('@joop:chat.kiefte.eu', 'ME', 'https://elsewhere'),
      member('@a:chat.kiefte.eu', 'A', OWN),
      member('@b:poliglota.social.br', 'B', POLI),
      member('@c:poliglota.social.br', 'C', POLI),
      member('@d:x', 'D'),
    ];
    expect(remoteServiceUrls(ms, OWN, me)).toEqual([POLI]);
  });
});

describe('mergeParticipants', () => {
  const home = homeSfuByIdentity([
    member('@a:chat.kiefte.eu', 'A', OWN),
    member('@b:poliglota.social.br', 'B', POLI),
  ]);

  it("takes each member from its own SFU: B's listen-only shadow on ours is dropped", () => {
    const merged = mergeParticipants(
      [
        { serviceUrl: OWN, participants: [participant('@a:chat.kiefte.eu:A'), participant('@b:poliglota.social.br:B', 0)] },
        { serviceUrl: POLI, participants: [participant('@b:poliglota.social.br:B'), participant('@a:chat.kiefte.eu:A', 0)] },
      ],
      home
    );
    expect(merged.map((p) => p.identity)).toEqual(['@a:chat.kiefte.eu:A', '@b:poliglota.social.br:B']);
    expect(merged.every((p) => p.trackPublications.size === 1)).toBe(true);
  });

  it('keeps a participant without a known home (a guest) once', () => {
    const merged = mergeParticipants(
      [
        { serviceUrl: OWN, participants: [participant('@bot:chat.kiefte.eu:GUEST_1')] },
        { serviceUrl: POLI, participants: [participant('@bot:chat.kiefte.eu:GUEST_1')] },
      ],
      home
    );
    expect(merged).toHaveLength(1);
  });
});
