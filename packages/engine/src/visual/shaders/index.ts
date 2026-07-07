import { createOceanicField } from './oceanicField';
import { createAbyss } from './abyss';
import { createSunlitShallows } from './sunlitShallows';
import { createThermocline } from './thermocline';
import { createTwilightZone } from './twilightZone';
import { createMidnightZone } from './midnightZone';
import { createAbyssalPlain } from './abyssalPlain';
import { createMolnar } from './molnar';
import { createHobbs } from './hobbs';
import { createNaon } from './naon';
import { createCrespo } from './crespo';
import { createAnadol } from './anadol';
import { createHenke } from './henke';
import { createLemercier } from './lemercier';
import { createRickards } from './rickards';
import { createAsendorf } from './asendorf';
import { createChladni } from './chladni';
import { createSuminagashi } from './suminagashi';
import { createSonar } from './sonar';
import { createReef } from './reef';
import { createPhysarum } from './physarum';
import { createTrench } from './trench';
import { createUndertow } from './undertow';
import type { VisualLayer, VisualLayerFactory } from './types';

/** Registry of visual layer modules by id. Scenes select their world by these keys.
 *  The first seven are the descent's scenes; the artist series (V3.1) translates
 *  nine named generative artists into further families; the phenomena series
 *  (V3.2) translates four physical processes — sound made visible (cymatics),
 *  ink on water (marbling), sound in water (echolocation) and chemistry growing
 *  form (reaction–diffusion); the depth series (V3.3) is the stateful tier —
 *  an agent colony that draws itself (physarum), a raymarched volume (trench)
 *  and a video-feedback echo (undertow). A 2026-07 review culled the four
 *  weakest modules (signal, swarm, beams, akten); unknown ids in saved patches
 *  fall back to oceanicField below. N = 23, all studio-selectable. */
const FACTORIES: Record<string, VisualLayerFactory> = {
  oceanicField: createOceanicField,
  abyss: createAbyss,
  sunlitShallows: createSunlitShallows,
  thermocline: createThermocline,
  twilightZone: createTwilightZone,
  midnightZone: createMidnightZone,
  abyssalPlain: createAbyssalPlain,
  // the artist series — ids name the artist each family is translated from
  molnar: createMolnar, // Vera Molnár — plotter grid, controlled disorder
  hobbs: createHobbs, // Tyler Hobbs — flow-field strokes (Fidenza)
  naon: createNaon, // Manolo Gamboa Naon — saturated packed geometry
  crespo: createCrespo, // Sofia Crespo — imagined marine organism
  anadol: createAnadol, // Refik Anadol — data sculpture in a slab
  henke: createHenke, // Robert Henke — laser figure (Lumière)
  lemercier: createLemercier, // Joanie Lemercier — projected landform
  rickards: createRickards, // Paul Rickards — moiré interference gratings
  asendorf: createAsendorf, // Kim Asendorf — pixel sorting
  // the phenomena series — ids name the process each family is translated from
  chladni: createChladni, // Chladni figures — sand on a bowed plate
  suminagashi: createSuminagashi, // suminagashi — ink rings combed on still water
  sonar: createSonar, // echolocation — a phosphor sweep and what answers it
  reef: createReef, // Gray–Scott reaction–diffusion — a grown, remembering reef
  // the depth series — stateful worlds: simulation, volume, memory
  physarum: createPhysarum, // slime-mould colony — 25k agents drawing one organism
  trench: createTrench, // raymarched volume — a descent with true depth
  undertow: createUndertow, // video feedback — the frame remembering itself
};

export function createLayer(moduleId: string): VisualLayer {
  const factory = FACTORIES[moduleId] ?? createOceanicField;
  return factory();
}

/** All registered visual-module ids — for the studio's per-scene module picker. */
export const VISUAL_MODULE_IDS: readonly string[] = Object.keys(FACTORIES);

export type { VisualLayer, VisualLayerFactory } from './types';
