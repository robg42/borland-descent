import * as Tone from 'tone';
import { clamp } from '../../core/curves';
import { makePortRef } from '../../core/ports';
import type { SignalRegistry } from '../../core/registry';
import type { Scalar } from '../../patch/schema';
import { numParam, type SynthModule } from './types';

/**
 * subBass — a tight, dry monophonic sub for the dry low bus. Clean sine, short
 * envelope, no reverb. This is the anchor of the sonic signature (brief §7).
 */
export function createSubBass(): SynthModule {
  const synth = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.012, decay: 0.25, sustain: 0.65, release: 0.7 },
  });
  const out = new Tone.Gain(0.9);
  synth.connect(out);

  return {
    output: out,
    trigger(midi, durationSec, time, velocity) {
      synth.triggerAttackRelease(midiToFreq(midi), durationSec, time, clamp(velocity, 0, 1));
    },
    registerPorts(nodeId, registry: SignalRegistry, params: Record<string, Scalar>) {
      const baseLevel = numParam(params, 'level', 0.9);
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
      synth.dispose();
      out.dispose();
    },
  };
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
