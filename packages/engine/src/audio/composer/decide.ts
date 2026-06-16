import type { Dna, SceneAudioParams } from '../../patch/types';
import type { Rng } from '../../core/rng';
import { degreeToMidi } from '../../core/music';

/**
 * The generative composer's DECISION logic — pure and deterministic (seeded RNG in,
 * decisions out). Separated from Tone scheduling so it can be unit-tested headlessly
 * (this is the testable surface the CI smoke test exercises in Phase 2).
 *
 * Musical structure (not just a random walk):
 *  - A slow HARMONIC CYCLE (i → VI → iv → v as scale degrees) advances with each
 *    bass note, so the piece breathes through real chord changes instead of sitting
 *    on a single tonic drone.
 *  - The bass voice-leads to the nearest chord root rather than leaping, and on the
 *    back half of a chord may add a quiet passing fifth — its likelihood scales with
 *    the arc's rhythmicWeight macro, so the low end gains intent as you descend.
 *  - The pad walks the DNA motif but is gravity-pulled toward chord tones; an
 *    8-bar PHRASE envelope arcs its velocity and thins notes near phrase ends
 *    (music that breathes, instead of uniform-random velocities forever).
 *  - Occasional DYADS thicken the pad, their interval drawn from the scene's
 *    harmonicGuardrails.allowedIntervals — pungent intervals only unlock as the
 *    arc's dissonance macro rises.
 *  - The pad register drops an octave in the deep half of the descent (darkness).
 *  - GROOVE: the DNA motif's `rhythm` array is its duration pattern (in steps), so
 *    the motif has a recurring rhythmic identity rather than dice-rolled lengths;
 *    quarter-grid steps are favoured (and lightly accented) over off-beats; and
 *    off-beat eighths sit a touch late — a gentle swung lilt that deepens with
 *    rhythmicWeight. Bass downbeats stay straight.
 */
export interface ComposerState {
  step: number;
  motifIndex: number;
  degree: number;
  lastPadStep: number;
  /** Free-step of each pad note still sounding (incl. its release tail) — the voice budget. */
  activePad: number[];
}

/** Arc macros the composer responds to (all default 0 — surface behaviour). */
export interface ComposerMacros {
  darkness: number;
  dissonance: number;
  rhythmicWeight: number;
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
  return { step: 0, motifIndex: 0, degree: 0, lastPadStep: -999, activePad: [] };
}

const PAD_OCTAVE_BASE = 60;
const DUR_SPARSE = [3, 4, 6, 8]; // low density: longer, fewer
const DUR_DENSE = [2, 3, 4, 6];
// Estimated release tail (steps) a pad note keeps sounding after its duration, so the
// voice budget counts notes still ringing. 12 (not 10): a 5 s release is 10 steps at
// 60 BPM but 11 at the tempo range's top, and the laid-back trigger offset adds a hair
// more — 10 was EXACTLY equal at 60 BPM, so notes still collided with releasing voices
// ("Max polyphony exceeded" in the console, audible cut-offs). Two steps of slack.
const PAD_TAIL_STEPS = 12;

/** The harmonic cycle as scale-degree roots: i → VI → iv → v in a 7-note scale.
 *  One chord per bass period; the full cycle spans the pad's 4-period phrase. */
const CHORD_CYCLE = [0, 5, 3, 4] as const;
/** Chord tones relative to the chord root, in scale degrees (the diatonic triad). */
const CHORD_TONES = [0, 2, 4] as const;

