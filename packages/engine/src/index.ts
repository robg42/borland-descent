/**
 * Public surface of the framework-agnostic Borland engine. Depends only on
 * tone, three and zod — never React or Vite (enforced by package.json + ESLint).
 */

// Core
export { Engine } from './core/engine';
export type { EngineOptions, Disposable } from './core/types';
export { Transport } from './core/transport';
export { VisualEngine } from './visual/visualEngine';

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
export { JsonPatchStore, parsePatchOrDefault } from './patch/store';
export type { PatchStore, JsonPatchStoreOptions } from './patch/store';
