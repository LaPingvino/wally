/**
 * Multi-SFU (Element Call's default since v0.21): every call member publishes on its OWN
 * homeserver's SFU — the first livekit focus in its foci_preferred — and listens on the others'.
 * Our main LiveKit room is the publish connection on our SFU (PersistentCallContainer); this hook
 * keeps one subscribe-only connection per OTHER SFU that call members publish on, so we hear and
 * see members on other homeservers. Their lk-jwt-service gives us a subscribe-only token
 * (non-local users can't publish there), which is exactly what we need.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Room, RoomEvent, RemoteParticipant } from 'livekit-client';
import type { BaseKeyProvider } from 'livekit-client';
import type { MatrixClient } from 'matrix-js-sdk';
import { MatrixRTCSessionEvent } from 'matrix-js-sdk/lib/matrixrtc/MatrixRTCSession';
import type { CallMembership } from 'matrix-js-sdk/lib/matrixrtc/CallMembership';
import { fetchSfuToken, normalizeServiceUrl } from '../../hooks/useSfuToken';
import { callDebug } from './callDebug';

/** The SFU a member publishes on: its first livekit focus with a service URL. */
export function memberServiceUrl(m: CallMembership): string | undefined {
  const foci = (m.getPreferredFoci?.() ?? []) as Array<{ type?: string; livekit_service_url?: string }>;
  const url = foci.find((f) => (f.type === 'livekit' || f.type === 'm.livekit') && f.livekit_service_url)
    ?.livekit_service_url;
  return url ? normalizeServiceUrl(url) : undefined;
}

/** LiveKit identity → the SFU that member publishes on ("user:device", the legacy identity). */
export function homeSfuByIdentity(memberships: CallMembership[]): Map<string, string> {
  const map = new Map<string, string>();
  memberships.forEach((m) => {
    const url = memberServiceUrl(m);
    if (m.sender && url) map.set(`${m.sender}:${m.deviceId}`, url);
  });
  return map;
}

/** The SFUs other than ours that some call member publishes on. */
export function remoteServiceUrls(
  memberships: CallMembership[],
  ownServiceUrl: string | undefined,
  me: { userId: string | null; deviceId: string | null }
): string[] {
  const urls = new Set<string>();
  memberships.forEach((m) => {
    if (m.sender === me.userId && m.deviceId === me.deviceId) return;
    const url = memberServiceUrl(m);
    if (url && url !== ownServiceUrl) urls.add(url);
  });
  return [...urls].sort();
}

/**
 * Merge the remote participants of every connection, each member taken from the SFU it
 * publishes on: on our SFU, members of other servers show up too (their subscribe-only
 * connections, without tracks), and the same identity would appear twice. A participant whose
 * home SFU we don't know (e.g. a guest the bot signed in) is kept from wherever it is first seen.
 */
export function mergeParticipants(
  connections: Array<{ serviceUrl: string | undefined; participants: RemoteParticipant[] }>,
  homeOf: Map<string, string>
): RemoteParticipant[] {
  const out = new Map<string, RemoteParticipant>();
  connections.forEach(({ serviceUrl, participants }) => {
    participants.forEach((p) => {
      const home = homeOf.get(p.identity);
      if (home !== undefined && home !== serviceUrl) return;
      if (!out.has(p.identity)) out.set(p.identity, p);
    });
  });
  return [...out.values()];
}

type Connection = { serviceUrl: string; room: Room };

/**
 * Subscribe-only LiveKit connections, one per remote SFU. sync() opens what's wanted and closes
 * the rest; a connect still in flight for an SFU that's no longer wanted (or after close())
 * notices it was replaced and disconnects, so a slow token fetch can't resurrect a connection.
 */
export class RemoteSfuPool {
  private conns = new Map<string, Room>();

  private readonly mx: MatrixClient;

  private readonly onChange: () => void;

  constructor(mx: MatrixClient, onChange: () => void) {
    this.mx = mx;
    this.onChange = onChange;
  }

