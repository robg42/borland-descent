import { describe, expect, it } from 'vitest';
import { paulStretch, granular } from '../src/audio/resynthesis/transforms';
import { fft } from '../src/audio/resynthesis/fft';
import { encodeWav } from '../src/audio/resynthesis/wav';

/**
 * The resynthesis DSP is pure (Float32Array in/out), so it is exercised headlessly here —
 * the CI verification that the algorithms produce finite, in-range output of the expected
 * length (the audible character is for the ear, but "no NaNs / right length / no clip" is
 * provable without a browser).
 */
function sine(n: number, sr: number, freq: number): Float32Array {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.sin((2 * Math.PI * freq * i) / sr) * 0.5;
  return a;
}
const allFinite = (a: Float32Array): boolean => a.every((v) => Number.isFinite(v));
const peakOf = (a: Float32Array): number => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe('resynthesis — PaulStretch', () => {
  it('stretches longer, stays finite and within range', async () => {
    const sr = 8000;
    const input = [sine(4000, sr, 220)]; // 0.5 s
    const out = await paulStretch(input, sr, { stretch: 4, windowSec: 0.05 });
    expect(out).toHaveLength(1);
    expect(out[0]!.length).toBeGreaterThan(input[0]!.length * 3);
    expect(allFinite(out[0]!)).toBe(true);
    const peak = peakOf(out[0]!);
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(1.0001);
  });

  it('preserves stereo channel count', async () => {
    const sr = 8000;
    const out = await paulStretch([sine(2048, sr, 200), sine(2048, sr, 200)], sr, {
      stretch: 2,
      windowSec: 0.03,
    });
    expect(out).toHaveLength(2);
  });
});

describe('resynthesis — granular', () => {
  it('time-stretches, stays finite', async () => {
    const sr = 8000;
    const input = [sine(4000, sr, 330)];
    const out = await granular(input, sr, { stretch: 2, grainMs: 40, jitterMs: 5, pitch: 0 });
    expect(out[0]!.length).toBeGreaterThan(input[0]!.length * 1.5);
    expect(allFinite(out[0]!)).toBe(true);
  });
});

describe('resynthesis — FFT round-trip & WAV', () => {
  it('FFT then IFFT (÷N) reconstructs the signal', () => {
    const n = 16;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 2 * i) / n);
    const orig = Float32Array.from(re);
    fft(re, im, false);
    fft(re, im, true);
    for (let i = 0; i < n; i++) expect(re[i]! / n).toBeCloseTo(orig[i]!, 5);
  });

  it('encodeWav emits a valid RIFF/WAVE header of the right size', () => {
    const bytes = encodeWav([new Float32Array([0, 0.5, -0.5, 1, -1])], 44100);
    const view = new DataView(bytes);
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe('RIFF');
    expect(bytes.byteLength).toBe(44 + 5 * 2); // header + 5 mono 16-bit frames
  });
});
