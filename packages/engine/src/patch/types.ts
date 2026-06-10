/**
 * Patch document types. These are inferred from the zod schemas (./schema), which
 * are canonical — editing the schema updates the types automatically.
 */
export type {
  Patch,
  PatchMeta,
  Dna,
  SeedMotif,
  ArcMacros,
  ArcKeyframe,
  AudioGraphNode,
  AudioConnection,
  AudioGraph,
  VisualGraphNode,
  VisualGraph,
  ModulationRoute,
  Sequence,
  SequenceStep,
  SequenceTarget,
  GestureBinding,
  SceneAudioParams,
  SceneTransition,
  Scene,
} from './schema';

import type {
  AudioGraphNode,
  VisualGraphNode,
  ModulationRoute,
  GestureBinding,
} from './schema';

// Convenient derived unions.
export type AudioNodeKind = AudioGraphNode['kind'];
export type VisualNodeKind = VisualGraphNode['kind'];
export type RouteRate = ModulationRoute['rate'];
export type CurveKind = ModulationRoute['curve'];
export type BlendMode = NonNullable<VisualGraphNode['blendMode']>;
export type GestureKind = GestureBinding['gesture'];
