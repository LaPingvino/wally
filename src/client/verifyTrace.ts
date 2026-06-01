import { ClientEvent, MatrixClient, MatrixEvent } from 'matrix-js-sdk';

// Live diagnostics for SAS device verification under sliding sync.
//
// Symptom we are chasing: the emoji compare "connects" but the comparison emoji
// never appear. SAS is driven by m.key.verification.* to-device messages, which
// under sliding sync flow over the dedicated encryption sync connection.
//
// IMPORTANT: SAS to-device can arrive Olm-ENCRYPTED (type m.room.encrypted) and
// be decrypted before re-emission, so filtering on m.key.verification alone can
// show nothing even when traffic is flowing. So log EVERY to-device event type.
// Read window.wallyVerify():
//   * no rows at all during a verification attempt -> to-device is not arriving
//     (encryption sync stalled/erroring, or Continuwuity not delivering on the
//     conn_id "encryption" connection) — the headline suspect.
//   * m.room.encrypted rows but no m.key.verification.* -> arriving but not being
//     decrypted/dispatched to the verifier (crypto/dispatch gap).
//   * m.key.verification.request/ready/start but never the peer .key -> stalls
//     mid-handshake; .key present but no emoji -> verifier/UI (DeviceVerification).
//
// Exposes window.wallyClient (the live MatrixClient) and window.wallyVerify().
// Logging only; no behavioural change.

type TraceEntry = { t: string; type: string; from?: string; txn?: string; verify: boolean };

const trace: TraceEntry[] = [];

export const installVerificationTracer = (mx: MatrixClient): void => {
  const w = window as unknown as {
    wallyClient?: MatrixClient;
    wallyVerify?: () => TraceEntry[];
  };
  w.wallyClient = mx;
  if (w.wallyVerify) return; // already installed
  w.wallyVerify = () => {
    const verifyRows = trace.filter((e) => e.verify);
    // eslint-disable-next-line no-console
    console.info(
      `[Wally][verify] ${trace.length} to-device events total, ${verifyRows.length} verification-related`
    );
    // eslint-disable-next-line no-console
    console.table(trace);
    return trace;
  };

  mx.on(ClientEvent.ToDeviceEvent, (event: MatrixEvent) => {
    const type = event.getType();
    const content = event.getContent() as { transaction_id?: string };
    const verify = type.startsWith('m.key.verification');
    const entry: TraceEntry = {
      t: new Date().toISOString(),
      type,
      from: event.getSender() ?? undefined,
      txn: content.transaction_id,
      verify,
    };
    trace.push(entry);
    if (trace.length > 400) trace.shift();
    if (verify || type === 'm.room.encrypted') {
      // eslint-disable-next-line no-console
      console.info(`[Wally][verify] recv ${type} from ${entry.from ?? '?'} txn=${entry.txn ?? '?'}`);
    }
  });
};
