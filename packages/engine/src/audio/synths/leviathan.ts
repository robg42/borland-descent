import * as Tone from 'tone';
import { smoothWrite } from '../smoothWrite';
import { clamp } from '../../core/curves';
import { makePortRef } from '../../core/ports';
import type { SignalRegistry } from '../../core/registry';
import type { Scalar } from '../../patch/schema';
import { numParam, registerAdsrPorts, type SynthModule, type SynthOptions } from './types';

const CUTOFF_MIN = 60;
const CUTOFF_MAX = 7000;

/**
 * leviathan — the abyssal plain: vast, slow and immense. DuoSynth runs two detuned
 * MonoSynths in parallel with a slow vibrato, the second voice pitched an octave below
 * (harmonicity 0.5) so every note opens into a wide, breathing body. The heaviest
 * voice, so its polyphony is capped low. Shares cutoff/level/detune with the others.
 */
export function createLeviathan(opts?: SynthOptions): SynthModule {
  const poly = new Tone.PolySynth(Tone.DuoSynth, {
    voice0: {
      oscillator: { type: 'sine' },
      envelope: { attack: 2.5, decay: 1.0, sustain: 0.8, release: 5.0 },
      filterEnvelope: { attack: 3.0, decay: 2.0, sustain: 0.5, baseFrequency: 200, octaves: 2 },
    },
    voice1: {
      oscillator: { type: 'triangle' },
      envelope: { attack: 3.0, decay: 1.5, sustain: 0.7, release: 6.0 },
      filterEnvelope: { attack: 3.5, decay: 2.0, sustain: 0.4, baseFrequency: 150, octaves: 2 },
    },
    harmonicity: 0.5,
    vibratoRate: 0.18,
    vibratoAmount: 0.18,
  });
  poly.maxPolyphony = Math.max(1, Math.round(opts?.maxPolyphony ?? 6));

  const filter = new Tone.Filter({ frequency: 1100, type: 'lowpass', Q: 0.9 });
  const out = new Tone.Gain(0.7);
  poly.connect(filter);
  filter.connect(out);

  return {
    output: out,
    trigger(midi, durationSec, time, velocity) {
      poly.triggerAttackRelease(midiToFreq(midi), durationSec, time, clamp(velocity, 0, 1));
    },
    registerPorts(nodeId, registry: SignalRegistry, params: Record<string, Scalar>) {
      const baseCutoff = clamp(numParam(params, 'cutoff', 1100), CUTOFF_MIN, CUTOFF_MAX);
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
        { attack: 2.5, decay: 1.0, sustain: 0.8, release: 5.0 },
        (env) => poly.set({ voice0: { envelope: env }, voice1: { envelope: env } }),
      );

      const baseHarmonicity = numParam(params, 'harmonicity', 0.5);
      poly.set({ harmonicity: baseHarmonicity });
      registry.addInput(makePortRef(nodeId, 'harmonicity'), {
        kind: 'scalar',
        base: baseHarmonicity,
        min: 0.25,
        max: 4,
        write: (v) => poly.set({ harmonicity: clamp(v, 0.25, 4) }),
      });
      const baseVibrato = numParam(params, 'vibratoAmount', 0.18);
      poly.set({ vibratoAmount: baseVibrato });
      registry.addInput(makePortRef(nodeId, 'vibratoAmount'), {
        kind: 'unipolar',
        base: baseVibrato,
        min: 0,
        max: 1,
        write: (v) => poly.set({ vibratoAmount: clamp(v, 0, 1) }),
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
