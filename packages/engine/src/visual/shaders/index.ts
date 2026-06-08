import { createOceanicField } from './oceanicField';
import { createAbyss } from './abyss';
import { createSunlitShallows } from './sunlitShallows';
import { createThermocline } from './thermocline';
import { createTwilightZone } from './twilightZone';
import { createMidnightZone } from './midnightZone';
import { createAbyssalPlain } from './abyssalPlain';
import type { VisualLayer, VisualLayerFactory } from './types';

/** Registry of visual layer modules by id. Scenes select their world by these keys. */
const FACTORIES: Record<string, VisualLayerFactory> = {
  oceanicField: createOceanicField,
  abyss: createAbyss,
  sunlitShallows: createSunlitShallows,
  thermocline: createThermocline,
  twilightZone: createTwilightZone,
  midnightZone: createMidnightZone,
  abyssalPlain: createAbyssalPlain,
};

export function createLayer(moduleId: string): VisualLayer {
  const factory = FACTORIES[moduleId] ?? createOceanicField;
  return factory();
}

export type { VisualLayer, VisualLayerFactory } from './types';