/** Dyad intervals (semitones) always available; pungent ones unlock with dissonance. */
const CONSONANT_DYADS = [3, 4, 7];

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
  macros?: ComposerMacros;
  /** Seconds per composer step (for swing offsets); the scheduler supplies it live. */
  stepSec?: number;
}): NoteDecision[] {
  const { dna, scene, density, rng, state } = args;
  const macros = args.macros ?? { darkness: 0, dissonance: 0, rhythmicWeight: 0 };
  const stepSec = args.stepSec ?? 0.25;
  const out: NoteDecision[] = [];
  const sub = scene.rhythm.subdivision;
  const scale = scene.scale.length > 0 ? scene.scale : dna.rootPitchClasses;
  const n = scale.length;
  const dens = Math.min(1, Math.max(0, density));

  // One bass period = two bars at the scene subdivision; one chord per period.
  const barSteps = Math.max(1, sub * 2);
  const chordIdx = Math.floor(state.step / barSteps) % CHORD_CYCLE.length;
  const chordRoot = CHORD_CYCLE[chordIdx]! % Math.max(1, n);
  // Voice-led pitch-class offset for the bass: take the chord root's scale semitones,
  // dropping anything above a fifth down an octave so the bass walks, never leaps.
  const rootSemis = scale[chordRoot] ?? 0;
  const bassOffset = rootSemis <= 7 ? rootSemis : rootSemis - 12;

  // Bass anchors the chord (tight, dry); weight rises with the descent.
  if (scene.bass.enabled && state.step % barSteps === 0) {
    const anchor = scene.bass.register + (scene.bass.anchorPc ?? dna.keyCentre);
    out.push({
      voice: 'bass',
      midi: Math.max(0, anchor + bassOffset),
      durationSteps: barSteps,
      velocity: Math.min(1, 0.72 + 0.16 * macros.rhythmicWeight + jitter(state.step * 7 + 1) * 0.1),
      timeOffsetSec: jitter(state.step * 7 + 2) * 0.008, // bass stays tight to the bar
    });
  }

  // A quiet passing fifth at the half-period — the low end gains motion with the
  // arc's rhythmicWeight, instead of one identical note forever.
  if (
    scene.bass.enabled &&
    state.step % barSteps === Math.floor(barSteps / 2) &&
    rng.chance(0.1 + 0.35 * macros.rhythmicWeight)
  ) {
    const anchor = scene.bass.register + (scene.bass.anchorPc ?? dna.keyCentre);
    const fifth = bassOffset + (bassOffset >= 4 ? -5 : 7); // stay in the low octave
    out.push({
      voice: 'bass',
      midi: Math.max(0, anchor + fifth),
      durationSteps: Math.max(1, Math.floor(barSteps / 4)),
      velocity: 0.42 + jitter(state.step * 5 + 3) * 0.08,
      timeOffsetSec: jitter(state.step * 5 + 4) * 0.01,
    });
  }

  // Pad: probabilistic on density, gated by minGapSteps AND a polyphony budget — don't
  // generate more overlapping notes than the voice can hold (this is what was causing
  // "Max polyphony exceeded. Note dropped." and the audible cut-offs), while keeping the
  // long ambient releases. Walks the DNA motif, pulled toward the current chord.
  state.activePad = state.activePad.filter((free) => free > state.step);
  const maxPad = Math.max(1, scene.voices.maxPolyphony);
  const gap = state.step - state.lastPadStep;

  // 8-bar phrase envelope (two bass periods... four chord periods = the full cycle):
  // velocity arcs up and back; the trigger gate thins toward phrase ends so the
  // music breathes instead of emitting at a constant statistical rate.
  const phraseSteps = barSteps * CHORD_CYCLE.length;
  const phrasePos = (state.step % phraseSteps) / phraseSteps;
  const phraseEnv = Math.sin(Math.PI * phrasePos); // 0 → 1 → 0 across the phrase

  // Placement groove: quarter-grid steps are favoured, off-beats thinned — the pull
  // strengthens with rhythmicWeight so the deep scenes land harder on the pulse.
  const onQuarter = state.step % 2 === 0;
  const placement = onQuarter
    ? 1 + 0.15 * macros.rhythmicWeight
    : 1 - 0.3 * macros.rhythmicWeight;
  // Swing: off-beat eighths sit late — a fixed gentle lilt that deepens with weight.
  const swingSec = onQuarter ? 0 : (0.06 + 0.1 * macros.rhythmicWeight) * 0.5 * stepSec;

  if (
    gap >= scene.rhythm.minGapSteps &&
    state.activePad.length < maxPad &&
    rng.chance(Math.min(1, (0.25 + 0.6 * dens) * (0.45 + 0.55 * phraseEnv) * placement))
  ) {
    const motif = dna.motif.intervals;
    const stepInterval = motif.length > 0 ? (motif[state.motifIndex % motif.length] ?? 0) : 0;
    let degree = state.degree + stepInterval;
    if (degree > 10) degree -= 7;
    if (degree < -3) degree += 7;

    // Chord gravity: usually snap to the nearest chord tone (octave-aware in degree
    // space); rising dissonance lets the line wander off the chord more often.
    if (rng.chance(0.62 * (1 - 0.5 * macros.dissonance))) {
      let best = degree;
      let bestDist = Infinity;
      for (const tone of CHORD_TONES) {
        for (const oct of [-7, 0, 7]) {
          const cand = chordRoot + tone + oct;
          const d = Math.abs(cand - degree);
          if (d < bestDist) {
            bestDist = d;
            best = cand;
          }
        }
      }
      degree = best;
    }

    // The register sinks an octave in the deep half of the descent.
    const octaveBase = PAD_OCTAVE_BASE - (macros.darkness > 0.62 ? 12 : 0);
    const midi = degreeToMidi(degree, scale, dna.keyCentre, octaveBase);
    // Duration: usually the motif's own rhythm pattern (its recurring identity),
    // sometimes the density pool (sparser = longer) so it never turns mechanical.
    const durPool = dens < 0.45 ? DUR_SPARSE : DUR_DENSE;
    const pooled = durPool[rng.int(0, durPool.length - 1)] ?? 3;
    const motifRhythm = dna.motif.rhythm;
    const motifDur =
      motifRhythm.length > 0
        ? Math.max(1, Math.min(12, Math.round(motifRhythm[state.motifIndex % motifRhythm.length] ?? 0)))
        : 0;
    const durationSteps = motifDur > 0 && rng.chance(0.6) ? motifDur : pooled;
    const velocity = Math.min(
      1,
      0.34 +
        0.26 * phraseEnv +
        0.1 * dens +
        (onQuarter ? 0.04 : -0.02) * (1 + macros.rhythmicWeight) +
        jitter(state.step * 11 + 4) * 0.12,
    );
    out.push({
      voice: 'pad',
      midi,
      durationSteps,
      velocity: Math.max(0.05, velocity),
      // pad drags a touch (laid-back), and off-beats carry the swing lilt
      timeOffsetSec: swingSec + jitter(state.step * 13 + 5) * 0.025,
    });
    state.degree = degree;
    state.motifIndex++;
    state.lastPadStep = state.step;
    state.activePad.push(state.step + durationSteps + PAD_TAIL_STEPS);

    // Occasional dyad above the line — interval drawn from the scene's harmonic
    // guardrails; the pungent intervals (2nds, tritones) only join as the arc's
    // dissonance rises. Budget-checked so the smoke-test polyphony invariant holds.
    if (state.activePad.length < maxPad && rng.chance(0.14 + 0.22 * dens)) {
      const allowed = (scene.harmonicGuardrails.allowedIntervals ?? CONSONANT_DYADS).filter(
        (iv) => iv > 0 && iv <= 12 && (macros.dissonance >= 0.45 || iv >= 3),
      );
      const pool = allowed.length > 0 ? allowed : CONSONANT_DYADS;
      const interval = pool[rng.int(0, pool.length - 1)] ?? 7;
      if (midi + interval <= 127) {
        out.push({
          voice: 'pad',
          midi: midi + interval,
          durationSteps,
          velocity: Math.max(0.05, velocity * 0.72),
          timeOffsetSec: swingSec + jitter(state.step * 17 + 6) * 0.03 + 0.012, // trails the lead
        });
        state.activePad.push(state.step + durationSteps + PAD_TAIL_STEPS);
      }
    }
  }

  state.step++;
  return out;
}
