import { useCallback } from 'react';
import { MatrixClient } from 'matrix-js-sdk';
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
