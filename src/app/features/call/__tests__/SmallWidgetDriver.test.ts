import { describe, it, expect, vi } from 'vitest';
import { MatrixCapabilities, WidgetKind } from 'matrix-widget-api';
import { SmallWidgetDriver } from '../SmallWidgetDriver';
import type { MatrixClient } from 'matrix-js-sdk';

function makeDriver(getVersions: () => Promise<unknown>) {
  const mockMx = {
    getSafeUserId: () => '@alice:example.com',
    getDeviceId: () => 'ALICEDEVICE',
    getVersions,
  } as unknown as MatrixClient;

  return new SmallWidgetDriver(
    mockMx,
    [],
    {} as any,
    WidgetKind.Room,
    true,
    '!room:example.com',
  );
}

const DELAYED_CAPS = new Set([
  MatrixCapabilities.MSC4157SendDelayedEvent,
  MatrixCapabilities.MSC4157UpdateDelayedEvent,
]);

describe('SmallWidgetDriver.validateCapabilities', () => {
  it('grants delayed-event caps when server supports MSC4157', async () => {
    const driver = makeDriver(() =>
      Promise.resolve({ unstable_features: { 'org.matrix.msc4157': true } }),
    );
    const result = await driver.validateCapabilities(new Set(DELAYED_CAPS));
    expect(result.has(MatrixCapabilities.MSC4157SendDelayedEvent)).toBe(true);
    expect(result.has(MatrixCapabilities.MSC4157UpdateDelayedEvent)).toBe(true);
  });

  it('grants delayed-event caps when server supports MSC4140 (legacy flag)', async () => {
    const driver = makeDriver(() =>
      Promise.resolve({ unstable_features: { 'org.matrix.msc4140': true } }),
    );
    const result = await driver.validateCapabilities(new Set(DELAYED_CAPS));
    expect(result.has(MatrixCapabilities.MSC4157SendDelayedEvent)).toBe(true);
  });

  it('strips delayed-event caps when server has no MSC4157/MSC4140', async () => {
    const driver = makeDriver(() => Promise.resolve({ unstable_features: {} }));
    const result = await driver.validateCapabilities(new Set(DELAYED_CAPS));
    expect(result.has(MatrixCapabilities.MSC4157SendDelayedEvent)).toBe(false);
    expect(result.has(MatrixCapabilities.MSC4157UpdateDelayedEvent)).toBe(false);
  });

  it('strips delayed-event caps when unstable_features is missing', async () => {
    const driver = makeDriver(() => Promise.resolve({}));
    const result = await driver.validateCapabilities(new Set(DELAYED_CAPS));
    expect(result.has(MatrixCapabilities.MSC4157SendDelayedEvent)).toBe(false);
  });

  it('strips delayed-event caps when getVersions() throws', async () => {
    const driver = makeDriver(() => Promise.reject(new Error('Network error')));
    const result = await driver.validateCapabilities(new Set(DELAYED_CAPS));
    expect(result.has(MatrixCapabilities.MSC4157SendDelayedEvent)).toBe(false);
    expect(result.has(MatrixCapabilities.MSC4157UpdateDelayedEvent)).toBe(false);
  });

  it('passes through unrelated capabilities unchanged', async () => {
    const driver = makeDriver(() => Promise.resolve({ unstable_features: {} }));
    const caps = new Set([MatrixCapabilities.AlwaysOnScreen, MatrixCapabilities.Screenshots]);
    const result = await driver.validateCapabilities(caps);
    expect(result.has(MatrixCapabilities.AlwaysOnScreen)).toBe(true);
    expect(result.has(MatrixCapabilities.Screenshots)).toBe(true);
  });

  it('caches the getVersions() result across multiple calls', async () => {
    const getVersions = vi.fn().mockResolvedValue({
      unstable_features: { 'org.matrix.msc4157': true },
    });
    const driver = makeDriver(getVersions);
    await driver.validateCapabilities(new Set(DELAYED_CAPS));
    await driver.validateCapabilities(new Set(DELAYED_CAPS));
    expect(getVersions).toHaveBeenCalledTimes(1);
  });
});
