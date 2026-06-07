import type * as Tone from 'tone';
import type { PortKind, PortRef } from './ports';

/**
 * The bridge between abstract PortRefs ("nodeId.portName") and live engine objects.
 * When the engine instantiates the audio + visual graphs, each module registers its
 * signal OUTPUTS (measurements, gesture/arc values, LFOs) and modulatable INPUTS
 * (audio params, shader uniforms). The matrix then reads/writes through here.
 */

export interface SignalOutput {
  kind: PortKind;
  /** Control-rate read of the current value. */
  read: () => number;
  /** Native Tone node for audio-rate routing (LFO/envelope), if connectable. */
  audioNode?: Tone.ToneAudioNode;
}

export interface SignalInput {
  kind: PortKind;
  /** The unmodulated value from the patch param. */
  base: number;
  min?: number;
  max?: number;
  /** Control-rate write of the final (base + modulation) value. */
  write: (value: number) => void;
  /** Native Tone Param/Signal for audio-rate routing, if connectable. */
  audioTarget?: Tone.InputNode;
}

/** Lightweight descriptions for the studio UI (sliders + route dropdowns). */
export interface InputPortInfo {
  ref: string;
  kind: PortKind;
  base: number;
  min?: number;
  max?: number;
}
export interface OutputPortInfo {
  ref: string;
  kind: PortKind;
}

export class SignalRegistry {
  private readonly outputs = new Map<string, SignalOutput>();
  private readonly inputs = new Map<string, SignalInput>();

  addOutput(ref: PortRef, output: SignalOutput): void {
    this.outputs.set(ref, output);
  }
  addInput(ref: PortRef, input: SignalInput): void {
    this.inputs.set(ref, input);
  }
  getOutput(ref: string): SignalOutput | undefined {
    return this.outputs.get(ref);
  }
  getInput(ref: string): SignalInput | undefined {
    return this.inputs.get(ref);
  }
  hasOutput(ref: string): boolean {
    return this.outputs.has(ref);
  }
  hasInput(ref: string): boolean {
    return this.inputs.has(ref);
  }
  listInputs(): InputPortInfo[] {
    return [...this.inputs.entries()].map(([ref, i]) => ({
      ref,
      kind: i.kind,
      base: i.base,
      min: i.min,
      max: i.max,
    }));
  }
  listOutputs(): OutputPortInfo[] {
    return [...this.outputs.entries()].map(([ref, o]) => ({ ref, kind: o.kind }));
  }
  clear(): void {
    this.outputs.clear();
    this.inputs.clear();
  }
}
