import * as Tone from 'tone';
import { clamp } from '../../core/curves';
import { makePortRef } from '../../core/ports';
import type { SignalRegistry } from '../../core/registry';
import type { Scalar } from '../../patch/schema';
import { numParam, type SynthModule, type SynthOptions } from './types';

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
    trigger(midi, durationSec, time, velocity) {
      poly.triggerAttackRelease(midiToFreq(midi), durationSec, time, clamp(velocity, 0, 1));
    },
    registerPorts(nodeId, registry: SignalRegistry, params: Record<string, Scalar>) {
      const baseCutoff = clamp(numParam(params, 'cutoff', 800), CUTOFF_MIN, CUTOFF_MAX);
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
