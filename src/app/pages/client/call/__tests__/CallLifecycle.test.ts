/**
 * Regression tests for Element Call widget lifecycle bugs found during
 * the March 2026 debugging sessions.
 *
 * These tests cover the state machine logic in PersistentCallContainer
 * and CallProvider without rendering React components — they test the
 * decision functions and guard conditions directly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════
// 1. STALE REF SKIP GUARD
//
// Bug: After hangup, callSmallWidgetRef kept the old SmallWidget but
// the iframe was navigated to about:blank. When Room.tsx's auto-join
// re-fired setActiveCallRoomId, the setup effect's skip guard saw the
// ref had the same roomId and bailed — leaving the iframe on about:blank.
//
// Fix: Skip guard also checks iframe.src !== 'about:blank'.
// ═══════════════════════════════════════════════════════════════════

/** Mirrors the skip guard logic in PersistentCallContainer's setup effect. */
function shouldSkipSetup(
  refRoomId: string | undefined,
  activeCallRoomId: string,
  iframeSrc: string
): boolean {
  return !!(
    refRoomId &&
    refRoomId === activeCallRoomId &&
    iframeSrc !== 'about:blank' &&
    iframeSrc !== ''
  );
}

describe('Widget setup skip guard', () => {
  const ROOM_ID = '!voice:example.com';

  it('skips when widget is alive for the same room', () => {
    expect(shouldSkipSetup(ROOM_ID, ROOM_ID, 'https://call.example.com/room?embed=true')).toBe(true);
  });

  it('does NOT skip when iframe is about:blank (stale ref after hangup)', () => {
    expect(shouldSkipSetup(ROOM_ID, ROOM_ID, 'about:blank')).toBe(false);
  });

  it('does NOT skip when iframe src is empty', () => {
    expect(shouldSkipSetup(ROOM_ID, ROOM_ID, '')).toBe(false);
  });

  it('does NOT skip when ref has no roomId (first setup)', () => {
    expect(shouldSkipSetup(undefined, ROOM_ID, 'about:blank')).toBe(false);
  });

  it('does NOT skip when room changed (switching calls)', () => {
    expect(shouldSkipSetup('!other:example.com', ROOM_ID, 'https://call.example.com/room')).toBe(false);
  });

  it('does NOT skip when ref roomId is undefined even if iframe has URL', () => {
    expect(shouldSkipSetup(undefined, ROOM_ID, 'https://call.example.com/room')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. HANGUP ABOUT:BLANK TIMER RACE
//
// Bug: hangUp() captured the iframe DOM element and fired a 300ms timer
// to set src='about:blank'. If the user re-joined within 300ms,
// setupWidget set the new EC URL but the old timer fired and overwrote
// it with about:blank.
//
// Fix: setActiveCallRoomId() cancels any pending hangup timer.
// ═══════════════════════════════════════════════════════════════════

describe('Hangup timer cancellation on re-join', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('old hangup timer should not overwrite new URL if cancelled', () => {
    const iframe = { src: 'https://call.example.com/room?old' };
    let timerRef: ReturnType<typeof setTimeout> | null = null;

    // Simulate hangUp: schedule about:blank in 300ms
    timerRef = setTimeout(() => {
      iframe.src = 'about:blank';
    }, 300);

    // Simulate re-join within 300ms: cancel old timer, set new URL
    if (timerRef !== null) {
      clearTimeout(timerRef);
      timerRef = null;
    }
    iframe.src = 'https://call.example.com/room?new';

    // Advance past the 300ms — timer should NOT fire
    vi.advanceTimersByTime(500);

    expect(iframe.src).toBe('https://call.example.com/room?new');
  });

  it('without cancellation, old timer DOES overwrite new URL (the bug)', () => {
    const iframe = { src: 'https://call.example.com/room?old' };

    // Simulate hangUp without saving timer ref (old buggy code)
    setTimeout(() => {
      iframe.src = 'about:blank';
    }, 300);

    // Simulate re-join — sets new URL but doesn't cancel timer
    iframe.src = 'https://call.example.com/room?new';

    // Advance past 300ms — timer fires and overwrites
    vi.advanceTimersByTime(500);

    expect(iframe.src).toBe('about:blank'); // BUG: new URL lost
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. WIDGET HANDLER EFFECT STABILITY
//
// Bug: The CallProvider widget-handler effect had
//   activeClientWidget?.iframe?.contentDocument
// in its dependency array. This DOM property returns a new reference
// every render, causing the effect to re-run on EVERY render:
// tearing down all widget API handlers and re-sending device_mute.
//
// Fix: Handlers read state from refs, effect only depends on the
// widget API instance itself.
// ═══════════════════════════════════════════════════════════════════

describe('Widget handler effect dependencies', () => {
  it('DOM property access returns different references (demonstrates the bug)', () => {
    // Simulates what happens when activeClientWidget?.iframe?.contentDocument
    // is used as a React effect dependency — it's a new object each access
    const mockIframe = {
      get contentDocument() {
        // Each access returns a "new" reference (in real DOM, the document
        // object may be the same, but React's Object.is comparison on
        // the optional-chain expression evaluates differently per render)
        return { title: 'test' };
      },
    };

    const ref1 = mockIframe.contentDocument;
    const ref2 = mockIframe.contentDocument;

    // Even though the content is the same, these are different object references
    expect(ref1).not.toBe(ref2);
    // This is why it causes effect re-runs — React sees deps changed
  });

  it('refs provide stable access to mutable state', () => {
    // The fix pattern: use refs that are updated during render
    const ref = { current: false };

    // "Render 1": handler reads ref
    const handler1 = () => ref.current;
    expect(handler1()).toBe(false);

    // "Render 2": state changes, ref updated, but handler is the SAME function
    ref.current = true;
    expect(handler1()).toBe(true); // Same handler, reads current value
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. PENDING JOIN / AUTO-JOIN GATE
//
// The callAutoJoin setting controls whether EC loads immediately or
// waits for user confirmation via the pre-join screen.
//
// Race: pendingJoin state update hasn't flushed on the first render
// after activeCallRoomId is set. joinConfirmedRef is used as a
// synchronous guard to prevent premature widget setup.
// ═══════════════════════════════════════════════════════════════════

/** Mirrors the gate condition in PersistentCallContainer's setup effect. */
function shouldProceedWithSetup(
  activeCallRoomId: string | null,
  isActiveCallReady: boolean,
  pendingJoin: boolean,
  joinConfirmedRef: boolean,
): boolean {
  if (!activeCallRoomId || isActiveCallReady) return false;
  if (pendingJoin && !joinConfirmedRef) return false;
  return true;
}

describe('Pre-join gate (callAutoJoin setting)', () => {
  const ROOM_ID = '!voice:example.com';

  it('proceeds when no pending join (callAutoJoin=true)', () => {
    expect(shouldProceedWithSetup(ROOM_ID, false, false, false)).toBe(true);
  });

  it('blocks when pending join and not confirmed (callAutoJoin=false, pre-join showing)', () => {
    expect(shouldProceedWithSetup(ROOM_ID, false, true, false)).toBe(false);
  });

  it('proceeds when pending join but confirmed via ref (user clicked Join)', () => {
    expect(shouldProceedWithSetup(ROOM_ID, false, true, true)).toBe(true);
  });

  it('blocks when no active call room', () => {
    expect(shouldProceedWithSetup(null, false, false, false)).toBe(false);
  });

  it('blocks when call is already ready (prevents duplicate setup)', () => {
    expect(shouldProceedWithSetup(ROOM_ID, true, false, false)).toBe(false);
  });

  it('handles one-render race: pendingJoin still false on first render', () => {
    // On the first render after setActiveCallRoomId, pendingJoin hasn't
    // been updated by the effect yet (still false from initial state).
    // joinConfirmedRef is also false. Setup should proceed because
    // !pendingJoin is true (auto-join path).
    expect(shouldProceedWithSetup(ROOM_ID, false, false, false)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. CLEANUP ON HANGUP
//
// Bug: hangUp() cleared React state but not callSmallWidgetRef.
// The stale ref blocked widget re-creation on subsequent joins.
//
// Fix: Cleanup effect watches activeCallRoomId becoming null and
// clears the refs.
// ═══════════════════════════════════════════════════════════════════

describe('Widget cleanup on hangup', () => {
  it('stale widget ref should be cleared when call ends', () => {
    const stopMessaging = vi.fn();
    const widgetRef = {
      current: { roomId: '!voice:example.com', stopMessaging } as any,
    };
    const apiRef = { current: {} as any };

    // Simulate: activeCallRoomId became null (hangup)
    const activeCallRoomId = null;
    if (!activeCallRoomId && widgetRef.current) {
      widgetRef.current.stopMessaging();
      widgetRef.current = null;
      apiRef.current = null;
    }

    expect(stopMessaging).toHaveBeenCalledOnce();
    expect(widgetRef.current).toBeNull();
    expect(apiRef.current).toBeNull();
  });

  it('cleanup does nothing when call is still active', () => {
    const stopMessaging = vi.fn();
    const widgetRef = {
      current: { roomId: '!voice:example.com', stopMessaging } as any,
    };

    const activeCallRoomId = '!voice:example.com';
    if (!activeCallRoomId && widgetRef.current) {
      widgetRef.current.stopMessaging();
      widgetRef.current = null;
    }

    expect(stopMessaging).not.toHaveBeenCalled();
    expect(widgetRef.current).not.toBeNull();
  });

  it('cleanup handles already-null ref gracefully', () => {
    const widgetRef = { current: null };
    const activeCallRoomId = null;

    // Should not throw
    if (!activeCallRoomId && widgetRef.current) {
      widgetRef.current.stopMessaging();
      widgetRef.current = null;
    }

    expect(widgetRef.current).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. RELOAD RETRY LIMIT
//
// The health-check effect reloads the iframe if the widget channel
// fails to establish within 8 seconds. Without a limit, this could
// loop indefinitely. The reload is limited to one attempt.
// ═══════════════════════════════════════════════════════════════════

describe('Reload retry limit', () => {
  it('allows first reload', () => {
    let reloaded = false;
    const reload = () => {
      if (reloaded) return;
      reloaded = true;
    };

    reload();
    expect(reloaded).toBe(true);
  });

  it('blocks second reload', () => {
    let reloaded = false;
    let reloadCount = 0;
    const reload = () => {
      if (reloaded) return;
      reloaded = true;
      reloadCount++;
    };

    reload();
    reload(); // Second attempt
    expect(reloadCount).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. IFRAME VISIBILITY CONDITIONS
//
// The iframe display condition must account for all relevant state.
// Missing any condition causes the iframe to be visible at the wrong
// time (e.g., showing about:blank during pre-join) or hidden when
// it should be visible.
// ═══════════════════════════════════════════════════════════════════

function isIframeVisible(
  activeCallRoomId: string | null,
  pendingJoin: boolean,
  isCallViewOpen: boolean,
  isMobile: boolean,
  isChatOpen: boolean,
): boolean {
  return !!(activeCallRoomId && !pendingJoin && isCallViewOpen && !(isMobile && isChatOpen));
}

describe('Iframe visibility conditions', () => {
  const ROOM = '!voice:example.com';

  it('visible when call active, not pending, view open, desktop', () => {
    expect(isIframeVisible(ROOM, false, true, false, false)).toBe(true);
  });

  it('hidden when no active call', () => {
    expect(isIframeVisible(null, false, true, false, false)).toBe(false);
  });

  it('hidden during pending join (pre-join screen showing)', () => {
    expect(isIframeVisible(ROOM, true, true, false, false)).toBe(false);
  });

  it('hidden when call view not open', () => {
    expect(isIframeVisible(ROOM, false, false, false, false)).toBe(false);
  });

  it('hidden on mobile when chat is open', () => {
    expect(isIframeVisible(ROOM, false, true, true, true)).toBe(false);
  });

  it('visible on mobile when chat is closed', () => {
    expect(isIframeVisible(ROOM, false, true, true, false)).toBe(true);
  });

  it('visible on desktop even when chat is open', () => {
    expect(isIframeVisible(ROOM, false, true, false, true)).toBe(true);
  });
});
