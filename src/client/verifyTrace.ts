import { ClientEvent, MatrixClient, MatrixEvent } from 'matrix-js-sdk';

// Live diagnostics for SAS device verification under sliding sync.
//
// Symptom we are chasing: the emoji compare "connects" but the comparison emoji
// never appear. SAS is driven entirely by m.key.verification.* to-device
// messages, which under sliding sync flow over the dedicated encryption sync
// connection. This tracer makes that flow visible so we can pinpoint the stall:
//
//   * see .request/.ready/.start but never the peer's .key  -> incoming
//     to-device is not being delivered past the handshake (server/extension gap)
//   * see the peer's .key but still no emoji                -> the verifier/UI
//     isn't surfacing ShowSas (consumer-side)
//   * see nothing at all after .request                     -> to-device dead
//     after the initial batch (encryption sync stalled/erroring)
//
// Exposes window.wallyClient (the live MatrixClient, for ad-hoc console
// root-causing — e.g. the m.direct DM check) and window.wallyVerify() to dump
// the captured trace. Zero behavioural change; logging only.

type TraceEntry = { t: string; dir: 'recv'; type: string; from?: string; txn?: string };

const trace: TraceEntry[] = [];

export const installVerificationTracer = (mx: MatrixClient): void => {
  const w = window as unknown as {
    wallyClient?: MatrixClient;
    wallyVerify?: () => TraceEntry[];
  };
  w.wallyClient = mx;
  if (w.wallyVerify) return; // already installed
  w.wallyVerify = () => {
    // eslint-disable-next-line no-console
    console.table(trace);
    return trace;
  };

  mx.on(ClientEvent.ToDeviceEvent, (event: MatrixEvent) => {
    const type = event.getType();
    if (!type.startsWith('m.key.verification')) return;
    const content = event.getContent() as { transaction_id?: string };
    const entry: TraceEntry = {
      t: new Date().toISOString(),
      dir: 'recv',
      type,
      from: event.getSender() ?? undefined,
      txn: content.transaction_id,
    };
    trace.push(entry);
    if (trace.length > 200) trace.shift();
    // eslint-disable-next-line no-console
    console.info(`[Wally][verify] recv ${type} from ${entry.from ?? '?'} txn=${entry.txn ?? '?'}`);
  });
};
