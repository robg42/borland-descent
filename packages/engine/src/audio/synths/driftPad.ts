import * as Tone from 'tone';
import { smoothWrite } from '../smoothWrite';
import { clamp } from '../../core/curves';
import { makePortRef } from '../../core/ports';
import type { SignalRegistry } from '../../core/registry';
import type { Scalar } from '../../patch/schema';
import { numParam, registerAdsrPorts, type SynthModule, type SynthOptions } from './types';

const CUTOFF_MIN = 80;
const CUTOFF_MAX = 12000;

const OSC_TYPES = ['fatsawtooth', 'sawtooth', 'fattriangle', 'triangle', 'fatsquare', 'square', 'sine'] as const;
const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch'] as const;

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
          smoothWrite(filter.frequency, clamp(v, CUTOFF_MIN, CUTOFF_MAX));
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
          smoothWrite(out.gain, clamp(v, 0, 1.5));
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

      registerAdsrPorts(
        nodeId,
        registry,
        params,
        { attack: 1.6, decay: 1.0, sustain: 0.8, release: 5 },
        (env) => poly.set({ envelope: env }),
      );

      const baseFilterOct = numParam(params, 'filterOctaves', 3.2);
      poly.set({ filterEnvelope: { octaves: baseFilterOct } });
      registry.addInput(makePortRef(nodeId, 'filterOctaves'), {
        kind: 'scalar',
        base: baseFilterOct,
        min: 0,
        max: 6,
        write: (v) => poly.set({ filterEnvelope: { octaves: clamp(v, 0, 6) } }),
      });

      // Oscillator type (enum index → string).
      const baseOscIdx = Math.round(clamp(numParam(params, 'oscType', 0), 0, OSC_TYPES.length - 1));
      poly.set({ oscillator: { type: OSC_TYPES[baseOscIdx] } });
      registry.addInput(makePortRef(nodeId, 'oscType'), {
        kind: 'option',
        base: baseOscIdx,
        min: 0,
        max: OSC_TYPES.length - 1,
        options: [...OSC_TYPES],
        write: (v) => {
          const idx = Math.round(clamp(v, 0, OSC_TYPES.length - 1));
          poly.set({ oscillator: { type: OSC_TYPES[idx] } });
        },
      });

      // Filter type (enum index → string).
      const baseFilterIdx = Math.round(clamp(numParam(params, 'filterType', 0), 0, FILTER_TYPES.length - 1));
      filter.type = FILTER_TYPES[baseFilterIdx] as BiquadFilterType;
      registry.addInput(makePortRef(nodeId, 'filterType'), {
        kind: 'option',
        base: baseFilterIdx,
        min: 0,
        max: FILTER_TYPES.length - 1,
        options: [...FILTER_TYPES],
        write: (v) => {
          const idx = Math.round(clamp(v, 0, FILTER_TYPES.length - 1));
          filter.type = FILTER_TYPES[idx] as BiquadFilterType;
        },
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
