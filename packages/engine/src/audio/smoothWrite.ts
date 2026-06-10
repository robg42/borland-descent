import * as Tone from 'tone';

/**
 * Ramp a Tone AudioParam smoothly to `value` using a first-order lag (time constant
 * `tc` seconds ≈ 63 % settled). Eliminates the zipper noise you get from instant
 * `param.value = v` writes while remaining cheap (one Web Audio scheduling call).
 *
 * Use this everywhere an input port's `write()` touches an AudioParam that is part
 * of a live, audible signal path. Non-param writes (poly.set, string enum, etc.)
 * should keep their own smoothing (the matrix's per-frame lerp).
 */
export function smoothWrite(
  param: { rampTo(value: number, rampTime: Tone.Unit.Time, startTime?: Tone.Unit.Time): unknown },
  value: number,
  rampSec = 0.015,
): void {
  param.rampTo(value, rampSec, Tone.now());
}
