import * as Tone from 'tone';
import { clamp } from '../../core/curves';
import { makePortRef } from '../../core/ports';
import type { SignalRegistry } from '../../core/registry';
import type { Scalar } from '../../patch/schema';
import { numParam, type SynthModule, type SynthOptions } from './types';

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
    trigger(midi, durationSec, time, velocity) {
      poly.triggerAttackRelease(midiToFreq(midi), durationSec, time, clamp(velocity, 0, 1));
    },
    registerPorts(nodeId, registry: SignalRegistry, params: Record<string, Scalar>) {
      const baseCutoff = clamp(numParam(params, 'cutoff', 1300), CUTOFF_MIN, CUTOFF_MAX);
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

      const baseLevel = numParam(params, 'level', 0.72);
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

      const baseDetune = numParam(params, 'detune', 0);
      poly.set({ detune: baseDetune });
      registry.addInput(makePortRef(nodeId, 'detune'), {
        kind: 'bipolar',
        base: baseDetune,
        write: (v) => poly.set({ detune: clamp(v, -1200, 1200) }),
      });
    },
    dispose() {
      poly.dispose();
      filter.dispose();
      chorus.dispose();
      out.dispose();
    },
  };
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
