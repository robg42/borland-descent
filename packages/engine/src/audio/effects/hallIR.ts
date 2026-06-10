/**
 * Generate a warm stereo hall impulse response in pure JS — no external file needed, so
 * the convolution reverb has real space out of the box. It's an early-reflection cluster
 * (a sense of size) over a frequency-damped exponential noise tail (highs die first, like
 * a real room), decorrelated L/R for width. A real recorded IR — e.g. an Open AIR
 * cathedral WAV — drops straight in via Tone.Convolver.load() to replace it.
 */
export function generateHallIR(
  sampleRate: number,
  decaySec: number,
  preDelaySec = 0.02,
): Float32Array[] {
  const pre = Math.max(0, Math.floor(preDelaySec * sampleRate));
  const tail = Math.max(1, Math.floor(Math.max(0.1, decaySec) * sampleRate));
  const len = pre + tail;
  const channels: Float32Array[] = [new Float32Array(len), new Float32Array(len)];

  // early reflections: discrete taps (ms, gain), slightly offset per channel for width
  const taps: Array<[number, number]> = [
    [7, 0.5],
    [13, 0.42],
    [23, 0.33],
    [37, 0.26],
    [53, 0.2],
    [71, 0.16],
  ];

  for (let ch = 0; ch < 2; ch++) {
    const data = channels[ch]!;
    let lp = 0;
    for (let i = 0; i < tail; i++) {
      const t = i / tail; // 0..1 through the tail
      const env = Math.pow(1 - t, 2.2); // smooth exponential-ish decay
      const noise = Math.random() * 2 - 1;
      // one-pole lowpass whose cutoff falls as the tail decays → warm, darkening tail
      const coeff = 0.55 * (1 - t) + 0.06;
      lp += coeff * (noise - lp);
      data[pre + i] = lp * env;
    }
    for (const [ms, g] of taps) {
      const idx = pre + Math.floor(((ms + ch * 1.7) / 1000) * sampleRate);
      if (idx < len) data[idx] = data[idx]! + g * (ch === 0 ? 1 : -1);
    }
  }

  // keep a sane peak (Tone.Convolver also equal-power normalises on assignment)
  let max = 0;
  for (const d of channels) for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i]!);
    if (a > max) max = a;
  }
  if (max > 0) {
    const g = 0.5 / max;
    for (const d of channels) for (let i = 0; i < d.length; i++) d[i] = d[i]! * g;
  }
  return channels;
}
