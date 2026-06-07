import { z } from 'zod';

/**
 * The Patch document — the single source of truth (brief §2/§5). Schema-first:
 * the zod schemas below are canonical and the TypeScript types in ./types are
 * inferred from them, so they can never drift.
 *
 * Forward-compatibility: the top level is a loose object (tolerates unknown future
 * fields), `meta.version` carries the document schema version, and new fields use
 * `.default()` so older patches still load. Defaults are forward-direction only.
 */

// ---- primitives ----------------------------------------------------------------
const pitchClass = z.number().int().min(0).max(11);
const unipolar = z.number().min(0).max(1);
const bipolar = z.number().min(-1).max(1);
const scalar = z.union([z.number(), z.array(z.number())]); // vector ports carry number[]

const idSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, 'id must match [A-Za-z0-9_-]+ (no dots)');

/** A stable address "nodeId.portName" (ids are dot-free, so the dot is unambiguous). */
const portRefSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'PortRef must be "nodeId.portName"');

// ---- meta ----------------------------------------------------------------------
export const PatchMetaSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  version: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  seed: z.number().int(),
});

// ---- shared musical DNA --------------------------------------------------------
export const ArcMacrosSchema = z.object({
  darkness: unipolar,
  rhythmicWeight: unipolar,
  reverbSize: unipolar,
  filterPosition: unipolar,
  dissonance: unipolar,
  density: unipolar,
});
export const ArcKeyframeSchema = z.object({
  position: unipolar,
  macros: ArcMacrosSchema,
});
export const SeedMotifSchema = z.object({
  intervals: z.array(z.number().int()),
  rhythm: z.array(z.number().positive()),
  subdivision: z.number().int().positive(),
});
export const DnaSchema = z.object({
  rootPitchClasses: z.array(pitchClass).min(1),
  keyCentre: pitchClass,
  tempoRange: z.tuple([z.number().positive(), z.number().positive()]),
  motif: SeedMotifSchema,
  arc: z.array(ArcKeyframeSchema).min(2), // models the WHOLE 0..1 range
});

// ---- audio graph (nodes carry VALUES; port DEFS live in the engine registry) ---
export const AudioNodeSchema = z.object({
  id: idSchema,
  kind: z.enum(['master', 'bus', 'synthModule', 'composer', 'effect', 'analyser', 'lfo']),
  moduleId: z.string().optional(),
  params: z.record(z.string(), scalar).default({}),
});
export const AudioConnectionSchema = z.object({
  from: idSchema,
  to: idSchema,
  gain: z.number().optional(),
});
export const AudioGraphSchema = z.object({
  nodes: z.array(AudioNodeSchema).default([]),
  connections: z.array(AudioConnectionSchema).default([]),
});

// ---- visual graph --------------------------------------------------------------
export const VisualNodeSchema = z.object({
  id: idSchema,
  kind: z.enum(['layer', 'postfx', 'camera']),
  moduleId: z.string().optional(),
  blendMode: z.enum(['normal', 'add', 'screen', 'multiply']).optional(),
  opacity: unipolar.optional(),
  params: z.record(z.string(), scalar).default({}),
});
export const VisualGraphSchema = z.object({
  layers: z.array(VisualNodeSchema).default([]), // order = composite order
  postChain: z.array(VisualNodeSchema).default([]), // order = post-processing order
});

// ---- modulation matrix ---------------------------------------------------------
export const ModulationRouteSchema = z.object({
  id: idSchema,
  source: portRefSchema, // an OUTPUT port
  target: portRefSchema, // an INPUT port
  amount: bipolar,
  curve: z.enum(['linear', 'exp', 'log', 'sCurve', 'invert']).default('linear'),
  smoothing: z.number().min(0).default(50), // ms, control-rate
  rate: z.enum(['control', 'audio']).default('control'),
  enabled: z.boolean().default(true),
});

// ---- gesture -------------------------------------------------------------------
export const GestureBindingSchema = z.object({
  gesture: z.enum(['zoomDepth', 'touchX', 'touchY', 'dragVelocity', 'pressure', 'multiTouch']),
  output: portRefSchema,
});

