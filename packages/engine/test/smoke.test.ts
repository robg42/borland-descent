import { describe, expect, it } from 'vitest';
import { validatePatch } from '../src/patch/schema';
import { Rng } from '../src/core/rng';
import { decideStep, initComposerState } from '../src/audio/composer/decide';
import { evaluateControlTargets } from '../src/modulation/evaluate';
import { macrosAt } from '../src/core/arc';
import { bpmAt } from '../src/core/music';
import { applyCurve } from '../src/core/curves';
import type { CurveKind } from '../src/patch/types';
import borland from '../../../patches/borland.json';

const isFinite_ = (n: number): boolean => Number.isFinite(n);
const CURVES: CurveKind[] = ['linear', 'exp', 'log', 'sCurve', 'invert'];

/**
 * The headless smoke test (CI gate, brief §7/§13). jsdom can't run Web Audio/WebGL,
 * so this boots the engine's PURE-LOGIC core — the generative composer, matrix
 * evaluation, arc interpolation and curves — advances it, and asserts no exceptions
 * plus finite, in-range values. This is the genuinely-testable surface the
 * audio/visual-behind-interfaces architecture creates.
 */
describe('headless smoke — pure-logic boot', () => {
  const patch = validatePatch(borland);

  it('the seed patch has a multi-scene arc of structurally different scenes', () => {
    expect(patch.scenes.length).toBeGreaterThanOrEqual(2);
    // every scene selects a distinct synth + shader MODULE — the descent is built from
    // structurally different worlds, not parameter variations of one.
    const synths = new Set(patch.scenes.map((s) => s.synthModuleId));
    const shaders = new Set(patch.scenes.map((s) => s.shaderModuleId));
    expect(synths.size).toBe(patch.scenes.length);
    expect(shaders.size).toBe(patch.scenes.length);
  });

  it('the scenes tile the arc [0,1] contiguously, in order', () => {
    const ranges = patch.scenes.map((s) => s.arcRange);
    expect(ranges[0]?.[0]).toBe(0);
    expect(ranges[ranges.length - 1]?.[1]).toBe(1);
    for (let i = 0; i < ranges.length; i++) {
      const [lo, hi] = ranges[i]!;
      expect(hi).toBeGreaterThan(lo); // each scene occupies a non-empty slice
      if (i > 0) expect(lo).toBeCloseTo(ranges[i - 1]![1], 6); // no gaps or overlaps
    }
  });

  it('the composer runs for every scene without throwing, yielding finite in-range notes', () => {
    for (const scene of patch.scenes) {
      const rng = new Rng(patch.meta.seed);
      const state = initComposerState();
      let produced = 0;
      for (let step = 0; step < 512; step++) {
        const density = macrosAt(patch.dna.arc, step / 512).density;
        const notes = decideStep({ dna: patch.dna, scene: scene.audioParams, density, rng, state });
        expect(state.activePad.length).toBeLessThanOrEqual(scene.audioParams.voices.maxPolyphony);
        for (const note of notes) {
          produced++;
          expect(isFinite_(note.midi)).toBe(true);
          expect(note.midi).toBeGreaterThanOrEqual(0);
          expect(note.midi).toBeLessThanOrEqual(127);
          expect(note.durationSteps).toBeGreaterThan(0);
          expect(note.velocity).toBeGreaterThanOrEqual(0);
          expect(note.velocity).toBeLessThanOrEqual(1);
        }
      }
      expect(produced).toBeGreaterThan(0); // the scene actually generates material
    }
  });

  it('the arc-mapped tempo spans the DNA range, fast at the surface', () => {
    const range = patch.dna.tempoRange;
    expect(bpmAt(range, 0)).toBe(range[1]); // surface = top of the range
    expect(bpmAt(range, 1)).toBe(range[0]); // the deep = its floor
    expect(bpmAt(range, 0.5)).toBeCloseTo((range[0] + range[1]) / 2);
    expect(bpmAt(range, -3)).toBe(range[1]); // clamped outside [0,1]
    expect(bpmAt(range, 7)).toBe(range[0]);
  });

  it('arc macros are finite and in [0,1] across the whole arc', () => {
    for (let i = 0; i <= 100; i++) {
      const macros = macrosAt(patch.dna.arc, i / 100);
      for (const value of Object.values(macros)) {
        expect(isFinite_(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('matrix control evaluation yields finite targets for the patch routes', () => {
    const bases = new Map<string, number>();
    for (const route of patch.modulationMatrix) bases.set(route.target, 1000);
    const targets = evaluateControlTargets(
      patch.modulationMatrix,
      () => 0.5, // mock source reading
      (ref) => bases.get(ref),
    );
    for (const [, value] of targets) expect(isFinite_(value)).toBe(true);
  });

  it('curves stay finite across the input range', () => {
    for (const curve of CURVES) {
      for (let x = -1; x <= 1.0001; x += 0.05) {
        expect(isFinite_(applyCurve(x, curve))).toBe(true);
      }
    }
  });
});

describe('seeded determinism', () => {
  const patch = validatePatch(borland);

  const run = (): number[] => {
    const rng = new Rng(patch.meta.seed);
    const state = initComposerState();
    const scene = patch.scenes[0]!;
    const stream: number[] = [];
    for (let step = 0; step < 256; step++) {
      const notes = decideStep({
        dna: patch.dna,
        scene: scene.audioParams,
        density: 0.5,
        rng,
        state,
      });
      for (const note of notes) {
        stream.push(note.midi, note.durationSteps, Math.round(note.velocity * 1e6));
      }
    }
    return stream;
  };

  it('the same seed reproduces an identical decision stream', () => {
    expect(run()).toEqual(run());
  });

  it('a different seed diverges', () => {
    const a = run();
    const rng = new Rng(patch.meta.seed + 1);
    const state = initComposerState();
    const scene = patch.scenes[0]!;
    const b: number[] = [];
    for (let step = 0; step < 256; step++) {
      const notes = decideStep({ dna: patch.dna, scene: scene.audioParams, density: 0.5, rng, state });
      for (const note of notes) b.push(note.midi, note.durationSteps, Math.round(note.velocity * 1e6));
    }
    expect(a).not.toEqual(b);
  });
});
