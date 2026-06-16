import * as Tone from 'tone';
import { registerFilterTypePort, type SynthModule, type SynthOptions } from './types';
import { addSetterPort, disposeAll, registerVoicePorts, triggerHz } from './helpers';

const CUTOFF_MIN = 300;
const CUTOFF_MAX = 14000;

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
    trigger: triggerHz(poly),
    registerPorts(nodeId, registry, params) {
      registerVoicePorts(registry, nodeId, params, {
        cutoff: { param: filter.frequency, min: CUTOFF_MIN, max: CUTOFF_MAX, fallback: 3200 },
        level: { param: out.gain, fallback: 0.7 },
        detune: { fallback: 0, apply: (v) => poly.set({ detune: v }) },
        adsr: {
          defaults: { attack: 0.006, decay: 1.4, sustain: 0.18, release: 2.8 },
          setEnv: (env) => poly.set({ envelope: env }),
        },
      });
      addSetterPort(registry, nodeId, 'harmonicity', params, {
        kind: 'scalar',
        fallback: 3.01,
        min: 0.25,
        max: 12,
        apply: (v) => poly.set({ harmonicity: v }),
      });
      addSetterPort(registry, nodeId, 'modIndex', params, {
        kind: 'scalar',
        fallback: 5,
        min: 0,
        max: 25,
        apply: (v) => poly.set({ modulationIndex: v }),
      });
      // Standardised on the shared four-shape list (was a bespoke three-shape list
      // without 'notch' — indices 0–2 are unchanged, so saved patches keep meaning).
      registerFilterTypePort(nodeId, registry, params, (type) => {
        filter.type = type;
      });
    },
    dispose: disposeAll(poly, filter, out),
  };
}
