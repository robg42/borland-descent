import * as Tone from 'tone';
import {
  registerFilterTypePort,
  registerOscTypePort,
  type SynthModule,
  type SynthOptions,
} from './types';
import { addSetterPort, disposeAll, registerVoicePorts, triggerHz } from './helpers';

const CUTOFF_MIN = 80;
const CUTOFF_MAX = 12000;

/**
 * driftPad — warm, slow, polyphonic pad voices destined for the reverb bus.
 *
 * Each voice is a MonoSynth driving detuned unison saws (`fatsawtooth`) through its
 * own resonant lowpass, whose envelope opens on the attack — the breathing "bloom"
 * of an analogue poly (Juno/Prophet). The SHARED post-filter below stays the single
 * `cutoff` port: writable control-rate (zoom → cutoff) and connectable audio-rate
 * (LFO → cutoff) at once, so the modulation matrix is untouched by the richer voice.
 */
export function createDriftPad(opts?: SynthOptions): SynthModule {
  const poly = new Tone.PolySynth(Tone.MonoSynth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 32 },
    envelope: { attack: 1.6, decay: 1.0, sustain: 0.8, release: 5 },
    filter: { type: 'lowpass', rolloff: -24, Q: 1.4 },
    filterEnvelope: {
      attack: 1.8,
      decay: 1.6,
      sustain: 0.5,
      release: 4.5,
      baseFrequency: 180,
      octaves: 3.2,
    },
  });
  poly.maxPolyphony = Math.max(1, Math.round(opts?.maxPolyphony ?? 8));

  const filter = new Tone.Filter({ frequency: 1400, type: 'lowpass', Q: 0.6 });
  // Gentle stereo ensemble after the filter — the Juno/Cocteau width — following the
  // per-voice chorus convention (cf. duskStrings). The stereo tape downstream now
  // carries this width through to the master instead of folding it to mono.
  const chorus = new Tone.Chorus({ frequency: 0.6, delayTime: 3.5, depth: 0.7, spread: 180, wet: 0.4 }).start();
  const out = new Tone.Gain(0.8);
  poly.connect(filter);
  filter.connect(chorus);
  chorus.connect(out);

  return {
    output: out,
    trigger: triggerHz(poly),
    registerPorts(nodeId, registry, params) {
      registerVoicePorts(registry, nodeId, params, {
        cutoff: { param: filter.frequency, min: CUTOFF_MIN, max: CUTOFF_MAX, fallback: 1400 },
        level: { param: out.gain, fallback: 0.8 },
        detune: { fallback: 0, apply: (v) => poly.set({ detune: v }) },
        adsr: {
          defaults: { attack: 1.6, decay: 1.0, sustain: 0.8, release: 5 },
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
      registerOscTypePort(nodeId, registry, params, (type) => poly.set({ oscillator: { type } }));
      registerFilterTypePort(nodeId, registry, params, (type) => {
        filter.type = type;
      });
    },
    dispose: disposeAll(poly, filter, chorus, out),
  };
}
