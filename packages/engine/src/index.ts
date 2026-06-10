/**
 * Public surface of the framework-agnostic Borland engine. Depends only on
 * tone, three and zod — never React or Vite (enforced by package.json + ESLint).
 */

// Core
export { Engine } from './core/engine';
export type { EngineOptions, Disposable } from './core/types';
export { Transport } from './core/transport';
export type { TransportClock, TransportState, TransportPosition } from './core/transport';
export { smoothWrite } from './core/params';
export type { SmoothableParam } from './core/params';
export { VisualEngine } from './visual/visualEngine';

// Sequencer contract (Workstream A implements core/scheduler against these)
export type {
  SequencerEvent,
  SequencerNoteEvent,
  SequencerPortEvent,
  SequenceWindowContext,
  EventsInWindow,
} from './sequencer/types';

// Audio context lifecycle
export { unlockAudio, resumeAudio, isAudioRunning, audioContextState } from './audio/context';

// Seeded RNG
export { Rng, createRng, mulberry32, hashStringToSeed } from './core/rng';

// Ports
export { makePortRef, parsePortRef, isCompatible, clampToKind, PORT_KINDS } from './core/ports';
export type { PortKind, PortRef, PortDef, PortDirection } from './core/ports';
export type { InputPortInfo, OutputPortInfo } from './core/registry';

// Patch document
export { PatchSchema, validatePatch, safeValidatePatch } from './patch/schema';
export type { PatchValidation } from './patch/schema';
export * from './patch/types';
export { defaultPatch } from './patch/default';
export { migratePatch, CURRENT_PATCH_VERSION } from './patch/migrate';
export { JsonPatchStore, parsePatchOrDefault } from './patch/store';
export type { PatchStore, JsonPatchStoreOptions } from './patch/store';

// User samples (runtime store, persisted to IndexedDB; referenced from the Patch by id)
export { sampleStore, previewSample } from './audio/sampleStore';
export type { SampleMeta, SampleEntry } from './audio/sampleStore';

// Resynthesis — offline transforms (PaulStretch, granular) that turn a sample into a
// new derived sample (time-stretch / granulise / extreme smear). Dependency-free DSP.
export { resynthesizeSample } from './audio/resynthesis';
export type { ResynthSpec } from './audio/resynthesis';

// Synth-module ids (for the studio's per-scene voice picker)
export { SYNTH_MODULE_IDS } from './audio/synths';
