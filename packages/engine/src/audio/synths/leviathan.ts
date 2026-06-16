import * as Tone from 'tone';
import type { SynthModule, SynthOptions } from './types';
import { addSetterPort, disposeAll, registerVoicePorts, triggerHz } from './helpers';

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
    trigger: triggerHz(poly),
    registerPorts(nodeId, registry, params) {
      registerVoicePorts(registry, nodeId, params, {
        cutoff: { param: filter.frequency, min: CUTOFF_MIN, max: CUTOFF_MAX, fallback: 1100 },
        level: { param: out.gain, fallback: 0.7 },
        detune: { fallback: 0, apply: (v) => poly.set({ detune: v }) },
        adsr: {
          defaults: { attack: 2.5, decay: 1.0, sustain: 0.8, release: 5.0 },
          setEnv: (env) => poly.set({ voice0: { envelope: env }, voice1: { envelope: env } }),
        },
      });
      addSetterPort(registry, nodeId, 'harmonicity', params, {
        kind: 'scalar',
        fallback: 0.5,
        min: 0.25,
        max: 4,
        apply: (v) => poly.set({ harmonicity: v }),
      });
      addSetterPort(registry, nodeId, 'vibratoAmount', params, {
        kind: 'unipolar',
        fallback: 0.18,
        min: 0,
        max: 1,
        apply: (v) => poly.set({ vibratoAmount: v }),
      });
    },
    dispose: disposeAll(poly, filter, out),
  };
}
