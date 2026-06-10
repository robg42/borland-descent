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
import { createMolnar } from './molnar';
import { createHobbs } from './hobbs';
import { createNaon } from './naon';
import { createAkten } from './akten';
import { createCrespo } from './crespo';
import { createAnadol } from './anadol';
import { createHenke } from './henke';
import { createLemercier } from './lemercier';
import { createRickards } from './rickards';
import { createAsendorf } from './asendorf';
import type { VisualLayer, VisualLayerFactory } from './types';

/** Registry of visual layer modules by id. Scenes select their world by these keys.
 *  The first seven are the descent's scenes; signal/swarm/beams are the V3
 *  technique-family modules; the artist series (V3.1) translates ten named
 *  generative artists into further families (N = 20) — all studio-selectable. */
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
  // the artist series — ids name the artist each family is translated from
  molnar: createMolnar, // Vera Molnár — plotter grid, controlled disorder
  hobbs: createHobbs, // Tyler Hobbs — flow-field strokes (Fidenza)
  naon: createNaon, // Manolo Gamboa Naon — saturated packed geometry
  akten: createAkten, // Memo Akten — self-warped neural field
  crespo: createCrespo, // Sofia Crespo — imagined marine organism
  anadol: createAnadol, // Refik Anadol — data sculpture in a slab
  henke: createHenke, // Robert Henke — laser figure (Lumière)
  lemercier: createLemercier, // Joanie Lemercier — projected landform
  rickards: createRickards, // Paul Rickards — moiré interference gratings
  asendorf: createAsendorf, // Kim Asendorf — pixel sorting
};

export function createLayer(moduleId: string): VisualLayer {
  const factory = FACTORIES[moduleId] ?? createOceanicField;
  return factory();
}

/** All registered visual-module ids — for the studio's per-scene module picker. */
export const VISUAL_MODULE_IDS: readonly string[] = Object.keys(FACTORIES);

export type { VisualLayer, VisualLayerFactory } from './types';
