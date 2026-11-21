let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new Ctor();
  }
  return sharedAudioCtx;
}

/**
 * Plays a subtle, soft 3-note ascending workshop chime (C5 -> E5 -> G5)
 * using Web Audio oscillators with no external network requests.
 */
export function playSuccessChime(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {
        // Ignore autoplay restriction errors when not triggered by user gesture
      });
    }

    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5

    notes.forEach((freq, idx) => {
      const start = now + idx * 0.075;
      const duration = idx === notes.length - 1 ? 0.34 : 0.22;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.065, start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + duration + 0.02);
    });
  } catch {
    // Gracefully ignore audio errors in restricted environments
  }
}
