import type { ArcKeyframe, ArcMacros } from '../patch/types';
import { clamp } from './curves';

const KEYS = [
  'darkness',
  'rhythmicWeight',
  'reverbSize',
  'filterPosition',
  'dissonance',
  'density',
] as const;

const ZERO: ArcMacros = {
  darkness: 0,
  rhythmicWeight: 0,
  reverbSize: 0,
  filterPosition: 0,
  dissonance: 0,
  density: 0,
};

/**
 * Interpolate the arc macros at a position in [0,1] from the keyframes (assumed
 * sorted by position). Positions outside the keyframe span clamp to the ends.
 */
export function macrosAt(arc: ArcKeyframe[], position: number): ArcMacros {
  if (arc.length === 0) return { ...ZERO };
  const p = clamp(position, 0, 1);
  const first = arc[0]!;
  const last = arc[arc.length - 1]!;
  if (p <= first.position) return { ...first.macros };
  if (p >= last.position) return { ...last.macros };

  let lo = first;
  let hi = last;
  for (let i = 0; i < arc.length - 1; i++) {
    const a = arc[i]!;
    const b = arc[i + 1]!;
    if (p >= a.position && p <= b.position) {
      lo = a;
      hi = b;
      break;
    }
  }
  const span = hi.position - lo.position;
  const t = span <= 0 ? 0 : (p - lo.position) / span;
  const out = { ...ZERO };
  for (const k of KEYS) out[k] = lerp(lo.macros[k], hi.macros[k], t);
  return out;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
