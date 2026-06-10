import { describe, expect, it } from 'vitest';
import {
  bandEnergy,
  createOnsetState,
  dbToLinear,
  envelopeStep,
  logBandEdges,
  onsetStep,
  spectralFlux,
} from '../src/audio/features';

/**
 * The V2 audio-feature maths is pure (arrays in, numbers out), so the CI gate
 * proves the analysis layer headlessly: band layout, flux directionality,
 * envelope asymmetry, and one-event-one-trigger onset behaviour.
 */

describe('features — log band edges', () => {
  it('produces strictly increasing integer edges spanning the requested bins', () => {
    const edges = logBandEdges(8, 1, 48);
    expect(edges).toHaveLength(9);
    expect(edges[0]).toBeGreaterThanOrEqual(1);
    expect(edges[8]).toBe(48);
    for (let i = 1; i < edges.length; i++) expect(edges[i]!).toBeGreaterThan(edges[i - 1]!);
    // log spacing: the top band is wider than the bottom band
    expect(edges[8]! - edges[7]!).toBeGreaterThan(edges[1]! - edges[0]!);
  });
});

describe('features — band energy', () => {
  it('reads 0 on silence and caps at 1', () => {
    const silent = new Float32Array(64);
    expect(bandEnergy(silent, 1, 8)).toBe(0);
    const loud = new Float32Array(64).fill(1);
    expect(bandEnergy(loud, 1, 8)).toBe(1);
  });

  it('measures only its own bins', () => {
    const mags = new Float32Array(64);
    mags[2] = 0.25;
    mags[3] = 0.25;
    expect(bandEnergy(mags, 2, 4, 4)).toBeCloseTo(1, 5); // sqrt(0.25 * 4)
    expect(bandEnergy(mags, 8, 16, 4)).toBe(0);
  });
});

describe('features — spectral flux', () => {
  it('spikes on rising energy and stays 0 on falling energy', () => {
    const quiet = new Float32Array(64);
    const loud = new Float32Array(64).fill(0.1);
    expect(spectralFlux(loud, quiet)).toBeCloseTo(0.8, 5); // (0.1·64/64)·8
    expect(spectralFlux(quiet, loud)).toBe(0); // half-wave rectified
  });
});

describe('features — envelope follower', () => {
  it('attacks faster than it releases', () => {
    const up = envelopeStep(0, 1, 0.02, 0.02, 0.25);
    expect(up).toBeCloseTo(1 - Math.exp(-1), 3);
    const down = envelopeStep(1, 0, 0.02, 0.02, 0.25);
    expect(1 - down).toBeLessThan(up); // the drop is smaller than the rise
  });
});

describe('features — onset detection', () => {
  it('fires once per burst, honours the refractory period, and adapts', () => {
    const state = createOnsetState();
    // settle a quiet floor into the history
    for (let i = 0; i < 10; i++) expect(onsetStep(state, 0.01, 0.016)).toBe(0);
    // a burst over the adaptive threshold fires exactly once
    expect(onsetStep(state, 0.5, 0.016)).toBe(1);
    expect(onsetStep(state, 0.5, 0.016)).toBe(0); // refractory
    // after the refractory window, a fresh louder burst fires again
    for (let i = 0; i < 10; i++) onsetStep(state, 0.01, 0.03);
    expect(onsetStep(state, 1.0, 0.016)).toBe(1);
  });
});

describe('features — dB conversion', () => {
  it('flushes silence to zero and maps 0 dB to 1', () => {
    expect(dbToLinear(-Infinity)).toBe(0);
    expect(dbToLinear(-100)).toBe(0);
    expect(dbToLinear(0)).toBe(1);
    expect(dbToLinear(-20)).toBeCloseTo(0.1, 5);
  });
});
