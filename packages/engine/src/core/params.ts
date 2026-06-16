import * as Tone from 'tone';

/**
 * The shape smoothWrite needs — satisfied by a native AudioParam, a Tone.Param and
 * Tone's frequency-like Signals (which type `value` as a unit union — Hertz, note
 * names — though the runtime value is numeric).
 */
export interface SmoothableParam {
  value: number | string;
  setTargetAtTime(value: number, startTime: number, timeConstant: number): unknown;
}

/**
 * Dezippered control-rate write (REVIEW M1): a short exponential glide via
 * setTargetAtTime instead of an instantaneous `.value` step, so per-frame
 * writes (matrix targets, crossfade gains, worklet params) land smoothly even
 * when frames drop. The shared helper every registry `write()` that targets an
 * AudioParam should use. Negligible changes are skipped so the automation
 * timeline doesn't accumulate redundant events.
 */
export function smoothWrite(param: SmoothableParam, value: number, timeConstant = 0.015): void {
  const current = typeof param.value === 'number' ? param.value : Number(param.value);
  if (Math.abs(current - value) < 1e-6) return;
  param.setTargetAtTime(value, Tone.getContext().currentTime, timeConstant);
}
