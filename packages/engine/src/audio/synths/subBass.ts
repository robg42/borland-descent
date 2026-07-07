import * as Tone from 'tone';
import { smoothWrite } from '../smoothWrite';
import { clamp } from '../../core/curves';
import { makePortRef } from '../../core/ports';
import type { SignalRegistry } from '../../core/registry';
import type { Scalar } from '../../patch/schema';
import { numParam, type SynthModule } from './types';

/**
 * subBass — the dry, mono anchor of the low end, in two summed layers:
 *
 *  • SUB — a clean sine carrying the fundamental weight (felt on headphones and real
 *    speakers, but inaudible on a phone, which rolls off below ~400 Hz).
 *  • BODY — a warm, slightly-detuned saw through a lowpass, so its harmonics land in the
 *    ~200 Hz–1.4 kHz range a phone CAN reproduce and carry the pitch on small speakers.
 *    The slight detune gives the round, analogue Boards-of-Canada weight.
 *
 * Stays dry and mono (no reverb, no pitch drift) so the low end is solid and translates
 * everywhere. `level` is the master; `subLevel`/`bodyLevel` trade weight against presence.
 */
export function createSubBass(): SynthModule {
  const sub = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.03, decay: 0.3, sustain: 0.85, release: 0.9 },
  });
  const body = new Tone.MonoSynth({
    oscillator: { type: 'fatsawtooth', count: 2, spread: 12 },
    envelope: { attack: 0.05, decay: 0.4, sustain: 0.7, release: 0.9 },
    filter: { type: 'lowpass', rolloff: -12, Q: 0.8 },
    filterEnvelope: {
      attack: 0.08,
      decay: 0.6,
      sustain: 0.7,
      release: 0.9,
      baseFrequency: 400,
      octaves: 1.8,
    },
  });

  const subGain = new Tone.Gain(0.85);
  const bodyGain = new Tone.Gain(0.4);
  const out = new Tone.Gain(0.85);
  sub.connect(subGain);
  body.connect(bodyGain);
  subGain.connect(out);
  bodyGain.connect(out);

  return {
    output: out,
    trigger(midi, durationSec, time, velocity) {
      const f = midiToFreq(midi);
      const v = clamp(velocity, 0, 1);
      sub.triggerAttackRelease(f, durationSec, time, v);
      body.triggerAttackRelease(f, durationSec, time, v);
    },
    registerPorts(nodeId, registry: SignalRegistry, params: Record<string, Scalar>) {
      const baseLevel = numParam(params, 'level', 0.85);
      out.gain.value = baseLevel;
      registry.addInput(makePortRef(nodeId, 'level'), {
        kind: 'unipolar',
        base: baseLevel,
        min: 0,
        max: 1.5,
        write: (v) => {
          smoothWrite(out.gain, clamp(v, 0, 1.5));
        },
        audioTarget: out.gain,
      });

      const baseSub = numParam(params, 'subLevel', 0.85);
      subGain.gain.value = baseSub;
      registry.addInput(makePortRef(nodeId, 'subLevel'), {
        kind: 'unipolar',
        base: baseSub,
        min: 0,
        max: 1.5,
        write: (v) => {
          smoothWrite(subGain.gain, clamp(v, 0, 1.5));
        },
        audioTarget: subGain.gain,
      });

      const baseBody = numParam(params, 'bodyLevel', 0.4);
      bodyGain.gain.value = baseBody;
      registry.addInput(makePortRef(nodeId, 'bodyLevel'), {
        kind: 'unipolar',
        base: baseBody,
        min: 0,
        max: 1.5,
        write: (v) => {
          smoothWrite(bodyGain.gain, clamp(v, 0, 1.5));
        },
        audioTarget: bodyGain.gain,
      });
    },
    dispose() {
      sub.dispose();
      body.dispose();
      subGain.dispose();
      bodyGain.dispose();
      out.dispose();
    },
  };
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
