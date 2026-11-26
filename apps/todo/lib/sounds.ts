let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioContext) audioContext = new Ctx();
  return audioContext;
}

export function playSubtaskCompleteSound() {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    void ctx.resume();
  }

  const now = ctx.currentTime;

  const tone = ctx.createOscillator();
  const gain = ctx.createGain();
  tone.type = "sine";
  tone.frequency.setValueAtTime(600, now);
  tone.frequency.exponentialRampToValueAtTime(800, now + 0.06);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.07, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
  tone.connect(gain).connect(ctx.destination);
  tone.start(now);
  tone.stop(now + 0.08);
}

export function playTaskCompleteSound() {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    void ctx.resume();
  }

  const now = ctx.currentTime;

  const toneA = ctx.createOscillator();
  const gainA = ctx.createGain();
  toneA.type = "sine";
  toneA.frequency.setValueAtTime(740, now);
  toneA.frequency.exponentialRampToValueAtTime(980, now + 0.09);
  gainA.gain.setValueAtTime(0.0001, now);
  gainA.gain.exponentialRampToValueAtTime(0.09, now + 0.012);
  gainA.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
  toneA.connect(gainA).connect(ctx.destination);
  toneA.start(now);
  toneA.stop(now + 0.12);

  const toneB = ctx.createOscillator();
  const gainB = ctx.createGain();
  toneB.type = "triangle";
  toneB.frequency.setValueAtTime(990, now + 0.055);
  toneB.frequency.exponentialRampToValueAtTime(1320, now + 0.16);
  gainB.gain.setValueAtTime(0.0001, now + 0.055);
  gainB.gain.exponentialRampToValueAtTime(0.06, now + 0.075);
  gainB.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  toneB.connect(gainB).connect(ctx.destination);
  toneB.start(now + 0.055);
  toneB.stop(now + 0.19);
}
