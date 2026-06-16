import type * as Tone from 'tone';
import { clamp } from '../../core/curves';
import { midiToFreq } from '../../core/music';
import { makePortRef, type PortKind } from '../../core/ports';
import { smoothWrite, type SmoothableParam } from '../../core/params';
import type { SignalRegistry } from '../../core/registry';
import type { Scalar } from '../../patch/schema';
import { numParam, registerAdsrPorts, type AdsrDefaults } from './types';

/**
 * Shared port plumbing for synth modules. Every voice used to carry ~80 lines of
 * identical addInput boilerplate (cutoff/level/detune/ADSR + bespoke extras); these
 * helpers keep the port names, kinds and ranges IDENTICAL while collapsing each
 * synth file to its actual identity — the oscillator/filter architecture.
 *
 * All AudioParam-backed writes go through smoothWrite (core/params): a short
 * setTargetAtTime glide instead of a stepped `.value =`, so fast automation from
 * the matrix or a studio slider never zippers.
 */

/** An AudioParam-ish target that is both smoothable and audio-rate connectable. */
export type PortParam = SmoothableParam & Tone.InputNode;

/** Register a numeric port writing a (de-zippered) AudioParam. */
export function addParamPort(
  registry: SignalRegistry,
  nodeId: string,
  name: string,
  params: Record<string, Scalar>,
  spec: { kind: PortKind; fallback: number; min: number; max: number; param: PortParam },
): void {
  const base = clamp(numParam(params, name, spec.fallback), spec.min, spec.max);
  spec.param.value = base; // base lands instantly (pre-audio init), edits glide
  registry.addInput(makePortRef(nodeId, name), {
    kind: spec.kind,
    base,
    min: spec.min,
    max: spec.max,
    write: (v) => smoothWrite(spec.param, clamp(v, spec.min, spec.max)),
    audioTarget: spec.param,
  });
}

/** Register a numeric port applied via a setter (poly.set etc. — not an AudioParam). */
export function addSetterPort(
  registry: SignalRegistry,
  nodeId: string,
  name: string,
  params: Record<string, Scalar>,
  spec: { kind: PortKind; fallback: number; min: number; max: number; apply: (v: number) => void },
): void {
  const base = clamp(numParam(params, name, spec.fallback), spec.min, spec.max);
  spec.apply(base);
  registry.addInput(makePortRef(nodeId, name), {
    kind: spec.kind,
    base,
    min: spec.min,
    max: spec.max,
    write: (v) => spec.apply(clamp(v, spec.min, spec.max)),
  });
}

/** The standard voice surface: cutoff / level / detune / ADSR, exactly as every
 *  scene synth has always exposed them. Pass only the pieces a voice has. */
export function registerVoicePorts(
  registry: SignalRegistry,
  nodeId: string,
  params: Record<string, Scalar>,
  spec: {
    cutoff?: { param: PortParam; min: number; max: number; fallback: number };
    level?: { param: PortParam; fallback: number };
    detune?: { fallback: number; apply: (v: number) => void };
    adsr?: { defaults: AdsrDefaults; setEnv: (env: Partial<AdsrDefaults>) => void };
  },
): void {
  if (spec.cutoff) {
    addParamPort(registry, nodeId, 'cutoff', params, {
      kind: 'scalar',
      fallback: spec.cutoff.fallback,
      min: spec.cutoff.min,
      max: spec.cutoff.max,
      param: spec.cutoff.param,
    });
  }
  if (spec.level) {
    addParamPort(registry, nodeId, 'level', params, {
      kind: 'unipolar',
      fallback: spec.level.fallback,
      min: 0,
      max: 1.5,
      param: spec.level.param,
    });
  }
  if (spec.detune) {
    // Declared bounds (±1200 cents) — previously this port had none, which also left
    // the studio slider on its 0..1 fallback range, i.e. unusable.
    addSetterPort(registry, nodeId, 'detune', params, {
      kind: 'bipolar',
      fallback: spec.detune.fallback,
      min: -1200,
      max: 1200,
      apply: spec.detune.apply,
    });
  }
  if (spec.adsr) {
    registerAdsrPorts(nodeId, registry, params, spec.adsr.defaults, spec.adsr.setEnv);
  }
}

/** Standard note trigger: MIDI → Hz on a poly synth, velocity clamped. */
export function triggerHz(poly: {
  triggerAttackRelease(freq: number, dur: number, time: number, vel: number): unknown;
}): (midi: number, durationSec: number, time: number, velocity: number) => void {
  return (midi, durationSec, time, velocity) =>
    void poly.triggerAttackRelease(midiToFreq(midi), durationSec, time, clamp(velocity, 0, 1));
}

/** Dispose a chain of nodes in order. */
export function disposeAll(...nodes: Array<{ dispose(): void }>): () => void {
  return () => {
    for (const n of nodes) n.dispose();
  };
}
