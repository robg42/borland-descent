import type * as Tone from 'tone';
import { makePortRef, type PortKind } from '../../core/ports';
import { clamp } from '../../core/curves';
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
  /** Sampler voices: bind a user sample (by id) from the runtime SampleStore. Optional —
   *  the synthesis voices don't implement it. */
  bindSample?(sampleId: string): void;
  dispose(): void;
}

/** Construction options shared by synth modules (polyphonic modules honour the cap). */
export interface SynthOptions {
  /** Voice cap for polyphonic modules; ignored by monophonic ones. */
  maxPolyphony?: number;
}

export type SynthFactory = (opts?: SynthOptions) => SynthModule;

/** Read a scalar param as a number with a fallback. */
export function numParam(params: Record<string, Scalar>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' ? v : fallback;
}

/** A voice's amplitude-envelope defaults (must match its constructed envelope). */
export interface AdsrDefaults {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

/**
 * Register the amplitude envelope (attack / decay / sustain / release) as editable and
 * automatable ports for a voice. `setEnv` applies a partial envelope to the underlying
 * synth — each voice supplies it (PolySynth → `poly.set({ envelope })`; DuoSynth → set
 * both voices), so this stays synth-shape-agnostic. Defaults must match the constructed
 * envelope so the registered base reflects reality (and re-applying it is a no-op unless
 * the patch overrides it).
 */
export function registerAdsrPorts(
  nodeId: string,
  registry: SignalRegistry,
  params: Record<string, Scalar>,
  defaults: AdsrDefaults,
  setEnv: (env: Partial<AdsrDefaults>) => void,
): void {
  const specs: Array<[keyof AdsrDefaults, number, PortKind]> = [
    ['attack', 8, 'scalar'],
    ['decay', 8, 'scalar'],
    ['sustain', 1, 'unipolar'],
    ['release', 12, 'scalar'],
  ];
  for (const [key, max, kind] of specs) {
    const base = numParam(params, key, defaults[key]);
    setEnv({ [key]: base });
    registry.addInput(makePortRef(nodeId, key), {
      kind,
      base,
      min: 0,
      max,
      write: (v) => setEnv({ [key]: clamp(v, 0, max) }),
    });
  }
}
