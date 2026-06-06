import { describe, expect, it } from 'vitest';
import { safeValidatePatch, validatePatch } from '../src/patch/schema';
import { defaultPatch } from '../src/patch/default';
import { parsePatchOrDefault } from '../src/patch/store';
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
