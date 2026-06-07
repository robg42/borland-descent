import * as Tone from 'tone';
import { clamp } from '../../core/curves';
import { makePortRef } from '../../core/ports';
import type { SignalRegistry } from '../../core/registry';
import type { Scalar } from '../../patch/schema';
import { numParam, type SynthModule } from './types';

const CUTOFF_MIN = 80;
const CUTOFF_MAX = 12000;

/**
 * driftPad — warm, slow, polyphonic pad voices destined for the reverb bus. Its
 * lowpass cutoff is the demonstration port for modulation: writable control-rate
 * (zoom → cutoff) and connectable audio-rate (LFO → cutoff) at the same time.
 */
export function createDriftPad(): SynthModule {
  const poly = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 1.4, decay: 0.8, sustain: 0.7, release: 4.5 },
  });
  poly.maxPolyphony = 8;

  const filter = new Tone.Filter({ frequency: 1400, type: 'lowpass', Q: 0.6 });
  const out = new Tone.Gain(0.8);
  poly.connect(filter);
  filter.connect(out);

  return {
    output: out,
    trigger(midi, durationSec, time, velocity) {
      poly.triggerAttackRelease(midiToFreq(midi), durationSec, time, clamp(velocity, 0, 1));
    },
    registerPorts(nodeId, registry: SignalRegistry, params: Record<string, Scalar>) {
      const baseCutoff = clamp(numParam(params, 'cutoff', 1400), CUTOFF_MIN, CUTOFF_MAX);
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

      const baseLevel = numParam(params, 'level', 0.8);
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
      out.dispose();
    },
  };
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
