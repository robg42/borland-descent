/**
 * Pure audio-feature maths (VISUAL-REBUILD V2). Everything here is plain
 * Float32Array-in/number-out so the CI gate can prove it headlessly; the
 * Tone-coupled Analysers class feeds it real FFT frames at control rate and
 * exposes the results as ports (audio.band1..N, audio.flux, audio.onset).
 */

/**
 * Log-spaced band edges over FFT bin indices: N+1 monotonically increasing
 * integers from `loBin` to `hiBin` (geometric spacing, each band at least one
 * bin wide). Low bands stay narrow (bass detail), high bands widen — the
 * perceptual layout every audio-reactive mapping wants.
 */
export function logBandEdges(bands: number, loBin: number, hiBin: number): number[] {
  const edges: number[] = [];
  const lnLo = Math.log(Math.max(1, loBin));
  const lnHi = Math.log(Math.max(loBin + bands, hiBin));
  for (let i = 0; i <= bands; i++) {
    const e = Math.round(Math.exp(lnLo + ((lnHi - lnLo) * i) / bands));
    edges.push(Math.max(e, (edges[i - 1] ?? loBin - 1) + 1)); // strictly increasing
  }
  return edges;
}

/** Mean linear magnitude of one band [edges[i], edges[i+1]), lifted by sqrt for a
 *  perceptual 0..1 feel. `gain` trades sensitivity against headroom. */
export function bandEnergy(mags: Float32Array, lo: number, hi: number, gain = 4): number {
  const start = Math.max(0, lo);
  const end = Math.min(mags.length, hi);
  if (end <= start) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) sum += mags[i]!;
  const mean = sum / (end - start);
  return Math.min(1, Math.sqrt(mean * gain));
}

/** Spectral flux: the positive half-wave rectified frame-to-frame magnitude
 *  difference, normalised per bin and scaled into a usable 0..1. The classic
 *  onset detection function — silence→sound and timbre changes spike it. */
export function spectralFlux(mags: Float32Array, prev: Float32Array, gain = 8): number {
  const n = Math.min(mags.length, prev.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = mags[i]! - prev[i]!;
    if (d > 0) sum += d;
  }
  return Math.min(1, (sum / n) * gain);
}

/** Asymmetric envelope follower step: fast attack, slow release (seconds). */
export function envelopeStep(
  env: number,
  value: number,
  dt: number,
  attackSec: number,
  releaseSec: number,
): number {
  const tc = value > env ? attackSec : releaseSec;
  if (tc <= 0 || dt <= 0) return value;
  return env + (value - env) * (1 - Math.exp(-dt / tc));
}

export interface OnsetState {
  /** Ring buffer of recent flux values (the adaptive threshold's memory). */
  history: Float32Array;
  index: number;
  filled: number;
  /** Running sum of the ring buffer, so the adaptive mean is O(1) per frame. */
  sum: number;
  /** Seconds since the last fired onset (refractory timer). */
  sinceLast: number;
}

export function createOnsetState(historyLength = 32): OnsetState {
  return { history: new Float32Array(historyLength), index: 0, filled: 0, sum: 0, sinceLast: 1 };
}

/**
 * Adaptive onset detector step: fires when the flux exceeds the recent mean by
 * a multiplicative + additive margin, with a refractory period so one musical
 * event reads as one trigger. Mutates `state`; returns 1 on the onset frame,
 * else 0 — exactly the shape a `trigger`-kind port wants.
 */
export function onsetStep(
  state: OnsetState,
  flux: number,
  dt: number,
  opts: { ratio?: number; floor?: number; refractorySec?: number } = {},
): number {
  const ratio = opts.ratio ?? 1.6;
  const floor = opts.floor ?? 0.015;
  const refractory = opts.refractorySec ?? 0.12;

  const mean = state.sum / Math.max(1, state.filled);

  // Maintain the running sum against the STORED (float32-rounded) values so it
  // stays exactly the sum of the ring buffer's contents.
  state.sum -= state.history[state.index]!;
  state.history[state.index] = flux;
  state.sum += state.history[state.index]!;
  state.index = (state.index + 1) % state.history.length;
  state.filled = Math.min(state.filled + 1, state.history.length);
  state.sinceLast += dt;

  if (state.sinceLast >= refractory && flux > mean * ratio + floor) {
    state.sinceLast = 0;
    return 1;
  }
  return 0;
}

/** dB (≈[-100, 0]) → linear magnitude, with silence flushed to 0. */
export function dbToLinear(db: number): number {
  if (!Number.isFinite(db) || db <= -100) return 0;
  return Math.pow(10, db / 20);
}
