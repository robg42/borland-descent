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
  // models the WHOLE 0..1 range; keyframes must be strictly ascending so macrosAt
  // (which assumes a sorted arc) can never silently mis-interpolate an import.
  arc: z
    .array(ArcKeyframeSchema)
    .min(2)
    .refine((ks) => ks.every((k, i) => i === 0 || k.position > ks[i - 1]!.position), {
      message: 'arc keyframes must be ordered by strictly ascending position',
    }),
});

// ---- audio graph (nodes carry VALUES; port DEFS live in the engine registry) ---
export const AudioNodeSchema = z.object({
  id: idSchema,
  kind: z.enum(['master', 'bus', 'synthModule', 'composer', 'effect', 'analyser', 'lfo']),
  moduleId: z.string().optional(),
  params: z.record(z.string(), scalar).default({}),
  // For sampler voices: the user-loaded sample this node plays. Only an id reference —
  // the audio binary lives in the runtime SampleStore (IndexedDB), never in the JSON.
  sampleId: z.string().optional(),
  // For a convolution-reverb node: a URL/path to a real impulse response (e.g. an Open
  // AIR cathedral WAV). Loaded into Tone.Convolver; absent → a generated hall IR is used.
  ir: z.string().optional(),
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

// ---- sequences (schema v2) -------------------------------------------------------
// A sequence is authored state like any route: serialised here, rendered by the
// engine's sequencer against the shared transport. Notes quantise through the
// active scene's scale/keyCentre; port tracks write through the same SignalInput
// path the matrix uses. Steps are plain arrays of small objects — git-diffable.
export const SequenceStepSchema = z.object({
  on: z.boolean().default(false),
  /** Scale degree relative to the scene's scale (notes targets). */
  degree: z.number().int().optional(),
  octave: z.number().int().min(-3).max(3).default(0),
  velocity: unipolar.default(0.8),
  probability: unipolar.default(1),
  /** Note length in steps (may exceed 1 to overlap; ties extend the previous note). */
  lengthSteps: z.number().positive().default(1),
  ratchet: z.number().int().min(1).max(4).default(1),
  tie: z.boolean().optional(),
  /** For port targets: the value this step emits. */
  value: z.number().optional(),
});
export const SequenceTargetSchema = z.discriminatedUnion('kind', [
  // an audioGraph synth node (e.g. 'voices' | 'bass') — extensible node ids
  z.object({ kind: z.literal('notes'), nodeId: idSchema }),
  // any modulatable input port; written via the registry like a matrix route
  z.object({ kind: z.literal('port'), port: portRefSchema }),
]);
export const SequenceSchema = z.object({
  id: idSchema,
  name: z.string().default(''),
  enabled: z.boolean().default(true),
  /** Scene-bound by default (runs/crossfades with its scene); absent = global. */
  sceneId: idSchema.optional(),
  /** Steps per beat (4 = semiquavers in 4/4). */
  division: z.number().int().positive().max(16).default(4),
  /** Steps per loop — variable per sequence. */
  length: z.number().int().min(1).max(64).default(16),
  swing: unipolar.default(0),
  humanizeMs: z.number().nonnegative().default(0),
  /** Default gate length as a fraction of one step. */
  gate: unipolar.default(0.8),
  target: SequenceTargetSchema,
  steps: z.array(SequenceStepSchema).default([]),
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
  sequences: z.array(SequenceSchema).default([]),
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
export type Sequence = z.infer<typeof SequenceSchema>;
export type SequenceStep = z.infer<typeof SequenceStepSchema>;
export type SequenceTarget = z.infer<typeof SequenceTargetSchema>;
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
