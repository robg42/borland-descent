import { describe, expect, it } from 'vitest';
import { generateHallIR } from '../src/audio/effects/hallIR';

describe('generateHallIR', () => {
  it('is deterministic: same params produce the identical room', () => {
    const a = generateHallIR(48000, 2.0, 0.02);
    const b = generateHallIR(48000, 2.0, 0.02);
    expect(a).toHaveLength(2);
    expect(a[0]!.length).toBe(b[0]!.length);
    for (let ch = 0; ch < 2; ch++) {
      for (let i = 0; i < a[ch]!.length; i++) {
        expect(a[ch]![i]).toBe(b[ch]![i]);
      }
    }
  });

  it('decorrelates the channels and honours the requested length', () => {
    const sr = 48000;
    const ir = generateHallIR(sr, 1.5, 0.02);
    expect(ir[0]!.length).toBe(Math.floor(0.02 * sr) + Math.floor(1.5 * sr));
    let diff = 0;
    for (let i = 0; i < ir[0]!.length; i++) diff = Math.max(diff, Math.abs(ir[0]![i]! - ir[1]![i]!));
    expect(diff).toBeGreaterThan(0); // stereo, not a doubled mono tail
    let peak = 0;
    for (const ch of ir) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]!));
    expect(peak).toBeLessThanOrEqual(0.5 + 1e-6); // normalised headroom
  });
});
