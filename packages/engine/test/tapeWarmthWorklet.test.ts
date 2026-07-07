import { describe, expect, it } from 'vitest';
import workletSource from '../src/audio/effects/worklets/tapeWarmth.worklet.js?raw';

/**
 * Characterisation tests for the tape-warmth AudioWorklet's DSP. The processor is
 * plain JS (Vite bundles it verbatim), so nothing else type-checks or exercises it —
 * this executes it with the worklet globals stubbed and proves the per-sample loop
 * headlessly: finite bounded output, signal passes through, stereo decorrelation,
 * and the ever-present hiss floor. (The engine tsconfig has no Node ambient types,
 * hence `?raw` + Function rather than node:fs + node:vm.)
 */

const SR = 48000;
const N = 128;

interface WorkletProcessor {
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array | number[]>,
  ): boolean;
}

function loadProcessor(): WorkletProcessor {
  const registered: { cls?: new () => WorkletProcessor } = {};
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- executing our own
  // worklet source with its globals (sampleRate, registerProcessor) bound as params.
  const factory = new Function('sampleRate', 'AudioWorkletProcessor', 'registerProcessor', workletSource);
  factory(SR, class {}, (_name: string, cls: new () => WorkletProcessor) => {
    registered.cls = cls;
  });
  if (!registered.cls) throw new Error('worklet did not call registerProcessor');
  return new registered.cls();
}

const DEFAULTS = {
  drive: [1.4],
  flutterDepth: [0.15],
  flutterRate: [4],
  hfCutoff: [7000],
  hiss: [0.0015],
  crush: [12],
};

function sineBlock(phase: { n: number }, freq = 220, amp = 0.4): [Float32Array, Float32Array] {
  const l = new Float32Array(N);
  const r = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const v = amp * Math.sin((2 * Math.PI * freq * phase.n++) / SR);
    l[i] = v;
    r[i] = v;
  }
  return [l, r];
}

function run(
  p: WorkletProcessor,
  blocks: number,
  makeInput: () => [Float32Array, Float32Array],
  params = DEFAULTS,
): Float32Array[][] {
  const outs: Float32Array[][] = [];
  for (let b = 0; b < blocks; b++) {
    const out = [new Float32Array(N), new Float32Array(N)];
    expect(p.process([makeInput()], [out], params)).toBe(true);
    outs.push(out);
  }
  return outs;
}

describe('tapeWarmth worklet DSP', () => {
  it('passes a sine through finite, bounded, and non-silent', () => {
    const p = loadProcessor();
    const phase = { n: 0 };
    const outs = run(p, 200, () => sineBlock(phase)); // ~0.53 s
    let peak = 0;
    for (const out of outs.slice(50)) {
      for (const ch of out) {
        for (let i = 0; i < N; i++) {
          expect(Number.isFinite(ch[i])).toBe(true);
          peak = Math.max(peak, Math.abs(ch[i]!));
        }
      }
    }
    expect(peak).toBeGreaterThan(0.05); // signal made it through the tape
    expect(peak).toBeLessThan(1.5); // saturation keeps it sane
  });

  it('decorrelates the channels (true stereo wow & flutter)', () => {
    const p = loadProcessor();
    const phase = { n: 0 };
    const outs = run(p, 200, () => sineBlock(phase));
    let maxLrDiff = 0;
    for (const out of outs.slice(100)) {
      for (let i = 0; i < N; i++) {
        maxLrDiff = Math.max(maxLrDiff, Math.abs(out[0]![i]! - out[1]![i]!));
      }
    }
    // identical input, but the decorrelated delay modulation must split L/R
    expect(maxLrDiff).toBeGreaterThan(1e-4);
  });

  it('keeps a hiss floor running on silence, scaled by the hiss param', () => {
    const p = loadProcessor();
    const silent = (): [Float32Array, Float32Array] => [new Float32Array(N), new Float32Array(N)];
    const params = { ...DEFAULTS, hiss: [0.01] };
    const outs = run(p, 400, silent, params);
    let energy = 0;
    let count = 0;
    for (const out of outs.slice(200)) {
      // skip the param-smoothing ramp
      for (let i = 0; i < N; i++) {
        energy += out[0]![i]! * out[0]![i]!;
        count++;
      }
    }
    const rms = Math.sqrt(energy / count);
    expect(rms).toBeGreaterThan(1e-3); // the reel is audibly running…
    expect(rms).toBeLessThan(0.02); // …but stays a floor, not a source
  });

  it('flushes silence in to silence out when hiss is ramped to zero', () => {
    const p = loadProcessor();
    const silent = (): [Float32Array, Float32Array] => [new Float32Array(N), new Float32Array(N)];
    const params = { ...DEFAULTS, hiss: [0] };
    const outs = run(p, 800, silent, params); // ≫ the 50 ms smoothing tc
    const last = outs[outs.length - 1]!;
    for (const ch of last) {
      for (let i = 0; i < N; i++) expect(Math.abs(ch[i]!)).toBeLessThan(1e-6);
    }
  });
});
