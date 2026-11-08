import { describe, it, expect, vi } from 'vitest';
import {
  EventDirection,
  MatrixCapabilities,
  OpenIDRequestState,
  WidgetEventCapability,
  WidgetKind,
} from 'matrix-widget-api';
import { SmallWidgetDriver, isOwnIssueWidget } from '../SmallWidgetDriver';
import type { MatrixClient } from 'matrix-js-sdk';

function makeDriver(getVersions: () => Promise<unknown>, templateUrl?: string) {
  const mockMx = {
    getSafeUserId: () => '@alice:example.com',
    getUserId: () => '@alice:example.com',
    getDeviceId: () => 'ALICEDEVICE',
    getVersions,
    getOpenIdToken: () => Promise.resolve({ access_token: 'tok' }),
  } as unknown as MatrixClient;

  return new SmallWidgetDriver(
    mockMx,
    [],
    { templateUrl, name: 'Test widget' } as any,
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

  it('grants allowed capabilities the widget asks for', async () => {
    const driver = makeDriver(() => Promise.resolve({ unstable_features: {} }));
    const caps = new Set([MatrixCapabilities.AlwaysOnScreen, MatrixCapabilities.Screenshots]);
    const result = await driver.validateCapabilities(caps);
    expect(result.has(MatrixCapabilities.AlwaysOnScreen)).toBe(true);
    expect(result.has(MatrixCapabilities.Screenshots)).toBe(true);
  });

  it('refuses capabilities outside the allowed set (other rooms, all rooms)', async () => {
    const driver = makeDriver(() => Promise.resolve({ unstable_features: {} }));
    const result = await driver.validateCapabilities(
      new Set([
        'org.matrix.msc2762.timeline:*',
        'org.matrix.msc2762.timeline:!other:example.com',
        'org.matrix.msc2762.timeline:!room:example.com',
        WidgetEventCapability.forStateEvent(EventDirection.Send, 'm.room.power_levels').raw,
      ]),
    );
    expect([...result]).toEqual(['org.matrix.msc2762.timeline:!room:example.com']);
  });

  it("gives the issue-state capabilities only to Wally's own widget page", async () => {
    const issueCap = WidgetEventCapability.forStateEvent(EventDirection.Send, 'eu.kiefte.issue').raw;
    const own = makeDriver(
      () => Promise.resolve({}),
      `${window.location.origin}/widget.html?roomId=x&widgetId=w`,
    );
    const stranger = makeDriver(() => Promise.resolve({}), 'https://evil.example/widget.html');
    expect((await own.validateCapabilities(new Set([issueCap]))).has(issueCap)).toBe(true);
    expect((await stranger.validateCapabilities(new Set([issueCap]))).has(issueCap)).toBe(false);
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

describe('isOwnIssueWidget', () => {
  it('matches only same-origin /widget.html', () => {
    expect(isOwnIssueWidget(`${window.location.origin}/widget.html?a=1`)).toBe(true);
    expect(isOwnIssueWidget('https://evil.example/widget.html')).toBe(false);
    expect(isOwnIssueWidget(`${window.location.origin}/other.html`)).toBe(false);
    expect(isOwnIssueWidget(undefined)).toBe(false);
  });
});

describe('SmallWidgetDriver.askOpenID', () => {
  function observe(driver: SmallWidgetDriver) {
    const updates: unknown[] = [];
    const observer = { update: (u: unknown) => updates.push(u) } as any;
    return driver.askOpenID(observer).then(() => updates);
  }

  it('asks before giving a stranger widget the identity token', async () => {
    const confirm = vi.fn().mockReturnValue(false);
    window.confirm = confirm;
    const updates = await observe(makeDriver(() => Promise.resolve({}), 'https://x.example/'));
    expect(confirm).toHaveBeenCalledOnce();
    expect(updates).toEqual([{ state: OpenIDRequestState.Blocked }]);
  });

  it("doesn't ask for Wally's own widget page", async () => {
    const confirm = vi.fn();
    window.confirm = confirm;
    const updates = await observe(
      makeDriver(() => Promise.resolve({}), `${window.location.origin}/widget.html`),
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(updates).toEqual([{ state: OpenIDRequestState.Allowed, token: { access_token: 'tok' } }]);
  });
});
