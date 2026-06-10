import { fft, nextPow2 } from './fft';

/** Progress callback: fraction in [0,1]. */
export type Progress = (fraction: number) => void;

export interface PaulStretchOpts {
  /** Time-stretch factor (>1 = longer). */
  stretch: number;
  /** Analysis window length in seconds — larger = smoother/more smeared. */
  windowSec: number;
}

export interface GranularOpts {
  /** Time-stretch factor (>1 = longer, <1 = shorter). */
  stretch: number;
  /** Grain length in milliseconds. */
  grainMs: number;
  /** Random grain-position jitter in milliseconds. */
  jitterMs: number;
  /** Pitch shift in semitones (independent of stretch). */
  pitch: number;
}

const yieldToHost = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Scale all channels so the peak sits at `peak`. */
function normalise(channels: Float32Array[], peak = 0.95): void {
  let max = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]!);
      if (a > max) max = a;
    }
  }
  if (max <= 0) return;
  const g = peak / max;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) ch[i] = ch[i]! * g;
  }
}

/**
 * PaulStretch: extreme, smooth time-stretch by random-phase spectral reconstruction.
 * Per channel: overlapping windows → FFT → keep the magnitude but RANDOMISE the phase of
 * every bin → IFFT → window → overlap-add at a stretched hop. The random phase is what
 * smears transients into the characteristic frozen, choral wash (rather than a metallic
 * phase-vocoder). Phases are randomised independently per channel, so stereo widens.
 * Output length ≈ input × stretch. Pure (Float32Array in/out) — headless-testable.
 */
export async function paulStretch(
  channels: Float32Array[],
  sampleRate: number,
  opts: PaulStretchOpts,
  onProgress?: Progress,
): Promise<Float32Array[]> {
  const stretch = Math.max(1, opts.stretch);
  const winSize = nextPow2(Math.max(256, Math.round(opts.windowSec * sampleRate)));
  const half = winSize >> 1;

  const window = new Float32Array(winSize);
  for (let i = 0; i < winSize; i++) {
    const x = (2 * i) / (winSize - 1) - 1; // -1..1
    window[i] = Math.pow(1 - x * x, 1.25); // the PaulStretch window (zero at both ends)
  }

  const inLen = channels[0]?.length ?? 0;
  const inHop = half / stretch;
  const outLen = Math.floor(inLen * stretch) + winSize;
  const out = channels.map(() => new Float32Array(outLen));

  const re = new Float32Array(winSize);
  const im = new Float32Array(winSize);
  const norm = 1 / winSize;
  const numSteps = Math.max(1, Math.floor((inLen - winSize) / inHop));

  let step = 0;
  for (let inStart = 0; inStart + winSize <= inLen; inStart += inHop, step++) {
    const i0 = Math.floor(inStart);
    const outStart = step * half;
    for (let ch = 0; ch < channels.length; ch++) {
      const src = channels[ch]!;
      const dst = out[ch]!;
      for (let k = 0; k < winSize; k++) {
        re[k] = (src[i0 + k] ?? 0) * window[k]!;
        im[k] = 0;
      }
      fft(re, im, false);
      for (let k = 0; k < winSize; k++) {
        const mag = Math.hypot(re[k]!, im[k]!);
        const ph = Math.random() * 2 * Math.PI;
        re[k] = mag * Math.cos(ph);
        im[k] = mag * Math.sin(ph);
      }
      fft(re, im, true);
      for (let k = 0; k < winSize; k++) {
        const o = outStart + k;
        if (o < outLen) dst[o] = dst[o]! + re[k]! * norm * window[k]!;
      }
    }
    if ((step & 15) === 0) {
      onProgress?.(Math.min(1, step / numSteps));
      await yieldToHost();
    }
  }

  normalise(out);
  onProgress?.(1);
  return out;
}

/**
 * Granular resynthesis: re-texture a sample as a cloud of short, overlapping, windowed
 * grains. Decoupling the output hop from the input hop gives time-stretch; resampling
 * each grain gives independent pitch-shift; position jitter blurs it into a texture.
 * Pure (Float32Array in/out) — headless-testable.
 */
export async function granular(
  channels: Float32Array[],
  sampleRate: number,
  opts: GranularOpts,
  onProgress?: Progress,
): Promise<Float32Array[]> {
  const stretch = Math.max(0.1, opts.stretch);
  const grain = Math.max(64, Math.round((opts.grainMs * sampleRate) / 1000));
  const jitter = Math.max(0, (opts.jitterMs * sampleRate) / 1000);
  const ratio = Math.pow(2, opts.pitch / 12);
  const outHop = grain >> 1; // 50% overlap
  const inHop = outHop / stretch;
  const inLen = channels[0]?.length ?? 0;
  const outLen = Math.floor(inLen * stretch) + grain;

  const window = new Float32Array(grain);
  for (let i = 0; i < grain; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (grain - 1));

  const out = channels.map(() => new Float32Array(outLen));
  const numSteps = Math.max(1, Math.floor(inLen / inHop));

  let step = 0;
  for (
    let inPos = 0, outPos = 0;
    outPos + grain < outLen && inPos < inLen;
    inPos += inHop, outPos += outHop, step++
  ) {
    const base = inPos + (Math.random() * 2 - 1) * jitter;
    for (let ch = 0; ch < channels.length; ch++) {
      const src = channels[ch]!;
      const dst = out[ch]!;
      for (let k = 0; k < grain; k++) {
        const sp = base + k * ratio;
        const idx = Math.floor(sp);
        if (idx < 0 || idx + 1 >= inLen) continue;
        const frac = sp - idx;
        const s = (src[idx]! * (1 - frac) + src[idx + 1]! * frac) * window[k]!;
        const o = outPos + k;
        dst[o] = dst[o]! + s;
      }
    }
    if ((step & 31) === 0) {
      onProgress?.(Math.min(1, step / numSteps));
      await yieldToHost();
    }
  }

  normalise(out, 0.9);
  onProgress?.(1);
  return out;
}
