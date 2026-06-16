import * as Tone from 'tone';
import { registerFilterTypePort, type SynthModule, type SynthOptions } from './types';
import { addSetterPort, disposeAll, registerVoicePorts, triggerHz } from './helpers';

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
    trigger: triggerHz(poly),
    registerPorts(nodeId, registry, params) {
      registerVoicePorts(registry, nodeId, params, {
        cutoff: { param: filter.frequency, min: CUTOFF_MIN, max: CUTOFF_MAX, fallback: 900 },
        level: { param: out.gain, fallback: 0.7 },
        adsr: {
          defaults: { attack: 1.4, decay: 1.2, sustain: 0.65, release: 4.0 },
          setEnv: (env) => poly.set({ envelope: env }),
        },
      });
      addSetterPort(registry, nodeId, 'filterOctaves', params, {
        kind: 'scalar',
        fallback: 3.2,
        min: 0,
        max: 6,
        apply: (v) => poly.set({ filterEnvelope: { octaves: v } }),
      });
      addSetterPort(registry, nodeId, 'width', params, {
        kind: 'unipolar',
        fallback: 0.3,
        min: 0,
        max: 1,
        apply: (v) => poly.set({ oscillator: { type: 'pulse', width: v } }),
      });
      // Only filterType here — the oscillator is a pulse with its own `width` port, so
      // there is no oscType choice to expose without conflicting with that control.
      registerFilterTypePort(nodeId, registry, params, (type) => {
        filter.type = type;
      });
    },
    dispose: disposeAll(poly, filter, out),
  };
}
