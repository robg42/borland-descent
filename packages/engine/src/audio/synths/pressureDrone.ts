import * as Tone from 'tone';
import { clamp } from '../../core/curves';
import { makePortRef } from '../../core/ports';
import type { SignalRegistry } from '../../core/registry';
import type { Scalar } from '../../patch/schema';
import { numParam, registerAdsrPorts, type SynthModule, type SynthOptions } from './types';

const CUTOFF_MIN = 80;
const CUTOFF_MAX = 6000;

/**
 * pressureDrone — the midnight zone, aphotic and heavy. Built on MonoSynth, whose own
 * filter envelope sweeps slowly like building pressure; a pulse oscillator gives it a
 * hollow, pressing body. The external `cutoff` lowpass is the shared modulatable port
 * (the internal filter envelope supplies the motion). A different ARCHITECTURE again.
 */
export function createPressureDrone(opts?: SynthOptions): SynthModule {
  const poly = new Tone.PolySynth(Tone.MonoSynth, {
    oscillator: { type: 'pulse', width: 0.3 },
    envelope: { attack: 1.4, decay: 1.2, sustain: 0.65, release: 4.0 },
    filterEnvelope: {
      attack: 2.5,
      decay: 1.5,
      sustain: 0.4,
      release: 3.5,
      baseFrequency: 120,
      octaves: 3.2,
    },
    filter: { type: 'lowpass', Q: 2, rolloff: -24 },
  });
  poly.maxPolyphony = Math.max(1, Math.round(opts?.maxPolyphony ?? 7));

  const filter = new Tone.Filter({ frequency: 900, type: 'lowpass', Q: 1.2 });
  const out = new Tone.Gain(0.7);
  poly.connect(filter);
  filter.connect(out);

  return {
    output: out,
    trigger(midi, durationSec, time, velocity) {
      poly.triggerAttackRelease(midiToFreq(midi), durationSec, time, clamp(velocity, 0, 1));
    },
    registerPorts(nodeId, registry: SignalRegistry, params: Record<string, Scalar>) {
      const baseCutoff = clamp(numParam(params, 'cutoff', 900), CUTOFF_MIN, CUTOFF_MAX);
      filter.frequency.value = baseCutoff;
      registry.addInput(makePortRef(nodeId, 'cutoff'), {
        kind: 'scalar',
        base: baseCutoff,
        min: CUTOFF_MIN,
        max: CUTOFF_MAX,
        write: (v) => {
          filter.frequency.value = clamp(v, CUTOFF_MIN, CUTOFF_MAX);
        },
        audioTarget: filter.frequency,
      });

      const baseLevel = numParam(params, 'level', 0.7);
      out.gain.value = baseLevel;
      registry.addInput(makePortRef(nodeId, 'level'), {
        kind: 'unipolar',
        base: baseLevel,
        min: 0,
        max: 1.5,
        write: (v) => {
          out.gain.value = clamp(v, 0, 1.5);
        },
        audioTarget: out.gain,
      });

      registerAdsrPorts(
        nodeId,
        registry,
        params,
        { attack: 1.4, decay: 1.2, sustain: 0.65, release: 4.0 },
        (env) => poly.set({ envelope: env }),
      );

      const baseFilterOct = numParam(params, 'filterOctaves', 3.2);
      poly.set({ filterEnvelope: { octaves: baseFilterOct } });
      registry.addInput(makePortRef(nodeId, 'filterOctaves'), {
        kind: 'scalar',
        base: baseFilterOct,
        min: 0,
        max: 6,
        write: (v) => poly.set({ filterEnvelope: { octaves: clamp(v, 0, 6) } }),
      });
      const baseWidth = numParam(params, 'width', 0.3);
      poly.set({ oscillator: { type: 'pulse', width: baseWidth } });
      registry.addInput(makePortRef(nodeId, 'width'), {
        kind: 'unipolar',
        base: baseWidth,
        min: 0,
        max: 1,
        write: (v) => poly.set({ oscillator: { type: 'pulse', width: clamp(v, 0, 1) } }),
      });
    },
    dispose() {
      poly.dispose();
      filter.dispose();
      out.dispose();
    },
  };
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