// ---- scenes --------------------------------------------------------------------
export const SceneAudioParamsSchema = z.object({
  scale: z.array(z.number().int()),
  harmonicGuardrails: z
    .object({
      allowedIntervals: z.array(z.number().int()).optional(),
      maxDissonance: unipolar.optional(),
    })
    .default({}),
  density: unipolar,
  rhythm: z.object({
    subdivision: z.number().int().positive(),
    minGapSteps: z.number().int().nonnegative().default(0),
    maxVoicesPerBar: z.number().int().positive().optional(),
  }),
  bass: z.object({
    enabled: z.boolean().default(true),
    register: z.number().int(), // MIDI-ish register anchor
    anchorPc: pitchClass.optional(),
  }),
  reverbSize: unipolar,
  voices: z.object({ maxPolyphony: z.number().int().positive() }), // applied to the scene's polyphonic synth
});
export const SceneTransitionSchema = z.object({
  kind: z.enum(['crossfade', 'morph', 'none']).default('none'),
  durationSec: z.number().nonnegative().default(0),
  revealNextEdges: z.boolean().optional(),
});
export const SceneSchema = z.object({
  id: idSchema,
  name: z.string(),
  arcRange: z.tuple([unipolar, unipolar]), // slice of 0..1 this scene occupies
  synthModuleId: z.string(), // STRUCTURAL: which synth module
  shaderModuleId: z.string(), // STRUCTURAL: which shader module
  audioParams: SceneAudioParamsSchema,
  visualParams: z.record(z.string(), scalar).default({}),
  gestureMap: z.array(GestureBindingSchema).default([]),
  transition: SceneTransitionSchema.default({ kind: 'none', durationSec: 0 }),
});

// ---- the Patch -----------------------------------------------------------------
export const PatchSchema = z.looseObject({
  meta: PatchMetaSchema,
  dna: DnaSchema,
  scenes: z.array(SceneSchema).min(1),
  audioGraph: AudioGraphSchema,
  visualGraph: VisualGraphSchema,
  modulationMatrix: z.array(ModulationRouteSchema).default([]),
});

// ---- inferred types (canonical) ------------------------------------------------
export type Patch = z.infer<typeof PatchSchema>;
export type PatchMeta = z.infer<typeof PatchMetaSchema>;
export type Dna = z.infer<typeof DnaSchema>;
export type SeedMotif = z.infer<typeof SeedMotifSchema>;
export type ArcMacros = z.infer<typeof ArcMacrosSchema>;
export type ArcKeyframe = z.infer<typeof ArcKeyframeSchema>;
export type AudioGraphNode = z.infer<typeof AudioNodeSchema>;
export type AudioConnection = z.infer<typeof AudioConnectionSchema>;
export type AudioGraph = z.infer<typeof AudioGraphSchema>;
export type VisualGraphNode = z.infer<typeof VisualNodeSchema>;
export type VisualGraph = z.infer<typeof VisualGraphSchema>;
export type ModulationRoute = z.infer<typeof ModulationRouteSchema>;
export type GestureBinding = z.infer<typeof GestureBindingSchema>;
export type SceneAudioParams = z.infer<typeof SceneAudioParamsSchema>;
export type SceneTransition = z.infer<typeof SceneTransitionSchema>;
export type Scene = z.infer<typeof SceneSchema>;

/** A port value: a scalar or a vector (vector ports carry number[]). */
export type Scalar = number | number[];

// ---- validation ----------------------------------------------------------------
export function validatePatch(input: unknown): Patch {
  return PatchSchema.parse(input);
}

export type PatchValidation =
  | { success: true; patch: Patch }
  | { success: false; error: z.ZodError };

export function safeValidatePatch(input: unknown): PatchValidation {
  const result = PatchSchema.safeParse(input);
  return result.success
    ? { success: true, patch: result.data }
    : { success: false, error: result.error };
}
