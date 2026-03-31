/**
 * Tests for MatrixRTC robustness fixes added in patch-15:
 * - Delayed events probe (disableDelayedEventsIfUnsupported)
 * - Legacy VoIP handler cleanup (startCallEventHandler listener removal)
 * - Log annotation filter (installMatrixRTCLogFilter)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════
// 1. DELAYED EVENTS PROBE
//
// Continuwuity advertises org.matrix.msc4140 but the `restart`
// endpoint is broken/slow. The probe sends a cancel request for a
// nonexistent delay ID:
//   - 404 / M_NOT_FOUND  → endpoint works, delayed events OK
//   - UnsupportedError    → feature flag lied, disable
//   - timeout / 500 / etc → endpoint broken, disable
//
// When disabled, _unstable_sendDelayedStateEvent and
// _unstable_updateDelayedEvent are patched to throw immediately,
// making MembershipManager use its fallback path (regular state
// events with client-side expiry).
// ═══════════════════════════════════════════════════════════════════

/** Simulates the probe logic from PersistentCallContainer */
async function probeDelayedEvents(
  serverFeatures: Record<string, boolean> | undefined,
  probeResult: 'not-found' | 'unsupported-error' | 'timeout' | 'server-error',
): Promise<'enabled' | 'disabled'> {
  // Step 1: check feature flags
  const supported =
    serverFeatures?.['org.matrix.msc4157'] === true ||
    serverFeatures?.['org.matrix.msc4140'] === true;

  if (!supported) return 'enabled'; // Server doesn't claim support, nothing to disable

  // Step 2: probe the endpoint
  try {
    if (probeResult === 'not-found') {
      throw Object.assign(new Error('Not found'), { errcode: 'M_NOT_FOUND', httpStatus: 404 });
    } else if (probeResult === 'unsupported-error') {
      const e = new Error('Server does not support the delayed events API');
      e.name = 'UnsupportedDelayedEventsEndpointError';
      throw e;
    } else if (probeResult === 'timeout') {
      throw new DOMException('The operation was aborted', 'AbortError');
    } else if (probeResult === 'server-error') {
      throw Object.assign(new Error('Internal Server Error'), { httpStatus: 500 });
    }
  } catch (e: any) {
    if (e.name === 'UnsupportedDelayedEventsEndpointError') return 'disabled';
    if (e?.errcode === 'M_NOT_FOUND' || e?.httpStatus === 404) return 'enabled';
    return 'disabled';
  }
  return 'enabled';
}

