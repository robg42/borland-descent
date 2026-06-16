import * as Tone from 'tone';
import { clamp } from '../../core/curves';
import { smoothWrite } from '../../core/params';
import type { SynthModule, SynthOptions } from './types';
import { addSetterPort, disposeAll, registerVoicePorts, triggerHz } from './helpers';

const CUTOFF_MIN = 200;
const CUTOFF_MAX = 14000;

// Vowel formant frequencies (Hz), F1/F2/F3 — the `vowel` port morphs between the two.
const VOWEL_A = [350, 800, 2400]; // "ooh"
const VOWEL_B = [700, 1220, 2600]; // "aah"
const FORMANT_GAIN = [1.0, 0.5, 0.25]; // F1 dominant, higher formants quieter

/**
 * voxChoir — a synthetic vocal / choir voice: an ensemble of detuned saws ("singers")
 * shaped by a three-formant bandpass bank into a vowel, with a `vowel` morph (ooh↔aah)
 * that's editable and automatable — e.g. arc.darkness → vowel for a choir that opens as
 * it descends. The in-rule alternative to RNBO formant patches; pairs with real choir
 * samples and the convolution reverb for the lush 4AD / AWVFTS wash.
 */
export function createVoxChoir(opts?: SynthOptions): SynthModule {
  const poly = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 22 },
    envelope: { attack: 1.4, decay: 1.0, sustain: 0.85, release: 4.5 },
  });
  poly.maxPolyphony = Math.max(1, Math.round(opts?.maxPolyphony ?? 8));

  // parallel formant bandpasses, each weighted, summed
  const bands = [0, 1, 2].map((i) => ({
    filter: new Tone.Filter({ type: 'bandpass', frequency: VOWEL_A[i]!, Q: 8 + i * 2 }),
    gain: new Tone.Gain(FORMANT_GAIN[i]!),
  }));
  const sum = new Tone.Gain(1);
  const cutoff = new Tone.Filter({ frequency: 9000, type: 'lowpass', Q: 0.5 });
  const chorus = new Tone.Chorus({ frequency: 0.5, delayTime: 4, depth: 0.6, spread: 180, wet: 0.4 }).start();
  const out = new Tone.Gain(0.7);
  for (const b of bands) {
    poly.connect(b.filter);
    b.filter.connect(b.gain);
    b.gain.connect(sum);
  }
  sum.connect(cutoff);
  cutoff.connect(chorus);
  chorus.connect(out);

  // Smoothed formant moves: a high-Q bandpass jumping frequency per frame zippers
  // badly under automation (arc → vowel); a short glide makes the morph vocal.
  function setVowel(v: number): void {
    const t = clamp(v, 0, 1);
    for (let i = 0; i < 3; i++) {
      smoothWrite(bands[i]!.filter.frequency, VOWEL_A[i]! + (VOWEL_B[i]! - VOWEL_A[i]!) * t);
    }
  }

  return {
    output: out,
    trigger: triggerHz(poly),
    registerPorts(nodeId, registry, params) {
      registerVoicePorts(registry, nodeId, params, {
        cutoff: { param: cutoff.frequency, min: CUTOFF_MIN, max: CUTOFF_MAX, fallback: 9000 },
        level: { param: out.gain, fallback: 0.7 },
        detune: { fallback: 0, apply: (v) => poly.set({ detune: v }) },
        adsr: {
          defaults: { attack: 1.4, decay: 1.0, sustain: 0.85, release: 4.5 },
          setEnv: (env) => poly.set({ envelope: env }),
        },
      });
      addSetterPort(registry, nodeId, 'vowel', params, {
        kind: 'unipolar',
        fallback: 0.4,
        min: 0,
        max: 1,
        apply: setVowel,
      });
    },
    dispose: disposeAll(
      poly,
      ...bands.flatMap((b) => [b.filter, b.gain]),
      sum,
      cutoff,
      chorus,
      out,
    ),
  };
}
