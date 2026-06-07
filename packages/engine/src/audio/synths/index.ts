import { createDriftPad } from './driftPad';
import { createSubBass } from './subBass';
import { createVoidChoir } from './voidChoir';
import type { SynthFactory, SynthModule } from './types';

/** Registry of synth modules by id. Scenes select their voices/bass by these keys. */
const FACTORIES: Record<string, SynthFactory> = {
  driftPad: createDriftPad,
  subBass: createSubBass,
  voidChoir: createVoidChoir,
};

export function createSynth(moduleId: string): SynthModule {
  const factory = FACTORIES[moduleId] ?? createDriftPad;
  return factory();
}

export type { SynthModule, SynthFactory } from './types';
