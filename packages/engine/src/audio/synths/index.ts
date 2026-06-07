import { createDriftPad } from './driftPad';
import { createSubBass } from './subBass';
import { createVoidChoir } from './voidChoir';
import type { SynthFactory, SynthModule, SynthOptions } from './types';

/** Registry of synth modules by id. Scenes select their voices/bass by these keys. */
const FACTORIES: Record<string, SynthFactory> = {
  driftPad: createDriftPad,
  subBass: createSubBass,
  voidChoir: createVoidChoir,
};

export function createSynth(moduleId: string, opts?: SynthOptions): SynthModule {
  const factory = FACTORIES[moduleId] ?? createDriftPad;
  return factory(opts);
}

export type { SynthModule, SynthFactory, SynthOptions } from './types';
