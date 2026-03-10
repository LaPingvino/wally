// Shared lazy AudioContext + named tone generators.
// All sounds are short Web Audio API tones — no asset files needed.
// Callers are responsible for checking user settings before calling.

let audioCtx: AudioContext | null = null;

function ctx(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

function tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
  try {
    const c = ctx();
    // Browsers start AudioContext suspended; resume() is a no-op if already running.
    void c.resume();
    const now = c.currentTime;
    const g = c.createGain();
    g.connect(c.destination);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.01);
    g.gain.setValueAtTime(gain, now + dur - 0.02);
    g.gain.linearRampToValueAtTime(0, now + dur);
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(g);
    osc.start(now);
    osc.stop(now + dur);
  } catch {
    // Audio not supported or blocked by browser
  }
}

/** C5->E5 two-tone ascending -- urgent mention alert */
export function playMentionSound(): void {
  tone(523.25, 0.12, 0.25);
  setTimeout(() => tone(659.25, 0.15, 0.3), 120);
}

/** Single A4 soft beep -- activity in current room */
export function playCurrentRoomSound(): void {
  tone(440, 0.08, 0.1);
}

/** Low Eb4 tick, very quiet -- activity in another room */
export function playOtherRoomSound(): void {
  tone(311.13, 0.06, 0.07);
}

/** Very brief 800Hz click -- someone started typing */
export function playTypingSound(): void {
  tone(800, 0.04, 0.05, 'square');
}

/** A5->C#6 two quick sparkle tones -- reaction received */
export function playReactionSound(): void {
  tone(880, 0.08, 0.15);
  setTimeout(() => tone(1108.73, 0.1, 0.12), 80);
}

/** A4->C#5->E5 three-step sweep -- reply to your message */
export function playReplyToMeSound(): void {
  tone(440, 0.1, 0.15);
  setTimeout(() => tone(554.37, 0.1, 0.15), 100);
  setTimeout(() => tone(659.25, 0.12, 0.18), 200);
}
