import { useEffect, useRef } from 'react';
import { clearCacheAndReload } from '../../../client/initMatrix';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import {
  collectMemoryReport,
  logMemoryReport,
  saveMemoryReport,
} from '../../utils/memoryReport';

// CallProvider persists its active-call state here; reading the raw key avoids
// coupling the watchdog to the CallProvider mount order.
const ACTIVE_CALL_SESSION_KEY = 'cinny_active_call';
const RESET_COOLDOWN_KEY = 'cinny_mem_reset_at';
const CHECK_INTERVAL_MS = 15_000;
const SOFT_PRESSURE = 0.75;
const HARD_PRESSURE = 0.9;
const RESET_COOLDOWN_MS = 10 * 60 * 1000;

interface PerfMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

function readMemory(): PerfMemory | null {
  const m = (performance as unknown as { memory?: PerfMemory }).memory;
  return m && m.jsHeapSizeLimit > 0 ? m : null;
}

function isInCall(): boolean {
  try {
    return sessionStorage.getItem(ACTIVE_CALL_SESSION_KEY) !== null;
  } catch {
    return false;
  }
}

function canResetNow(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RESET_COOLDOWN_KEY) ?? '0');
    if (!last) return true;
    return Date.now() - last > RESET_COOLDOWN_MS;
  } catch {
    return true;
  }
}

function markReset(): void {
  try {
    sessionStorage.setItem(RESET_COOLDOWN_KEY, String(Date.now()));
  } catch {
    // no-op
  }
}

/**
 * Preempts the tab being OOM-killed by the browser.
 *
 * Chromium exposes `performance.memory`; on Firefox/Safari this component is a
 * no-op because there's no reliable heap signal. On Chromium we poll every 15s:
 *   - >= 75% of jsHeapSizeLimit: one-shot console warning.
 *   - >= 90% and no active call: clearCacheAndReload(). A session cooldown
 *     prevents reload loops if the post-reload app still climbs back up.
 */
export function MemoryWatchdog() {
  const mx = useMatrixClient();
  const warnedRef = useRef(false);

  useEffect(() => {
    if (!readMemory()) return undefined;

    const check = () => {
      const m = readMemory();
      if (!m) return;
      const ratio = m.usedJSHeapSize / m.jsHeapSizeLimit;

      if (ratio >= SOFT_PRESSURE && !warnedRef.current) {
        warnedRef.current = true;
        console.warn(
          `[Wally] JS heap at ${Math.round(ratio * 100)}% of limit — will auto-reset if it reaches ${Math.round(HARD_PRESSURE * 100)}%.`
        );
      } else if (ratio < SOFT_PRESSURE * 0.9) {
        warnedRef.current = false;
      }

      if (ratio >= HARD_PRESSURE && !isInCall() && canResetNow()) {
        markReset();
        console.warn(
          `[Wally] JS heap at ${Math.round(ratio * 100)}% — capturing report, then resetting cache and reloading.`
        );
        try {
          const report = collectMemoryReport(mx, 'auto');
          saveMemoryReport(report);
          logMemoryReport(report);
        } catch (e) {
          console.warn('[Wally] Failed to capture memory report:', e);
        }
        clearCacheAndReload(mx).catch(() => window.location.reload());
      }
    };

    const id = window.setInterval(check, CHECK_INTERVAL_MS);
    check();
    return () => window.clearInterval(id);
  }, [mx]);

  return null;
}
