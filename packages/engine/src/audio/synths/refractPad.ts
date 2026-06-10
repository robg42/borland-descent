import * as Tone from 'tone';
import { clamp } from '../../core/curves';
import { makePortRef } from '../../core/ports';
import type { SignalRegistry } from '../../core/registry';
import type { Scalar } from '../../patch/schema';
import { numParam, registerAdsrPorts, type SynthModule, type SynthOptions } from './types';

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
    trigger(midi, durationSec, time, velocity) {
      poly.triggerAttackRelease(midiToFreq(midi), durationSec, time, clamp(velocity, 0, 1));
    },
    registerPorts(nodeId, registry: SignalRegistry, params: Record<string, Scalar>) {
      const baseCutoff = clamp(numParam(params, 'cutoff', 1900), CUTOFF_MIN, CUTOFF_MAX);
      filter.frequency.value = baseCutoff;
      registry.addInput(makePortRef(nodeId, 'cutoff'), {
        kind: 'scalar',
        base: baseCutoff,
        min: CUTOFF_MIN,
        max: CUTOFF_MAX,
        write: (v) => {
          filter.frequency.value = clamp(v, CUTOFF_MIN, CUTOFF_MAX);
        },
        audioTarget: filter.frequency,
      });

      const baseLevel = numParam(params, 'level', 0.75);
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

      const baseDetune = numParam(params, 'detune', 9);
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
        { attack: 1.1, decay: 0.7, sustain: 0.7, release: 3.6 },
        (env) => poly.set({ envelope: env }),
      );

      const baseHarmonicity = numParam(params, 'harmonicity', 2.51);
      poly.set({ harmonicity: baseHarmonicity });
      registry.addInput(makePortRef(nodeId, 'harmonicity'), {
        kind: 'scalar',
        base: baseHarmonicity,
        min: 0.25,
        max: 8,
        write: (v) => poly.set({ harmonicity: clamp(v, 0.25, 8) }),
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
