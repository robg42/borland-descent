import type { Dna, SceneAudioParams } from '../../patch/types';
import type { Rng } from '../../core/rng';
import { degreeToMidi } from '../../core/music';

/**
 * The generative composer's DECISION logic — pure and deterministic (seeded RNG in,
 * decisions out). Separated from Tone scheduling so it can be unit-tested headlessly
 * (this is the testable surface the CI smoke test exercises in Phase 2).
 *
 * The DNA motif intervals drive a scale-degree walk; the arc-driven density gates
 * how busy the pad is; the bass anchors the bar, tight and dry.
 */
export interface ComposerState {
  step: number;
  motifIndex: number;
  degree: number;
  lastPadStep: number;
}

export interface NoteDecision {
  voice: 'pad' | 'bass';
  midi: number;
  durationSteps: number;
  velocity: number;
  /** Laid-back timing humanisation (seconds), added at scheduling. Small & positive. */
  timeOffsetSec: number;
}

export function initComposerState(): ComposerState {
  return { step: 0, motifIndex: 0, degree: 0, lastPadStep: -999 };
}

const PAD_OCTAVE_BASE = 60;
const DUR_CHOICES = [2, 3, 4, 6];

/**
 * Deterministic [0,1) jitter from an integer step — humanises timing and velocity
 * WITHOUT drawing from the seeded compositional RNG, so the note stream itself is
 * unchanged (same melody and rhythm, just a looser feel). Boards of Canada sits a hair
 * behind the grid, so callers use it for small, always-positive offsets — laid-back,
 * never early, which also keeps scheduling safely in the transport's future.
 */
function jitter(step: number): number {
  const x = Math.sin(step * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function decideStep(args: {
  dna: Dna;
  scene: SceneAudioParams;
  density: number;
  rng: Rng;
  state: ComposerState;
}): NoteDecision[] {
  const { dna, scene, density, rng, state } = args;
  const out: NoteDecision[] = [];
  const sub = scene.rhythm.subdivision;
  const scale = scene.scale.length > 0 ? scene.scale : dna.rootPitchClasses;
  const dens = Math.min(1, Math.max(0, density));

  // Bass anchors the bar (tight, dry).
  const barSteps = Math.max(1, sub * 2);
  if (scene.bass.enabled && state.step % barSteps === 0) {
    const pc = scene.bass.anchorPc ?? dna.keyCentre;
    out.push({
      voice: 'bass',
      midi: scene.bass.register + pc,
      durationSteps: barSteps,
      velocity: 0.8 + jitter(state.step * 7 + 1) * 0.12,
      timeOffsetSec: jitter(state.step * 7 + 2) * 0.008, // bass stays tight to the bar
    });
  }

  // Pad: probabilistic on density, gated by minGapSteps, walking the DNA motif.
  const gap = state.step - state.lastPadStep;
  if (gap >= scene.rhythm.minGapSteps && rng.chance(0.25 + 0.6 * dens)) {
    const motif = dna.motif.intervals;
    const stepInterval = motif.length > 0 ? (motif[state.motifIndex % motif.length] ?? 0) : 0;
    let degree = state.degree + stepInterval;
    if (degree > 10) degree -= 7;
    if (degree < -3) degree += 7;
    const midi = degreeToMidi(degree, scale, dna.keyCentre, PAD_OCTAVE_BASE);
    const durationSteps = DUR_CHOICES[rng.int(0, DUR_CHOICES.length - 1)] ?? 3;
    const velocity = 0.4 + rng.float() * 0.3;
    out.push({
      voice: 'pad',
      midi,
      durationSteps,
      velocity,
      timeOffsetSec: jitter(state.step * 13 + 5) * 0.025, // pad drags a touch, laid-back
    });
    state.degree = degree;
    state.motifIndex++;
    state.lastPadStep = state.step;
  }

  state.step++;
  return out;
}
