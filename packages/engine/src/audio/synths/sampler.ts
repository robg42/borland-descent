import * as Tone from 'tone';
import { smoothWrite } from '../smoothWrite';
import { clamp } from '../../core/curves';
import { makePortRef } from '../../core/ports';
import type { SignalRegistry } from '../../core/registry';
import type { Scalar } from '../../patch/schema';
import { numParam, type SynthModule } from './types';
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
    registerPorts(nodeId, registry: SignalRegistry, params: Record<string, Scalar>) {
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

      const baseCutoff = clamp(numParam(params, 'cutoff', 9000), CUTOFF_MIN, CUTOFF_MAX);
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

      const baseAttack = numParam(params, 'attack', 0.02);
      sampler.attack = baseAttack;
      registry.addInput(makePortRef(nodeId, 'attack'), {
        kind: 'scalar',
        base: baseAttack,
        min: 0,
        max: 4,
        write: (v) => {
          sampler.attack = clamp(v, 0, 4);
        },
      });

      const baseRelease = numParam(params, 'release', 1.2);
      sampler.release = baseRelease;
      registry.addInput(makePortRef(nodeId, 'release'), {
        kind: 'scalar',
        base: baseRelease,
        min: 0,
        max: 8,
        write: (v) => {
          sampler.release = clamp(v, 0, 8);
        },
      });
    },
    dispose() {
      sampler.dispose();
      filter.dispose();
      out.dispose();
    },
  };
}

function midiToNote(midi: number): string {
  return Tone.Frequency(midi, 'midi').toNote();
}
