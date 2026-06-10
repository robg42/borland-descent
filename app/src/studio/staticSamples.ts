import { sampleStore } from '@borland/engine';

interface ManifestSample {
  /** Relative path from the samples root, e.g. "choir/C3.wav". */
  path: string;
  /** Display name shown in the samples panel. */
  name: string;
  /** MIDI note the sample is tuned to (0–127; 60 = middle C). */
  rootMidi: number;
}

interface Manifest {
  version: number;
  samples: ManifestSample[];
}

export interface LoadLibraryResult {
  loaded: number;
  skipped: number;
  failed: string[];
}

/**
 * Fetch app/public/samples/manifest.json, then load every listed file into the
 * runtime sampleStore (persisted to IndexedDB). Files already in the store are
 * skipped (matched by name). Returns a summary of what happened.
 *
 * To add your own samples:
 *   1. Drop the audio file into the appropriate subfolder in app/public/samples/
 *   2. Add an entry to app/public/samples/manifest.json:
 *      { "path": "choir/C3.wav", "name": "Choir C3", "rootMidi": 48 }
 */
export async function loadStaticLibrary(
  base = `${import.meta.env.BASE_URL}samples/`,
): Promise<LoadLibraryResult> {
  const manifestRes = await fetch(`${base}manifest.json`);
  if (!manifestRes.ok) throw new Error(`Could not fetch sample manifest (${manifestRes.status})`);
  const manifest = (await manifestRes.json()) as Manifest;

  const existing = new Set(sampleStore.list().map((s) => s.name));
  const result: LoadLibraryResult = { loaded: 0, skipped: 0, failed: [] };

  for (const entry of manifest.samples) {
    if (existing.has(entry.name)) {
      result.skipped++;
      continue;
    }
    try {
      const fileRes = await fetch(`${base}${entry.path}`);
      if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`);
      const bytes = await fileRes.arrayBuffer();
      await sampleStore.add(entry.name, entry.rootMidi, bytes);
      result.loaded++;
    } catch (err) {
      result.failed.push(`${entry.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}
