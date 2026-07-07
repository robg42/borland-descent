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

// Single-slot memo: within one frame the engine reads the macros for the SAME
// (arc, position) up to ~10 times — six arc source ports, both scenes' applyArc,
// and the host darkness. Nothing mutates a returned macros object (or a live
// dna.arc), so all those reads can share one allocation.
let memoArc: ArcKeyframe[] | null = null;
let memoPos = NaN;
let memoOut: ArcMacros | null = null;

/**
 * Interpolate the arc macros at a position in [0,1] from the keyframes (assumed
 * sorted by position). Positions outside the keyframe span clamp to the ends.
 * The returned object is shared with subsequent same-argument calls — read-only.
 */
export function macrosAt(arc: ArcKeyframe[], position: number): ArcMacros {
  const p = clamp(position, 0, 1);
  if (memoOut !== null && memoArc === arc && memoPos === p) return memoOut;
  const out = computeMacrosAt(arc, p);
  memoArc = arc;
  memoPos = p;
  memoOut = out;
  return out;
}

function computeMacrosAt(arc: ArcKeyframe[], p: number): ArcMacros {
  if (arc.length === 0) return { ...ZERO };
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
