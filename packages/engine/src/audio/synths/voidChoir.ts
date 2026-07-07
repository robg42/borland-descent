import * as Tone from 'tone';
import { smoothWrite } from '../smoothWrite';
import { clamp } from '../../core/curves';
import { makePortRef } from '../../core/ports';
import type { SignalRegistry } from '../../core/registry';
import type { Scalar } from '../../patch/schema';
import { numParam, registerAdsrPorts, type SynthModule, type SynthOptions } from './types';

const CUTOFF_MIN = 60;
const CUTOFF_MAX = 9000;

const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch'] as const;

/**
 * voidChoir — a dark, FM-based polyphonic voice for the deeper scene. Structurally
 * different from driftPad (FM synthesis with a modulation envelope, not a filtered
 * saw), proving scenes select different synth MODULES, not just parameters. Exposes
 * the same core ports (cutoff, level) so the global matrix routes carry across.
 */
export function createVoidChoir(opts?: SynthOptions): SynthModule {
  const poly = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 1.41,
    modulationIndex: 7,
    oscillator: { type: 'sine' },
    envelope: { attack: 2.2, decay: 1.2, sustain: 0.75, release: 4.5 },
    modulation: { type: 'triangle' },
    modulationEnvelope: { attack: 3, decay: 1.5, sustain: 0.5, release: 3.5 },
  });
  poly.maxPolyphony = Math.max(1, Math.round(opts?.maxPolyphony ?? 10));

  const filter = new Tone.Filter({ frequency: 800, type: 'lowpass', Q: 1.1 });
  const out = new Tone.Gain(0.7);
  poly.connect(filter);
  filter.connect(out);

  return {
    output: out,
    trigger(midi, durationSec, time, velocity) {
      poly.triggerAttackRelease(midiToFreq(midi), durationSec, time, clamp(velocity, 0, 1));
    },
    registerPorts(nodeId, registry: SignalRegistry, params: Record<string, Scalar>) {
      const baseCutoff = clamp(numParam(params, 'cutoff', 800), CUTOFF_MIN, CUTOFF_MAX);
      filter.frequency.value = baseCutoff;
      registry.addInput(makePortRef(nodeId, 'cutoff'), {
        kind: 'scalar',
        base: baseCutoff,
        min: CUTOFF_MIN,
        max: CUTOFF_MAX,
        write: (v) => {
          smoothWrite(filter.frequency, clamp(v, CUTOFF_MIN, CUTOFF_MAX));
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
          smoothWrite(out.gain, clamp(v, 0, 1.5));
        },
        audioTarget: out.gain,
      });

      registerAdsrPorts(
        nodeId,
        registry,
        params,
        { attack: 2.2, decay: 1.2, sustain: 0.75, release: 4.5 },
        (env) => poly.set({ envelope: env }),
      );

      const baseHarmonicity = numParam(params, 'harmonicity', 1.41);
      poly.set({ harmonicity: baseHarmonicity });
      registry.addInput(makePortRef(nodeId, 'harmonicity'), {
        kind: 'scalar',
        base: baseHarmonicity,
        min: 0.25,
        max: 8,
        write: (v) => poly.set({ harmonicity: clamp(v, 0.25, 8) }),
      });
      const baseModIndex = numParam(params, 'modIndex', 7);
      poly.set({ modulationIndex: baseModIndex });
      registry.addInput(makePortRef(nodeId, 'modIndex'), {
        kind: 'scalar',
        base: baseModIndex,
        min: 0,
        max: 25,
        write: (v) => poly.set({ modulationIndex: clamp(v, 0, 25) }),
      });

      const baseFilterIdx = Math.round(clamp(numParam(params, 'filterType', 0), 0, FILTER_TYPES.length - 1));
      filter.type = FILTER_TYPES[baseFilterIdx] as BiquadFilterType;
      registry.addInput(makePortRef(nodeId, 'filterType'), {
        kind: 'option',
        base: baseFilterIdx,
        min: 0,
        max: FILTER_TYPES.length - 1,
        options: [...FILTER_TYPES],
        write: (v) => {
          const idx = Math.round(clamp(v, 0, FILTER_TYPES.length - 1));
          filter.type = FILTER_TYPES[idx] as BiquadFilterType;
        },
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
