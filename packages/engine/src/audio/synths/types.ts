import type * as Tone from 'tone';
import type { SignalRegistry } from '../../core/registry';
import type { Scalar } from '../../patch/schema';

/**
 * A synth MODULE: a self-contained voice + its modulatable ports. Scenes select a
 * module by id, so scenes can be structurally different, not just parameter
 * variations (brief §5). Phase 1 ships two: driftPad (voices) and subBass (bass).
 */
export interface SynthModule {
  /** Output to connect into a bus. */
  readonly output: Tone.ToneAudioNode;
  /** Trigger a note: MIDI pitch, duration (s), transport time (s), velocity 0..1. */
  trigger(midi: number, durationSec: number, time: number, velocity: number): void;
  /** Register this module's input/output ports under `nodeId` against the registry. */
  registerPorts(nodeId: string, registry: SignalRegistry, params: Record<string, Scalar>): void;
  dispose(): void;
}

export type SynthFactory = () => SynthModule;

/** Read a scalar param as a number with a fallback. */
export function numParam(params: Record<string, Scalar>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' ? v : fallback;
}
