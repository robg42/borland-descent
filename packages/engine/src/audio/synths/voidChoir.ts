import * as Tone from 'tone';
import { registerFilterTypePort, type SynthModule, type SynthOptions } from './types';
import { addSetterPort, disposeAll, registerVoicePorts, triggerHz } from './helpers';

const CUTOFF_MIN = 60;
const CUTOFF_MAX = 9000;

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
    trigger: triggerHz(poly),
    registerPorts(nodeId, registry, params) {
      registerVoicePorts(registry, nodeId, params, {
        cutoff: { param: filter.frequency, min: CUTOFF_MIN, max: CUTOFF_MAX, fallback: 800 },
        level: { param: out.gain, fallback: 0.7 },
        adsr: {
          defaults: { attack: 2.2, decay: 1.2, sustain: 0.75, release: 4.5 },
          setEnv: (env) => poly.set({ envelope: env }),
        },
      });
      addSetterPort(registry, nodeId, 'harmonicity', params, {
        kind: 'scalar',
        fallback: 1.41,
        min: 0.25,
        max: 8,
        apply: (v) => poly.set({ harmonicity: v }),
      });
      addSetterPort(registry, nodeId, 'modIndex', params, {
        kind: 'scalar',
        fallback: 7,
        min: 0,
        max: 25,
        apply: (v) => poly.set({ modulationIndex: v }),
      });
      registerFilterTypePort(nodeId, registry, params, (type) => {
        filter.type = type;
      });
    },
    dispose: disposeAll(poly, filter, out),
  };
}
