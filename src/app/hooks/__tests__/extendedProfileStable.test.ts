/**
 * Tests for the stable-endpoint MSC4133 wrappers.
 *
 * Why these exist: some servers (notably Continuwuity at the time of writing)
 * advertise spec v1.15 — which stabilised MSC4133 at /_matrix/client/v3 — but
 * do NOT advertise the `uk.tcpip.msc4133.stable` unstable-feature flag that
 * matrix-js-sdk's `getExtendedProfileRequestPrefix()` probes for. The SDK
 * therefore falls back to /_matrix/client/unstable/uk.tcpip.msc4133/...
 * which 404s on those servers, breaking pronouns/timezone editing.
 *
 * These tests pin the URL, method, and prefix our wrappers emit so a future
 * SDK / refactor can't silently re-introduce the bug.
 */
import { describe, it, expect, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import {
  fetchExtendedProfileStable,
  setExtendedProfilePropertyStable,
  deleteExtendedProfilePropertyStable,
} from '../useExtendedProfile';

function makeMockClient() {
  const authedRequest = vi.fn().mockResolvedValue({});
  const mx = { http: { authedRequest } } as unknown as MatrixClient;
  return { mx, authedRequest };
}

class MockMatrixError extends Error {
  httpStatus: number;
  errcode: string;
  constructor(httpStatus: number, errcode = 'M_UNRECOGNIZED') {
    super(`[${httpStatus}] ${errcode}`);
    this.httpStatus = httpStatus;
    this.errcode = errcode;
  }
}

describe('extended profile stable-endpoint wrappers', () => {
  const userId = '@joop:chat.kiefte.eu';

  it('GET hits /_matrix/client/v3/profile/{userId}, not the unstable URL', async () => {
    const { mx, authedRequest } = makeMockClient();
    await fetchExtendedProfileStable(mx, userId);

    expect(authedRequest).toHaveBeenCalledTimes(1);
    const [method, path, query, body, opts] = authedRequest.mock.calls[0];
    expect(method).toBe('GET');
    expect(path).toBe(`/profile/${encodeURIComponent(userId)}`);
    expect(query).toBeUndefined();
    expect(body).toBeUndefined();
    expect(opts).toEqual({ prefix: '/_matrix/client/v3' });

    // Sanity: the assembled prefix+path must NOT mention the unstable namespace.
    const assembled = `${opts.prefix}${path}`;
    expect(assembled).not.toMatch(/unstable/);
    expect(assembled).not.toMatch(/uk\.tcpip\.msc4133/);
  });

  it('PUT writes a single key with the correct body shape', async () => {
    const { mx, authedRequest } = makeMockClient();
    const value = [{ language: 'en', summary: 'they/them' }];
    await setExtendedProfilePropertyStable(mx, userId, 'io.fsky.nyx.pronouns', value);

    const [method, path, query, body, opts] = authedRequest.mock.calls[0];
    expect(method).toBe('PUT');
    expect(path).toBe(
      `/profile/${encodeURIComponent(userId)}/${encodeURIComponent('io.fsky.nyx.pronouns')}`
    );
    expect(query).toBeUndefined();
    expect(body).toEqual({ 'io.fsky.nyx.pronouns': value });
    expect(opts).toEqual({ prefix: '/_matrix/client/v3' });
  });

  it('DELETE targets the same field path with no body', async () => {
    const { mx, authedRequest } = makeMockClient();
    await deleteExtendedProfilePropertyStable(mx, userId, 'us.cloke.msc4175.tz');

    const [method, path, query, body, opts] = authedRequest.mock.calls[0];
    expect(method).toBe('DELETE');
    expect(path).toBe(
      `/profile/${encodeURIComponent(userId)}/${encodeURIComponent('us.cloke.msc4175.tz')}`
    );
    expect(query).toBeUndefined();
    expect(body).toBeUndefined();
    expect(opts).toEqual({ prefix: '/_matrix/client/v3' });
  });

  it('GET falls back to /_matrix/client/unstable/uk.tcpip.msc4133/... on 404', async () => {
    const { mx, authedRequest } = makeMockClient();
    authedRequest
      .mockRejectedValueOnce(new MockMatrixError(404, 'M_UNRECOGNIZED'))
      .mockResolvedValueOnce({ displayname: 'fallback' });

    const result = await fetchExtendedProfileStable(mx, userId);

    expect(authedRequest).toHaveBeenCalledTimes(2);
    expect(authedRequest.mock.calls[0][4]).toEqual({ prefix: '/_matrix/client/v3' });
    expect(authedRequest.mock.calls[1][4]).toEqual({
      prefix: '/_matrix/client/unstable/uk.tcpip.msc4133',
    });
    expect(result).toEqual({ displayname: 'fallback' });
  });

  it('PUT falls back to unstable on 404 and sends the same body', async () => {
    const { mx, authedRequest } = makeMockClient();
    authedRequest
      .mockRejectedValueOnce(new MockMatrixError(404))
      .mockResolvedValueOnce({});

    await setExtendedProfilePropertyStable(mx, userId, 'us.cloke.msc4175.tz', 'Europe/Lisbon');

    expect(authedRequest).toHaveBeenCalledTimes(2);
    expect(authedRequest.mock.calls[0][4]).toEqual({ prefix: '/_matrix/client/v3' });
    expect(authedRequest.mock.calls[1][4]).toEqual({
      prefix: '/_matrix/client/unstable/uk.tcpip.msc4133',
    });
    expect(authedRequest.mock.calls[1][3]).toEqual({ 'us.cloke.msc4175.tz': 'Europe/Lisbon' });
  });

  it('does NOT fall back on non-404 errors (e.g. 403 forbidden)', async () => {
    const { mx, authedRequest } = makeMockClient();
    const err = new MockMatrixError(403, 'M_FORBIDDEN');
    authedRequest.mockRejectedValueOnce(err);

    await expect(fetchExtendedProfileStable(mx, userId)).rejects.toBe(err);
    expect(authedRequest).toHaveBeenCalledTimes(1);
  });

  it('percent-encodes user IDs and field keys with reserved characters', async () => {
    const { mx, authedRequest } = makeMockClient();
    // ':' must be encoded; dots in field keys must NOT be (they are unreserved).
    await setExtendedProfilePropertyStable(mx, '@a:example.org', 'io.fsky.nyx.pronouns', []);

    const [, path] = authedRequest.mock.calls[0];
    expect(path).toContain('%40a%3Aexample.org');
    expect(path).toContain('io.fsky.nyx.pronouns');
  });
});
