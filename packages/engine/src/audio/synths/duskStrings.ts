import * as Tone from 'tone';
import {
  registerFilterTypePort,
  registerOscTypePort,
  type SynthModule,
  type SynthOptions,
} from './types';
import { disposeAll, registerVoicePorts, triggerHz } from './helpers';

const CUTOFF_MIN = 120;
const CUTOFF_MAX = 9000;

/**
 * duskStrings — the twilight zone, where the last light fades: a bowed string
 * ensemble. A fat, detuned sawtooth swells slowly through a lowpass and then a gentle
 * chorus, so several voices smear into one body. Structurally distinct (fat-osc
 * ensemble + chorus chain); the chorus sits AFTER the filter to keep its stereo width.
 */
export function createDuskStrings(opts?: SynthOptions): SynthModule {
  const poly = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 22 },
    envelope: { attack: 1.8, decay: 1.0, sustain: 0.6, release: 5.0 },
  });
  poly.maxPolyphony = Math.max(1, Math.round(opts?.maxPolyphony ?? 8));

  const filter = new Tone.Filter({ frequency: 1300, type: 'lowpass', Q: 0.8 });
  const chorus = new Tone.Chorus({ frequency: 0.4, delayTime: 4, depth: 0.6, wet: 0.35 }).start();
  const out = new Tone.Gain(0.72);
  poly.connect(filter);
  filter.connect(chorus);
  chorus.connect(out);

  return {
    output: out,
    trigger: triggerHz(poly),
    registerPorts(nodeId, registry, params) {
      registerVoicePorts(registry, nodeId, params, {
        cutoff: { param: filter.frequency, min: CUTOFF_MIN, max: CUTOFF_MAX, fallback: 1300 },
        level: { param: out.gain, fallback: 0.72 },
        detune: { fallback: 0, apply: (v) => poly.set({ detune: v }) },
        adsr: {
          defaults: { attack: 1.8, decay: 1.0, sustain: 0.6, release: 5.0 },
          setEnv: (env) => poly.set({ envelope: env }),
        },
      });
      registerOscTypePort(nodeId, registry, params, (type) => poly.set({ oscillator: { type } }));
      registerFilterTypePort(nodeId, registry, params, (type) => {
        filter.type = type;
      });
    },
    dispose: disposeAll(poly, filter, chorus, out),
  };
}
