import type { Patch } from './types';

/**
 * The bundled fallback Patch. The player degrades to this if patches/borland.json
 * is missing or invalid (brief §15), so the experience always runs. Deliberately
 * minimal: empty graphs, one full-range scene.
 */
export const defaultPatch: Patch = {
  meta: {
    id: 'default',
    name: 'Borland — bundled default',
    version: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    seed: 1,
  },
  dna: {
    rootPitchClasses: [0, 3, 5, 7, 10],
    keyCentre: 0,
    tempoRange: [56, 68],
    motif: { intervals: [0, 3, -2, 4], rhythm: [4, 2, 2, 8], subdivision: 4 },
    arc: [
      {
        position: 0,
        macros: {
          darkness: 0.2,
          rhythmicWeight: 0.2,
          reverbSize: 0.7,
          filterPosition: 0.6,
          dissonance: 0.1,
          density: 0.3,
        },
      },
      {
        position: 1,
        macros: {
          darkness: 0.9,
          rhythmicWeight: 0.8,
          reverbSize: 0.9,
          filterPosition: 0.3,
          dissonance: 0.6,
          density: 0.7,
        },
      },
    ],
  },
  scenes: [
    {
      id: 'fallback',
      name: 'Fallback',
      arcRange: [0, 1],
      synthModuleId: 'driftPad',
      shaderModuleId: 'oceanicField',
      audioParams: {
        scale: [0, 3, 5, 7, 10],
        harmonicGuardrails: {},
        density: 0.3,
        rhythm: { subdivision: 4, minGapSteps: 2 },
        bass: { enabled: true, register: 36 },
        reverbSize: 0.7,
        voices: { maxPolyphony: 8 },
      },
      visualParams: {},
      gestureMap: [],
      transition: { kind: 'none', durationSec: 0 },
    },
  ],
  audioGraph: { nodes: [], connections: [] },
  visualGraph: { layers: [], postChain: [] },
  modulationMatrix: [],
  sequences: [],
  presets: [],
};
