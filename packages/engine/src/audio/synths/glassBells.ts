import * as Tone from 'tone';
import { smoothWrite } from '../smoothWrite';
import { clamp } from '../../core/curves';
import { makePortRef } from '../../core/ports';
import type { SignalRegistry } from '../../core/registry';
import type { Scalar } from '../../patch/schema';
import { numParam, registerAdsrPorts, type SynthModule, type SynthOptions } from './types';

const CUTOFF_MIN = 300;
const CUTOFF_MAX = 14000;

const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass'] as const;

/**
 * glassBells — the sunlit shallows: bright, struck-glass shimmer. FM synthesis with
 * an inharmonic harmonicity and a fast, percussive modulation envelope, so each note
 * rings like light on water. Structurally distinct from driftPad (filtered saw) and
 * voidChoir (dark, slow FM); exposes the same cutoff/level ports so the global matrix
 * routes carry across.
 */
export function createGlassBells(opts?: SynthOptions): SynthModule {
  const poly = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 3.01,
    modulationIndex: 5,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.006, decay: 1.4, sustain: 0.18, release: 2.8 },
    modulation: { type: 'square' },
    modulationEnvelope: { attack: 0.004, decay: 0.6, sustain: 0.1, release: 1.6 },
  });
  poly.maxPolyphony = Math.max(1, Math.round(opts?.maxPolyphony ?? 8));

  const filter = new Tone.Filter({ frequency: 3200, type: 'lowpass', Q: 0.8 });
  const out = new Tone.Gain(0.7);
  poly.connect(filter);
  filter.connect(out);

  return {
    output: out,
    trigger(midi, durationSec, time, velocity) {
      poly.triggerAttackRelease(midiToFreq(midi), durationSec, time, clamp(velocity, 0, 1));
    },
    registerPorts(nodeId, registry: SignalRegistry, params: Record<string, Scalar>) {
      const baseCutoff = clamp(numParam(params, 'cutoff', 3200), CUTOFF_MIN, CUTOFF_MAX);
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

      const baseDetune = numParam(params, 'detune', 0);
      poly.set({ detune: baseDetune });
      registry.addInput(makePortRef(nodeId, 'detune'), {
        kind: 'bipolar',
        base: baseDetune,
        write: (v) => poly.set({ detune: clamp(v, -1200, 1200) }),
      });

      registerAdsrPorts(
        nodeId,
        registry,
        params,
        { attack: 0.006, decay: 1.4, sustain: 0.18, release: 2.8 },
        (env) => poly.set({ envelope: env }),
      );

      const baseHarmonicity = numParam(params, 'harmonicity', 3.01);
      poly.set({ harmonicity: baseHarmonicity });
      registry.addInput(makePortRef(nodeId, 'harmonicity'), {
        kind: 'scalar',
        base: baseHarmonicity,
        min: 0.25,
        max: 12,
        write: (v) => poly.set({ harmonicity: clamp(v, 0.25, 12) }),
      });
      const baseModIndex = numParam(params, 'modIndex', 5);
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
