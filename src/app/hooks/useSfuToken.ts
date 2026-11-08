import { useCallback } from 'react';
import { MatrixClient, Method } from 'matrix-js-sdk';
import { callDebug } from '../features/call/callDebug';

export interface SfuTokenResult {
  jwt: string;
  url: string; // LiveKit WebSocket URL
}

/**
 * Fetches a LiveKit JWT from lk-jwt-service.
 *
 * Flow: get OpenID token from homeserver -> POST to lk-jwt-service /sfu/get -> receive JWT + LK URL.
 */
export async function fetchSfuToken(
  mx: MatrixClient,
  serviceUrl: string,
  roomId: string,
  deviceId: string,
): Promise<SfuTokenResult> {
  callDebug('sfu', 'Requesting OpenID token from homeserver');

  // matrix-js-sdk's getOpenIdToken returns { access_token, token_type, matrix_server_name, expires_in }
  const openIdToken = await mx.getOpenIdToken();

  callDebug('sfu', 'Got OpenID token, requesting SFU JWT', { serviceUrl, roomId });

  const resp = await fetch(`${serviceUrl}/sfu/get`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      room: roomId,
      openid_token: {
        access_token: openIdToken.access_token,
        token_type: openIdToken.token_type,
        matrix_server_name: openIdToken.matrix_server_name,
        expires_in: openIdToken.expires_in,
      },
      device_id: deviceId,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`SFU token request failed (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  callDebug('sfu', 'Got SFU token', { url: data.url });

  return { jwt: data.jwt, url: data.url };
}

/**
 * Hook that returns a function to fetch an SFU token.
 */
export function useSfuTokenFetcher(mx: MatrixClient) {
  return useCallback(
    (serviceUrl: string, roomId: string) => {
      const deviceId = mx.getDeviceId() ?? 'UNKNOWN';
      return fetchSfuToken(mx, serviceUrl, roomId, deviceId);
    },
    [mx]
  );
}

type RtcTransport = { type?: string; livekit_service_url?: string };

/** One spelling per service, so "https://jwt.x/" and "https://jwt.x" compare equal. */
export function normalizeServiceUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function livekitServiceUrlOf(transports: RtcTransport[] | undefined): string | undefined {
  const url = transports?.find(
    (t) => (t.type === 'livekit' || t.type === 'm.livekit') && typeof t.livekit_service_url === 'string'
  )?.livekit_service_url;
  return url ? normalizeServiceUrl(url) : undefined;
}

const ownServiceUrlCache = new WeakMap<MatrixClient, Promise<string | undefined>>();

/**
 * Our own homeserver's LiveKit service (lk-jwt-service) URL — the SFU we PUBLISH on.
 *
 * Element Call reads it from GET /_matrix/client/unstable/org.matrix.msc4143/rtc/transports
 * (MSC4143; EC stopped reading .well-known rtc_foci in v0.24), offered when /versions lists
 * org.matrix.msc4143. The .well-known value is the fallback for servers without the endpoint.
 */
export function discoverOwnLivekitServiceUrl(
  mx: MatrixClient,
  wellKnownFoci: RtcTransport[] | undefined
): Promise<string | undefined> {
  const cached = ownServiceUrlCache.get(mx);
  if (cached) return cached.then((url) => url ?? livekitServiceUrlOf(wellKnownFoci));
  const lookup = (async () => {
    try {
      const versions = await mx.getVersions();
      if (!versions.unstable_features?.['org.matrix.msc4143']) return undefined;
      const res = await mx.http.authedRequest<{ rtc_transports?: RtcTransport[] }>(
        Method.Get,
        '/org.matrix.msc4143/rtc/transports',
        undefined,
        undefined,
        { prefix: '/_matrix/client/unstable' }
      );
      const url = livekitServiceUrlOf(res.rtc_transports);
      callDebug('sfu', 'RTC transports endpoint', { url, count: res.rtc_transports?.length });
      return url;
    } catch (e) {
      callDebug('sfu', 'RTC transports endpoint unavailable, using .well-known', e);
      return undefined;
    }
  })();
  ownServiceUrlCache.set(mx, lookup);
  return lookup.then((url) => url ?? livekitServiceUrlOf(wellKnownFoci));
}
