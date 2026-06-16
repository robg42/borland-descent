import * as Tone from 'tone';
import type { SynthModule, SynthOptions } from './types';
import { addSetterPort, disposeAll, registerVoicePorts, triggerHz } from './helpers';

const CUTOFF_MIN = 150;
const CUTOFF_MAX = 10000;

/**
 * refractPad — the thermocline: a warm pad that shimmers and beats as if heard
 * through a temperature boundary. Amplitude-modulation synthesis with a non-integer
 * harmonicity gives the slow interference shimmer; `detune` widens it into audible
 * refraction. A different MODULE from the FM/saw voices, sharing cutoff/level.
 */
export function createRefractPad(opts?: SynthOptions): SynthModule {
  const poly = new Tone.PolySynth(Tone.AMSynth, {
    harmonicity: 2.51,
    oscillator: { type: 'sine' },
    envelope: { attack: 1.1, decay: 0.7, sustain: 0.7, release: 3.6 },
    modulation: { type: 'sine' },
    modulationEnvelope: { attack: 1.6, decay: 0.5, sustain: 0.6, release: 3.0 },
  });
  poly.maxPolyphony = Math.max(1, Math.round(opts?.maxPolyphony ?? 8));

  const filter = new Tone.Filter({ frequency: 1900, type: 'lowpass', Q: 0.7 });
  const out = new Tone.Gain(0.75);
  poly.connect(filter);
  filter.connect(out);

  return {
    output: out,
    trigger: triggerHz(poly),
    registerPorts(nodeId, registry, params) {
      registerVoicePorts(registry, nodeId, params, {
        cutoff: { param: filter.frequency, min: CUTOFF_MIN, max: CUTOFF_MAX, fallback: 1900 },
        level: { param: out.gain, fallback: 0.75 },
        detune: { fallback: 9, apply: (v) => poly.set({ detune: v }) },
        adsr: {
          defaults: { attack: 1.1, decay: 0.7, sustain: 0.7, release: 3.6 },
          setEnv: (env) => poly.set({ envelope: env }),
        },
      });
      addSetterPort(registry, nodeId, 'harmonicity', params, {
        kind: 'scalar',
        fallback: 2.51,
        min: 0.25,
        max: 8,
        apply: (v) => poly.set({ harmonicity: v }),
      });
    },
    dispose: disposeAll(poly, filter, out),
  };
}