  get connections(): Connection[] {
    return [...this.conns.entries()].map(([serviceUrl, room]) => ({ serviceUrl, room }));
  }

  sync(roomId: string | null, wanted: string[], keyProvider: BaseKeyProvider | undefined): void {
    const wantedSet = new Set(roomId ? wanted : []);
    let changed = false;
    this.conns.forEach((room, url) => {
      if (wantedSet.has(url)) return;
      callDebug('sfu', 'Leaving remote SFU', { url });
      room.disconnect();
      this.conns.delete(url);
      changed = true;
    });
    wantedSet.forEach((url) => {
      if (this.conns.has(url) || !roomId) return;
      this.open(url, roomId, keyProvider);
      changed = true;
    });
    if (changed) this.onChange();
  }

  close(): void {
    this.conns.forEach((room) => room.disconnect());
    this.conns.clear();
  }

  private open(url: string, roomId: string, keyProvider: BaseKeyProvider | undefined): void {
    const lkRoom = new Room({
      adaptiveStream: true,
      dynacast: true,
      ...(keyProvider
        ? {
            e2ee: {
              keyProvider,
              worker: new Worker(new URL('livekit-client/e2ee-worker', import.meta.url), { type: 'module' }),
            },
          }
        : {}),
    });
    this.conns.set(url, lkRoom);
    [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.ConnectionStateChanged,
    ].forEach((ev) => lkRoom.on(ev, this.onChange));
    const current = () => this.conns.get(url) === lkRoom;
    (async () => {
      try {
        callDebug('sfu', 'Joining remote SFU (subscribe-only)', { url });
        const { url: lkUrl, jwt } = await fetchSfuToken(this.mx, url, roomId, this.mx.getDeviceId() ?? 'UNKNOWN');
        if (!current()) return;
        if (keyProvider) await lkRoom.setE2EEEnabled(true);
        await lkRoom.connect(lkUrl, jwt, { autoSubscribe: true });
        if (!current()) {
          lkRoom.disconnect();
          return;
        }
        callDebug('sfu', 'Remote SFU connected', { url, participants: lkRoom.remoteParticipants.size });
      } catch (e) {
        callDebug('error', 'Remote SFU connection failed', { url, e });
      }
    })();
  }
}

export function useRemoteSfus(opts: {
  mx: MatrixClient;
  roomId: string | null;
  enabled: boolean;
  ownServiceUrl: string | undefined;
  keyProvider: BaseKeyProvider | undefined;
}): {
  connections: Connection[];
  memberships: CallMembership[];
} {
  const { mx, roomId, enabled, ownServiceUrl, keyProvider } = opts;
  const [memberships, setMemberships] = useState<CallMembership[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [, setVersion] = useState(0);
  const poolRef = useRef<RemoteSfuPool | null>(null);
  if (!poolRef.current) {
    poolRef.current = new RemoteSfuPool(mx, () => {
      setConnections(poolRef.current?.connections ?? []);
      setVersion((v) => v + 1);
    });
  }

  // Follow the call's memberships.
  useEffect(() => {
    const room = roomId ? mx.getRoom(roomId) : null;
    if (!room || !enabled) {
      setMemberships([]);
      return undefined;
    }
    const session = mx.matrixRTC.getRoomSession(room);
    const update = () => setMemberships([...session.memberships]);
    update();
    session.on(MatrixRTCSessionEvent.MembershipsChanged, update);
    return () => {
      session.off(MatrixRTCSessionEvent.MembershipsChanged, update);
    };
  }, [mx, roomId, enabled]);

  const wanted = useMemo(
    () =>
      enabled && ownServiceUrl
        ? remoteServiceUrls(memberships, ownServiceUrl, { userId: mx.getUserId(), deviceId: mx.getDeviceId() })
        : [],
    [enabled, ownServiceUrl, memberships, mx]
  );
  const wantedKey = wanted.join('\n');

  useEffect(() => {
    poolRef.current?.sync(roomId, wanted, keyProvider);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey, roomId, keyProvider]);

  useEffect(() => () => poolRef.current?.close(), []);

  return { connections, memberships };
}
