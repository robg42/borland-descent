import { describe, expect, it } from 'vitest';
import { Rng, hashStringToSeed, mulberry32 } from '../src/core/rng';

const take = (next: () => number, n: number): number[] =>
  Array.from({ length: n }, () => next());

describe('seeded RNG', () => {
  it('is deterministic for the same numeric seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    expect(take(() => a.float(), 16)).toEqual(take(() => b.float(), 16));
  });

  it('diverges across seeds', () => {
    const a = take(() => new Rng(1).float(), 1); // single draw is fine to compare
    const b = take(() => new Rng(2).float(), 1);
    expect(a).not.toEqual(b);
  });

  it('produces finite values in [0, 1)', () => {
    const r = new Rng('borland');
    for (let i = 0; i < 2000; i++) {
      const v = r.float();
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('reproduces from a string seed', () => {
    const a = new Rng('surface');
    const b = new Rng('surface');
    expect(take(() => a.float(), 8)).toEqual(take(() => b.float(), 8));
  });

  it('hashes strings deterministically and distinctly', () => {
    expect(hashStringToSeed('x')).toBe(hashStringToSeed('x'));
    expect(hashStringToSeed('x')).not.toBe(hashStringToSeed('y'));
  });

  it('range / int / pick stay within bounds', () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const f = r.range(-3, 3);
      expect(f).toBeGreaterThanOrEqual(-3);
      expect(f).toBeLessThan(3);
      const n = r.int(2, 5);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
    }
    expect(r.pick([])).toBeUndefined();
    expect(['a', 'b', 'c']).toContain(r.pick(['a', 'b', 'c']));
  });

  it('mulberry32 matches a known reference value for a fixed seed', () => {
    const next = mulberry32(0);
    // first draw of mulberry32(0) is a stable constant — guards against regressions
    expect(next()).toBeCloseTo(0.26642920868471265, 12);
  });
});
