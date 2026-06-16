import * as Tone from 'tone';
import { clamp } from '../../core/curves';
import type { SynthModule } from './types';
import { addParamPort, addSetterPort, disposeAll } from './helpers';
import { sampleStore, type SampleEntry } from '../sampleStore';

const CUTOFF_MIN = 200;
const CUTOFF_MAX = 16000;

/**
 * sampler — plays a user-loaded sample pitched across the keyboard via Tone.Sampler. The
 * sample is referenced by id (bound from the Patch via bindSample) and read from the
 * runtime sampleStore; level / cutoff / attack / release are ports, so the studio edits
 * and the matrix automates this voice exactly like the synth voices. Silent until a
 * sample is bound, so a patch that references a missing sample simply makes no sound.
 */
export function createSampler(): SynthModule {
  const sampler = new Tone.Sampler({ attack: 0.02, release: 1.2 });
  const filter = new Tone.Filter({ frequency: 9000, type: 'lowpass', Q: 0.4 });
  const out = new Tone.Gain(0.8);
  sampler.connect(filter);
  filter.connect(out);

  let hasSample = false;
  function bind(entry: SampleEntry): void {
    // The runtime value is a valid note name; Tone types `add`'s note as a literal union,
    // so cast to the method's own parameter type rather than a loose string.
    sampler.add(midiToNote(entry.rootMidi) as Parameters<typeof sampler.add>[0], entry.buffer);
    hasSample = true;
  }

  return {
    output: out,
    bindSample(id: string) {
      const cached = sampleStore.getCached(id);
      if (cached) {
        bind(cached);
        return;
      }
      void sampleStore.load(id).then((entry) => {
        if (entry) bind(entry);
      });
    },
    trigger(midi, durationSec, time, velocity) {
      if (!hasSample) return; // nothing loaded → silent, never throws
      sampler.triggerAttackRelease(midiToNote(midi), durationSec, time, clamp(velocity, 0, 1));
    },
    registerPorts(nodeId, registry, params) {
      addParamPort(registry, nodeId, 'level', params, {
        kind: 'unipolar',
        fallback: 0.8,
        min: 0,
        max: 1.5,
        param: out.gain,
      });
      addParamPort(registry, nodeId, 'cutoff', params, {
        kind: 'scalar',
        fallback: 9000,
        min: CUTOFF_MIN,
        max: CUTOFF_MAX,
        param: filter.frequency,
      });
      addSetterPort(registry, nodeId, 'attack', params, {
        kind: 'scalar',
        fallback: 0.02,
        min: 0,
        max: 4,
        apply: (v) => {
          sampler.attack = v;
        },
      });
      addSetterPort(registry, nodeId, 'release', params, {
        kind: 'scalar',
        fallback: 1.2,
        min: 0,
        max: 8,
        apply: (v) => {
          sampler.release = v;
        },
      });
    },
    dispose: disposeAll(sampler, filter, out),
  };
}

function midiToNote(midi: number): string {
  return Tone.Frequency(midi, 'midi').toNote();
}
