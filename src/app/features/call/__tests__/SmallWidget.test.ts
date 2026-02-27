import { describe, it, expect, beforeEach } from 'vitest';
import { getCallIntentParams, getWidgetUrl } from '../SmallWidget';
import type { MatrixClient } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk';

// Minimal Room mock
function makeRoom(isVoice: boolean, memberCount: number): Room {
  return {
    isCallRoom: () => isVoice,
    currentState: { getJoinedMemberCount: () => memberCount },
  } as unknown as Room;
}

// Minimal MatrixClient mock
const mockMx = {
  getUserId: () => '@alice:example.com',
  getDeviceId: () => 'ALICEDEVICE',
  getUser: () => ({ displayName: 'Alice', avatarUrl: '' }),
  baseUrl: 'https://matrix.example.com',
} as unknown as MatrixClient;

describe('getCallIntentParams', () => {
  it('returns join_existing + audio for voice rooms', () => {
    expect(getCallIntentParams(makeRoom(true, 10))).toEqual({
      intent: 'join_existing',
      callIntentParam: 'audio',
    });
  });

  it('returns start_call + video for DM rooms (2 members)', () => {
    expect(getCallIntentParams(makeRoom(false, 2))).toEqual({
      intent: 'start_call',
      callIntentParam: 'video',
    });
  });

  it('returns start_call + video for 1-member room edge case', () => {
    expect(getCallIntentParams(makeRoom(false, 1))).toEqual({
      intent: 'start_call',
      callIntentParam: 'video',
    });
  });

  it('returns start_call + audio for group rooms (3+ members)', () => {
    expect(getCallIntentParams(makeRoom(false, 3))).toEqual({
      intent: 'start_call',
      callIntentParam: 'audio',
    });
  });

  it('defaults to start_call + audio for null room', () => {
    expect(getCallIntentParams(null)).toEqual({
      intent: 'start_call',
      callIntentParam: 'audio',
    });
  });

  it('defaults to start_call + audio for undefined room', () => {
    expect(getCallIntentParams(undefined)).toEqual({
      intent: 'start_call',
      callIntentParam: 'audio',
    });
  });

  it('voice room with 2 members still uses join_existing (voice room type takes priority)', () => {
    expect(getCallIntentParams(makeRoom(true, 2))).toEqual({
      intent: 'join_existing',
      callIntentParam: 'audio',
    });
  });
});

describe('getWidgetUrl', () => {
  beforeEach(() => {
    // happy-dom sets window.location.origin to 'http://localhost'
    // so the local bundle path resolves correctly
  });

  it('includes required embed params', () => {
    const url = getWidgetUrl(mockMx, '!room:example.com', 'https://call.element.io', 'w-1', {
      intent: 'start_call',
      callIntent: 'video',
    });
    expect(url.searchParams.get('embed')).toBe('true');
    expect(url.searchParams.get('appPrompt')).toBe('false');
    expect(url.searchParams.get('confineToRoom')).toBe('true');
    expect(url.searchParams.get('widgetId')).toBe('w-1');
  });

  it('sets correct intent param', () => {
    const url = getWidgetUrl(mockMx, '!room:example.com', 'https://call.element.io', 'w-1', {
      intent: 'room_call',
    });
    expect(url.searchParams.get('intent')).toBe('room_call');
  });

  it('omits intent when not provided', () => {
    const url = getWidgetUrl(mockMx, '!room:example.com', 'https://call.element.io', 'w-1', {});
    expect(url.searchParams.has('intent')).toBe(false);
  });

  it('sets skipLobby=true when provided', () => {
    const url = getWidgetUrl(mockMx, '!room:example.com', 'https://call.element.io', 'w-1', {
      skipLobby: true,
    });
    expect(url.searchParams.get('skipLobby')).toBe('true');
  });

  it('omits skipLobby when undefined', () => {
    const url = getWidgetUrl(mockMx, '!room:example.com', 'https://call.element.io', 'w-1', {
      skipLobby: undefined,
    });
    expect(url.searchParams.has('skipLobby')).toBe(false);
  });

  it('uses custom elementCallUrl with /room suffix', () => {
    const url = getWidgetUrl(mockMx, '!room:example.com', 'https://call.example.com', 'w-1', {});
    expect(url.hostname).toBe('call.example.com');
    expect(url.pathname).toBe('/room');
  });

  it('uses local bundle path when no custom URL', () => {
    const url = getWidgetUrl(mockMx, '!room:example.com', '', 'w-1', {});
    expect(url.pathname).toBe('/public/element-call/index.html');
  });

  it('includes roomId, userId, deviceId, baseUrl', () => {
    const url = getWidgetUrl(mockMx, '!room:example.com', 'https://call.element.io', 'w-1', {});
    expect(url.searchParams.get('roomId')).toBe('!room:example.com');
    expect(url.searchParams.get('userId')).toBe('@alice:example.com');
    expect(url.searchParams.get('deviceId')).toBe('ALICEDEVICE');
    expect(url.searchParams.get('baseUrl')).toBe('https://matrix.example.com');
  });

  it('sets callIntent param', () => {
    const url = getWidgetUrl(mockMx, '!room:example.com', 'https://call.element.io', 'w-1', {
      callIntent: 'video',
    });
    expect(url.searchParams.get('callIntent')).toBe('video');
  });

  it('defaults callIntent to video when not specified', () => {
    const url = getWidgetUrl(mockMx, '!room:example.com', 'https://call.element.io', 'w-1', {});
    expect(url.searchParams.get('callIntent')).toBe('video');
  });

  // VITAL: each user's EC instance must use their OWN homeserver's baseUrl so that
  // Element Call can discover the LiveKit focus from that user's .well-known/matrix/client
  // (org.matrix.msc4143.rtc_foci). Without this, all users would use a single hardcoded HS
  // and calls would fail for users whose HS doesn't have LiveKit configured.
  it('baseUrl uses the MatrixClient baseUrl, not a hardcoded value', () => {
    const userOnOtherServer = {
      getUserId: () => '@bob:other.example.org',
      getDeviceId: () => 'BOBDEVICE',
      getUser: () => ({ displayName: 'Bob', avatarUrl: '' }),
      baseUrl: 'https://matrix.other.example.org',
    } as unknown as MatrixClient;

    const urlAlice = getWidgetUrl(mockMx, '!room:example.com', 'https://call.element.io', 'w-1', {});
    const urlBob = getWidgetUrl(userOnOtherServer, '!room:example.com', 'https://call.element.io', 'w-1', {});

    expect(urlAlice.searchParams.get('baseUrl')).toBe('https://matrix.example.com');
    expect(urlBob.searchParams.get('baseUrl')).toBe('https://matrix.other.example.org');
  });

  it('userId uses the MatrixClient userId, not a hardcoded value', () => {
    const userOnOtherServer = {
      getUserId: () => '@bob:other.example.org',
      getDeviceId: () => 'BOBDEVICE',
      getUser: () => ({ displayName: 'Bob', avatarUrl: '' }),
      baseUrl: 'https://matrix.other.example.org',
    } as unknown as MatrixClient;

    const urlAlice = getWidgetUrl(mockMx, '!room:example.com', 'https://call.element.io', 'w-1', {});
    const urlBob = getWidgetUrl(userOnOtherServer, '!room:example.com', 'https://call.element.io', 'w-1', {});

    expect(urlAlice.searchParams.get('userId')).toBe('@alice:example.com');
    expect(urlBob.searchParams.get('userId')).toBe('@bob:other.example.org');
  });
});