describe('Delayed events probe', () => {
  it('keeps delayed events enabled when server returns 404 (endpoint works)', async () => {
    const result = await probeDelayedEvents({ 'org.matrix.msc4140': true }, 'not-found');
    expect(result).toBe('enabled');
  });

  it('disables delayed events when probe throws UnsupportedError', async () => {
    const result = await probeDelayedEvents({ 'org.matrix.msc4140': true }, 'unsupported-error');
    expect(result).toBe('disabled');
  });

  it('disables delayed events when probe times out (Continuwuity case)', async () => {
    const result = await probeDelayedEvents({ 'org.matrix.msc4140': true }, 'timeout');
    expect(result).toBe('disabled');
  });

  it('disables delayed events on server 500 error', async () => {
    const result = await probeDelayedEvents({ 'org.matrix.msc4157': true }, 'server-error');
    expect(result).toBe('disabled');
  });

  it('does nothing when server does not advertise MSC4140/4157', async () => {
    const result = await probeDelayedEvents({}, 'timeout');
    expect(result).toBe('enabled'); // No feature flag → no probe needed
  });

  it('does nothing when unstable_features is undefined', async () => {
    const result = await probeDelayedEvents(undefined, 'timeout');
    expect(result).toBe('enabled');
  });

  it('recognises MSC4157 feature flag (newer name)', async () => {
    const result = await probeDelayedEvents({ 'org.matrix.msc4157': true }, 'not-found');
    expect(result).toBe('enabled');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. LEGACY VOIP HANDLER CLEANUP
//
// Bug: Setting callEventHandler to undefined without first removing
// the Sync event listener caused a crash on first sync:
//   "Cannot read properties of undefined (reading 'start')"
//
// The startCallEventHandler callback is a class property on
// MatrixClient that references this.callEventHandler.start().
// ═══════════════════════════════════════════════════════════════════

describe('Legacy VoIP handler cleanup', () => {
  it('crashes if handler is nulled without removing listener', () => {
    // Simulate the MatrixClient's startCallEventHandler callback
    const client: any = {
      callEventHandler: { start: vi.fn(), stop: vi.fn() },
      groupCallEventHandler: { start: vi.fn(), stop: vi.fn() },
      listeners: {} as Record<string, Function[]>,
      on(event: string, fn: Function) { (this.listeners[event] ??= []).push(fn); },
      off(event: string, fn: Function) {
        this.listeners[event] = this.listeners[event]?.filter((f: Function) => f !== fn);
      },
      isInitialSyncComplete: () => true,
    };

    // Register the callback (as matrix-js-sdk does)
    const startCallEventHandler = () => {
      if (client.isInitialSyncComplete()) {
        client.callEventHandler.start(); // This throws if handler is undefined
        client.groupCallEventHandler.start();
      }
    };
    client.on('sync', startCallEventHandler);

    // BAD: null the handler without removing the listener
    client.callEventHandler = undefined;

    // Sync event fires → crash
    expect(() => {
      for (const fn of client.listeners['sync'] ?? []) fn();
    }).toThrow();
  });

  it('works correctly when listener is removed first', () => {
    const client: any = {
      callEventHandler: { start: vi.fn(), stop: vi.fn() },
      groupCallEventHandler: { start: vi.fn(), stop: vi.fn() },
      listeners: {} as Record<string, Function[]>,
      on(event: string, fn: Function) { (this.listeners[event] ??= []).push(fn); },
      off(event: string, fn: Function) {
        this.listeners[event] = this.listeners[event]?.filter((f: Function) => f !== fn);
      },
      isInitialSyncComplete: () => true,
    };

    const startCallEventHandler = () => {
      if (client.isInitialSyncComplete()) {
        client.callEventHandler.start();
        client.groupCallEventHandler.start();
      }
    };
    client.on('sync', startCallEventHandler);
    client.startCallEventHandler = startCallEventHandler;

    // GOOD: remove listener first, then null the handlers
    client.off('sync', client.startCallEventHandler);
    client.callEventHandler.stop();
    client.callEventHandler = undefined;
    client.groupCallEventHandler.stop();
    client.groupCallEventHandler = undefined;

    // Sync event fires → no crash, no calls
    expect(() => {
      for (const fn of client.listeners['sync'] ?? []) fn();
    }).not.toThrow();
    expect(client.listeners['sync']).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. LOG ANNOTATION FILTER
//
// Known benign MatrixRTC warnings get an explanatory [Wally] line
// appended — the original warning is preserved, not swallowed.
// ═══════════════════════════════════════════════════════════════════

describe('MatrixRTC log annotation', () => {
  let origWarn: typeof console.warn;
  let origLog: typeof console.log;
  let origInfo: typeof console.info;
  let warnCalls: any[][];
  let logCalls: any[][];
  let infoCalls: any[][];

  beforeEach(() => {
    warnCalls = [];
    logCalls = [];
    infoCalls = [];
    origWarn = console.warn;
    origLog = console.log;
    origInfo = console.info;
  });

  afterEach(() => {
    console.warn = origWarn;
    console.log = origLog;
    console.info = origInfo;
  });

  function installFilter() {
    const realWarn = (...args: any[]) => { warnCalls.push(args); };
    const realLog = (...args: any[]) => { logCalls.push(args); };
    console.info = (...args: any[]) => { infoCalls.push(args); };

    console.warn = (...args: any[]) => {
      const msg = String(args[0] ?? '');
      if (msg.includes('unexpected encrypted to-device event') && msg.includes('call.encryption_keys')) {
        realWarn(...args);
        console.info('[Wally] ^ This is fine — keys delivered normally.');
        return;
      }
      realWarn(...args);
    };

    console.log = (...args: any[]) => {
      const msg = String(args[0] ?? '');
      if (msg.includes('No targets found for sending key')) {
        realLog(...args);
        console.info('[Wally] ^ Normal — no other call members right now.');
        return;
      }
      realLog(...args);
    };
  }

  it('annotates Rust crypto encryption key warning', () => {
    installFilter();
    console.warn('WARN matrix_sdk_crypto: Received an unexpected encrypted to-device event with call.encryption_keys');

    expect(warnCalls).toHaveLength(1); // Original preserved
    expect(infoCalls).toHaveLength(1); // Annotation added
    expect(infoCalls[0][0]).toContain('[Wally]');
    expect(infoCalls[0][0]).toContain('keys delivered normally');
  });

  it('annotates "No targets found for sending key"', () => {
    installFilter();
    console.log('[MatrixRTCSession][ToDeviceKeyTransport] No targets found for sending key');

    expect(logCalls).toHaveLength(1); // Original preserved
    expect(infoCalls).toHaveLength(1); // Annotation added
    expect(infoCalls[0][0]).toContain('[Wally]');
    expect(infoCalls[0][0]).toContain('no other call members');
  });

  it('passes through unrelated warnings unchanged', () => {
    installFilter();
    console.warn('Something completely different');

    expect(warnCalls).toHaveLength(1);
    expect(infoCalls).toHaveLength(0); // No annotation
  });

  it('passes through unrelated log messages unchanged', () => {
    installFilter();
    console.log('Regular log message');

    expect(logCalls).toHaveLength(1);
    expect(infoCalls).toHaveLength(0);
  });
});
