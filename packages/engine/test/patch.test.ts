import { describe, expect, it } from 'vitest';
import { safeValidatePatch, validatePatch } from '../src/patch/schema';
import { defaultPatch } from '../src/patch/default';
import { parsePatchOrDefault } from '../src/patch/store';
import { migratePatch, CURRENT_PATCH_VERSION } from '../src/patch/migrate';
import borland from '../../../patches/borland.json';

describe('patch document', () => {
  it('validates the canonical seed patch', () => {
    expect(() => validatePatch(borland)).not.toThrow();
  });

  it('validates the bundled default patch', () => {
    expect(() => validatePatch(defaultPatch)).not.toThrow();
  });

  it('round-trips the seed patch losslessly (normalised)', () => {
    const parsed = validatePatch(borland);
    const reparsed = validatePatch(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed).toEqual(parsed);
  });

  it('fills documented defaults on parse', () => {
    const parsed = validatePatch(borland);
    expect(parsed.modulationMatrix[0]?.enabled).toBe(true);
    expect(parsed.scenes[0]?.transition.kind).toBe('crossfade');
  });

  it('falls back to the default on invalid input', () => {
    expect(parsePatchOrDefault({ nonsense: true })).toEqual(defaultPatch);
    expect(safeValidatePatch({}).success).toBe(false);
  });

  it('rejects a malformed PortRef in a route', () => {
    const bad = structuredClone(borland) as typeof borland;
    const route = bad.modulationMatrix[0];
    expect(route).toBeDefined();
    if (route) route.source = 'no-dot-here';
    expect(safeValidatePatch(bad).success).toBe(false);
  });
});

describe('patch migration (v1 → v2)', () => {
  it('lifts a v1 document (no sequences) to the current version', () => {
    const v1 = structuredClone(borland) as Record<string, unknown>;
    (v1.meta as Record<string, unknown>).version = 1;
    delete v1.sequences;
    const migrated = migratePatch(v1) as {
      meta: { version: number };
      sequences: unknown[];
      presets: unknown[];
    };
    expect(migrated.meta.version).toBe(CURRENT_PATCH_VERSION);
    expect(migrated.sequences).toEqual([]);
    expect(migrated.presets).toEqual([]);
    expect(safeValidatePatch(migrated).success).toBe(true);
  });

  it('is idempotent on a current document and passes through junk untouched', () => {
    expect(migratePatch(structuredClone(borland))).toEqual(structuredClone(borland));
    expect(migratePatch(null)).toBeNull();
    expect(migratePatch({ nonsense: true })).toEqual({ nonsense: true });
  });

  it('parsePatchOrDefault migrates before validating', () => {
    const v1 = structuredClone(borland) as Record<string, unknown>;
    (v1.meta as Record<string, unknown>).version = 1;
    delete v1.sequences;
    const parsed = parsePatchOrDefault(v1);
    expect(parsed.meta.version).toBe(CURRENT_PATCH_VERSION);
    expect(parsed.sequences).toEqual([]);
  });
});
