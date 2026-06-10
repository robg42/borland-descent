import type { Patch } from './types';
import { safeValidatePatch } from './schema';
import { defaultPatch } from './default';
import { migratePatch } from './migrate';

/**
 * Persistence seam (brief §12). v1 ships JsonPatchStore; a reactive backend
 * (Convex) later implements the same interface and nothing in the engine or
 * studio changes. `list`/`subscribe` are stubs the backend will fill.
 */
export interface PatchStore {
  load(): Promise<Patch>;
  save(patch: Patch): Promise<void>;
  list?(): Promise<string[]>;
  subscribe?(onChange: (patch: Patch) => void): () => void;
}

/** Migrate + validate unknown input, falling back to the bundled default (graceful degrade). */
export function parsePatchOrDefault(input: unknown): Patch {
  const result = safeValidatePatch(migratePatch(input));
  if (result.success) return result.patch;
  console.warn('[borland] Patch invalid — falling back to bundled default.', result.error);
  return defaultPatch;
}

export interface JsonPatchStoreOptions {
  /** URL the canonical patch is fetched from (served from /patches as /borland.json). */
  url?: string;
}

/** Reads the canonical patch over HTTP; export/import (download) is handled in the studio. */
export class JsonPatchStore implements PatchStore {
  private readonly url: string;

  constructor(opts: JsonPatchStoreOptions = {}) {
    this.url = opts.url ?? '/borland.json';
  }

  async load(): Promise<Patch> {
    try {
      const res = await fetch(this.url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: unknown = await res.json();
      return parsePatchOrDefault(json);
    } catch (err) {
      console.warn('[borland] Could not load patch — using bundled default.', err);
      return defaultPatch;
    }
  }

  async save(_patch: Patch): Promise<void> {
    // v1 has no backend: saving is a browser download in the studio (PatchIO),
    // committed to patches/borland.json via git.
    throw new Error('JsonPatchStore.save is unsupported in v1 — use the studio export.');
  }
}
