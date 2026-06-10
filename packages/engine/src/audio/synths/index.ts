import { createDriftPad } from './driftPad';
import { createSubBass } from './subBass';
import { createVoidChoir } from './voidChoir';
import { createGlassBells } from './glassBells';
import { createRefractPad } from './refractPad';
import { createDuskStrings } from './duskStrings';
import { createPressureDrone } from './pressureDrone';
import { createLeviathan } from './leviathan';
import { createSampler } from './sampler';
import { createVoxChoir } from './voxChoir';
import type { SynthFactory, SynthModule, SynthOptions } from './types';

/** Registry of synth modules by id. Scenes select their voices/bass by these keys. */
const FACTORIES: Record<string, SynthFactory> = {
  driftPad: createDriftPad,
  subBass: createSubBass,
  voidChoir: createVoidChoir,
  glassBells: createGlassBells,
  refractPad: createRefractPad,
  duskStrings: createDuskStrings,
  pressureDrone: createPressureDrone,
  leviathan: createLeviathan,
  sampler: createSampler,
  voxChoir: createVoxChoir,
};

export function createSynth(moduleId: string, opts?: SynthOptions): SynthModule {
  const factory = FACTORIES[moduleId] ?? createDriftPad;
  return factory(opts);
}

/** All registered synth-module ids — for the studio's per-scene voice picker. */
export const SYNTH_MODULE_IDS: readonly string[] = Object.keys(FACTORIES);

export type { SynthModule, SynthFactory, SynthOptions } from './types';
