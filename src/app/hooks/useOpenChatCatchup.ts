import { useEffect } from 'react';
import { useMatrixClient } from './useMatrixClient';

// Backstop cadence for the open-chat catch-up poke. Slow enough to be cheap while
// you sit in a chat, fast enough that a straggler bridged message converges quickly.
const CATCHUP_MS = 1500;

/**
 * Open-chat catch-up poller.
 *
 * While a chat is open AND the tab is visible, poke the sliding connection on a slow
 * backstop cadence so the open conversation CONVERGES within ~CATCHUP_MS even when a
 * single wake-poke returned before a just-arrived message had settled server-side.
 * Continuwuity computes each sliding response at request time and holds the poll, so
 * a message that lands mid-hold — especially a multi-hop WhatsApp-bridge message,
 * which often arrives in a burst — only surfaces on a LATER poll; the open chat then
 * looks like it dropped messages even though they arrive. The wake heartbeat
 * (slidingSyncHealth.ts) still delivers the instant case; this catches the stragglers
 * for the chat you're actively in.
 *
 * No-op under classic sync (nothing to poke) and while the tab is hidden. Stops on
 * unmount / room switch — no permanent fast-poll, no transport mixing.
 */
export const useOpenChatCatchup = (roomId?: string): void => {
  const mx = useMatrixClient();
  useEffect(() => {
    if (!roomId) return undefined;
    const getSliding = (): { poke?: () => void } | undefined =>
      (mx as unknown as { getSlidingSync?: () => { poke?: () => void } | undefined }).getSlidingSync?.();
    if (!getSliding()) return undefined; // classic /sync IS the sync — nothing to poke

    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = (): void => {
      if (document.visibilityState !== 'visible') return;
      try {
        getSliding()?.poke?.();
      } catch {
        /* ignore */
      }
    };
    const start = (): void => {
      if (!timer) timer = setInterval(tick, CATCHUP_MS);
    };
    const stop = (): void => {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') start();
      else stop();
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [mx, roomId]);
};
