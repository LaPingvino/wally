/**
 * Call sessions (audit 2026-11-08): every setActiveCallRoomId / hangUp starts a new session and
 * drops the previous LiveKit credentials. Before, the token was fetched once per ROOM:
 *  - hangUp() + setActiveCallRoomId(sameRoom) in one React batch cleared the credentials but the
 *    container never saw the room go null, so it never fetched again → "Connecting..." forever;
 *  - switching rooms kept the old room's url/token, so we sat in the old call's media;
 *  - Return to main from a breakout re-set the same room → the breakout token stayed.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react-router-dom', () => ({ useParams: () => ({}) }));
vi.mock('../../../../hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({ getRoom: () => null, getUserId: () => '@me:example.com' }),
}));
vi.mock('../../../../state/hooks/settings', () => ({ useSetting: () => [true] }));

// eslint-disable-next-line import/first
import { CallProvider, useCallState } from '../CallProvider';

type State = ReturnType<typeof useCallState>;

function mount(): () => State {
  let latest: State | null = null;
  function Probe() {
    latest = useCallState();
    return null;
  }
  const root = createRoot(document.createElement('div'));
  act(() => {
    root.render(
      <CallProvider>
        <Probe />
      </CallProvider>
    );
  });
  return () => latest!;
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('call sessions', () => {
  beforeEach(() => sessionStorage.clear());

  it('hangUp + rejoin of the same room in one batch is a new session without the old token', () => {
    const get = mount();
    act(() => get().setActiveCallRoomId('!a:x', true));
    act(() => get().setLkCredentials('wss://sfu', 'token-a'));
    const before = get().callSession;
    act(() => {
      get().hangUp();
      get().setActiveCallRoomId('!a:x', true);
    });
    expect(get().activeCallRoomId).toBe('!a:x');
    expect(get().lkToken).toBe('');
    expect(get().callSession).toBeGreaterThan(before);
  });

  it('switching rooms drops the previous call credentials and connected state', () => {
    const get = mount();
    act(() => get().setActiveCallRoomId('!a:x', true));
    act(() => {
      get().setLkCredentials('wss://sfu', 'token-a');
      get().setLkConnected(true);
    });
    act(() => get().setActiveCallRoomId('!b:x', true));
    expect(get().lkUrl).toBe('');
    expect(get().lkToken).toBe('');
    expect(get().lkConnected).toBe(false);
  });

  it('Return to main (same room again) drops the breakout token', () => {
    const get = mount();
    act(() => get().setActiveCallRoomId('!a:x', true));
    act(() => get().setLkCredentials('wss://sfu', 'breakout-token'));
    const before = get().callSession;
    act(() => get().setActiveCallRoomId('!a:x', true));
    expect(get().lkToken).toBe('');
    expect(get().callSession).toBe(before + 1);
  });
});
