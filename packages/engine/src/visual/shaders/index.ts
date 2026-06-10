import { createOceanicField } from './oceanicField';
import { createAbyss } from './abyss';
import { createSunlitShallows } from './sunlitShallows';
import { createThermocline } from './thermocline';
import { createTwilightZone } from './twilightZone';
import { createMidnightZone } from './midnightZone';
import { createAbyssalPlain } from './abyssalPlain';
import { createSignal } from './signal';
import { createSwarm } from './swarm';
import { createBeams } from './beams';
import type { VisualLayer, VisualLayerFactory } from './types';

/** Registry of visual layer modules by id. Scenes select their world by these keys.
 *  The first seven are the descent's scenes; signal/swarm/beams are the V3
 *  technique-family modules (N = 10) — selectable from the studio's picker. */
const FACTORIES: Record<string, VisualLayerFactory> = {
  oceanicField: createOceanicField,
  abyss: createAbyss,
  sunlitShallows: createSunlitShallows,
  thermocline: createThermocline,
  twilightZone: createTwilightZone,
  midnightZone: createMidnightZone,
  abyssalPlain: createAbyssalPlain,
  signal: createSignal,
  swarm: createSwarm,
  beams: createBeams,
};

export function createLayer(moduleId: string): VisualLayer {
  const factory = FACTORIES[moduleId] ?? createOceanicField;
  return factory();
}

/** All registered visual-module ids — for the studio's per-scene module picker. */
export const VISUAL_MODULE_IDS: readonly string[] = Object.keys(FACTORIES);

export type { VisualLayer, VisualLayerFactory } from './types';
