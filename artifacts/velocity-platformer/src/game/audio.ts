// Tiny WebAudio synth for gameplay sounds (no audio files needed). Volume follows the Settings sliders.
let ctx: AudioContext | null = null;

function volume(): number {
  const read = (key: string, fallback: number) => {
    try { return Number(localStorage.getItem(key) ?? fallback) / 100; } catch { return fallback / 100; }
  };
  return Math.max(0, Math.min(1, read("sr-master-volume", 80) * read("sr-effects-volume", 85)));
}

function context(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(c: AudioContext, type: OscillatorType, from: number, to: number, dur: number, gain: number) {
  const osc = c.createOscillator();
  const g = c.createGain();
  const t = c.currentTime;
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(c: AudioContext, dur: number, gain: number, cutoff: number) {
  const len = Math.floor(c.sampleRate * dur);
  const buffer = c.createBuffer(1, len, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = cutoff;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(c.destination);
  src.start();
}

export function playSound(name: string): void {
  const v = volume();
  if (v <= 0) return;
  const c = context();
  if (!c) return;
  switch (name) {
    case "beep": tone(c, "square", 1040, 1040, 0.07, 0.11 * v); break;
    case "lock": tone(c, "square", 1560, 1560, 0.22, 0.13 * v); break;
    case "shot": noise(c, 0.22, 0.5 * v, 2600); tone(c, "sawtooth", 180, 40, 0.2, 0.25 * v); break;
    case "break": noise(c, 0.16, 0.38 * v, 5200); tone(c, "triangle", 320, 90, 0.12, 0.12 * v); break;
    case "hit": noise(c, 0.07, 0.3 * v, 1800); tone(c, "square", 220, 120, 0.08, 0.1 * v); break;
    case "crack": noise(c, 0.05, 0.22 * v, 4000); break;
    case "tech": tone(c, "sine", 520, 1180, 0.2, 0.14 * v); tone(c, "triangle", 780, 1560, 0.16, 0.07 * v); break;
    default: break;
  }
}
