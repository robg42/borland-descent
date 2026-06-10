import * as Tone from 'tone';
import { clamp } from '../../core/curves';
import { makePortRef } from '../../core/ports';
import type { SignalRegistry } from '../../core/registry';
import type { Scalar } from '../../patch/schema';
import { numParam, registerAdsrPorts, type SynthModule, type SynthOptions } from './types';

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

  function setVowel(v: number): void {
    const t = clamp(v, 0, 1);
    for (let i = 0; i < 3; i++) {
      bands[i]!.filter.frequency.value = VOWEL_A[i]! + (VOWEL_B[i]! - VOWEL_A[i]!) * t;
    }
  }

  return {
    output: out,
    trigger(midi, durationSec, time, velocity) {
      poly.triggerAttackRelease(midiToFreq(midi), durationSec, time, clamp(velocity, 0, 1));
    },
    registerPorts(nodeId, registry: SignalRegistry, params: Record<string, Scalar>) {
      const baseLevel = numParam(params, 'level', 0.7);
      out.gain.value = baseLevel;
      registry.addInput(makePortRef(nodeId, 'level'), {
        kind: 'unipolar',
        base: baseLevel,
        min: 0,
        max: 1.5,
        write: (v) => {
          out.gain.value = clamp(v, 0, 1.5);
        },
        audioTarget: out.gain,
      });

      const baseCutoff = clamp(numParam(params, 'cutoff', 9000), CUTOFF_MIN, CUTOFF_MAX);
      cutoff.frequency.value = baseCutoff;
      registry.addInput(makePortRef(nodeId, 'cutoff'), {
        kind: 'scalar',
        base: baseCutoff,
        min: CUTOFF_MIN,
        max: CUTOFF_MAX,
        write: (v) => {
          cutoff.frequency.value = clamp(v, CUTOFF_MIN, CUTOFF_MAX);
        },
        audioTarget: cutoff.frequency,
      });

      const baseVowel = numParam(params, 'vowel', 0.4);
      setVowel(baseVowel);
      registry.addInput(makePortRef(nodeId, 'vowel'), {
        kind: 'unipolar',
        base: baseVowel,
        min: 0,
        max: 1,
        write: (v) => setVowel(v),
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
        { attack: 1.4, decay: 1.0, sustain: 0.85, release: 4.5 },
        (env) => poly.set({ envelope: env }),
      );
    },
    dispose() {
      poly.dispose();
      for (const b of bands) {
        b.filter.dispose();
        b.gain.dispose();
      }
      sum.dispose();
      cutoff.dispose();
      chorus.dispose();
      out.dispose();
    },
  };
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
