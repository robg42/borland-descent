/**
 * Seeded deterministic RNG (mulberry32) + djb2 string hashing, so a given
 * meta.seed reproduces the same compositional decisions. This fixes *decisions*,
 * not bit-identical audio (brief §8 #4): real-time audio/analyser values still
 * vary run to run; the seed pins note/rhythm/parameter choices.
 */

/** djb2 string → 32-bit unsigned seed. */
export function hashStringToSeed(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (Math.imul(hash, 33) ^ input.charCodeAt(i)) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32 PRNG → function returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private readonly next01: () => number;

  constructor(seed: number | string) {
    const numeric = typeof seed === 'string' ? hashStringToSeed(seed) : seed >>> 0;
    this.next01 = mulberry32(numeric);
  }

  /** Float in [0, 1). */
  float(): number {
    return this.next01();
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next01() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** Pick an element; undefined for an empty array. */
  pick<T>(items: readonly T[]): T | undefined {
    if (items.length === 0) return undefined;
    return items[Math.floor(this.next01() * items.length)];
  }

  /** True with probability p (0..1). */
  chance(p: number): boolean {
    return this.next01() < p;
  }
}

export function createRng(seed: number | string): Rng {
  return new Rng(seed);
}
