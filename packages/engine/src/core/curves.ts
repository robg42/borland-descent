import type { CurveKind } from '../patch/types';

/** Pure math used by the modulation matrix. */

export function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Per-frame coefficient for exponential smoothing toward a target, given a time
 * constant in ms and the frame delta in seconds. 0 → no movement, 1 → instant.
 */
export function smoothingCoeff(ms: number, dt: number): number {
  if (ms <= 0 || dt <= 0) return 1;
  return 1 - Math.exp(-dt / (ms / 1000));
}

/**
 * Shape a source value before scaling. Sources are roughly in [-1,1] (bipolar) or
 * [0,1] (unipolar); exp/log/sCurve preserve sign so they work for both, while
 * `invert` is a unipolar mirror (1−x), clamped to [0,1] so a bipolar source cannot
 * push it out of range.
 */
export function applyCurve(x: number, curve: CurveKind): number {
  switch (curve) {
    case 'linear':
      return x;
    case 'invert':
      return 1 - clamp(x, 0, 1); // unipolar mirror, bounded to [0,1]
    case 'exp':
      return Math.sign(x) * x * x; // emphasise the extremes
    case 'log':
      return Math.sign(x) * Math.sqrt(Math.abs(x)); // emphasise the low end
    case 'sCurve': {
      const a = Math.abs(x);
      return Math.sign(x) * a * a * (3 - 2 * a); // smoothstep, sign-preserving
    }
    default:
      return x;
  }
}
