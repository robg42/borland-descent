import { describe, it, expect } from 'vitest';
import { eventsInWindow } from '../src/sequencer/core';
import type { Sequence } from '../src/patch/schema';
import type { SequenceWindowContext } from '../src/sequencer/types';

// ---- helpers -------------------------------------------------------------------

function makeSeq(overrides: Partial<Sequence> = {}): Sequence {
  return {
    id: 'test',
    name: '',
    enabled: true,
    sceneId: undefined,
    division: 4,
    length: 4,
    swing: 0,
    humanizeMs: 0,
    gate: 0.8,
    target: { kind: 'notes', nodeId: 'voices' },
    steps: [
      { on: true, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
      { on: false, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
      { on: true, degree: 2, octave: 0, velocity: 0.6, probability: 1, lengthSteps: 1, ratchet: 1 },
      { on: false, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
    ],
    ...overrides,
  };
}

// A deterministic LCG seeded by (seed ^ loopIndex) — same as the engine
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(1664525, s) + 1013904223;
    return (s >>> 0) / 0xffffffff;
  };
}

const CTX: SequenceWindowContext = {
  bpm: 120,
  scale: [0, 2, 3, 5, 7, 8, 10], // natural minor
  keyCentre: 0,
  octaveBaseMidi: 48,
  rngForLoop: (loopIdx) => lcg(42 ^ loopIdx),
};

// At 120 BPM, division=4: secPerBeat = 0.5, secPerStep = 0.125, loopDur = 4 * 0.125 = 0.5 s.
const SEC_PER_STEP = 0.125;

// ---- basic timing --------------------------------------------------------------

describe('eventsInWindow', () => {
  it('returns an empty array for an empty window', () => {
    const events = eventsInWindow(makeSeq(), CTX, 1, 1);
    expect(events).toHaveLength(0);
  });

  it('returns no events for a disabled sequence', () => {
    const events = eventsInWindow(makeSeq({ enabled: false }), CTX, 0, 10);
    expect(events).toHaveLength(0);
  });

  it('fires step 0 at t=0 with exact window matching', () => {
    const events = eventsInWindow(makeSeq(), CTX, 0, SEC_PER_STEP * 0.5);
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.kind).toBe('note');
    if (ev.kind === 'note') {
      expect(ev.timeSec).toBeCloseTo(0);
      // C3 = degree 0, octaveBaseMidi 48, keyCentre 0
      expect(ev.midi).toBe(48);
      expect(ev.velocity).toBeCloseTo(0.8);
    }
  });

  it('step 1 is off — only steps 0 and 2 fire in a full loop', () => {
    const events = eventsInWindow(makeSeq(), CTX, 0, 0.5);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.timeSec)).toEqual(
      expect.arrayContaining([
        expect.closeTo(0, 5),
        expect.closeTo(SEC_PER_STEP * 2, 5),
      ]),
    );
  });

  it('step 2 maps degree 2 to scale index 2 (minor 3rd)', () => {
    const events = eventsInWindow(makeSeq(), CTX, SEC_PER_STEP * 2 - 0.001, SEC_PER_STEP * 3);
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    if (ev.kind === 'note') {
      // natural minor [0,2,3,...]: degree 2 → semitone 3 → MIDI 48 + 3 = 51
      expect(ev.midi).toBe(51);
    }
  });

  // ---- window spanning a loop boundary -----------------------------------------

  it('fires events across a loop boundary exactly once', () => {
    // Loop is 0.5 s. A window [0.45, 0.55] spans the boundary.
    // In loop 0: step 2 at t=0.25 is before window start; no step is at t≥0.45.
    // In loop 1: step 0 at t=0.5 (loopOrigin 0.5) is within [0.45, 0.55).
    const events = eventsInWindow(makeSeq(), CTX, 0.45, 0.55);
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.timeSec).toBeCloseTo(0.5, 4);
  });

  it('catches a humanised event pushed past its loop boundary — exactly once', () => {
    // Loop is 0.5 s; the last step's grid time is 0.375 s. With humanizeMs 200 and a
    // constant rng of 0.9 the event lands at 0.555 s — inside loop 1's territory.
    // A scan that only covers the loops containing the window endpoints would never
    // visit loop 0 for the window [0.5, 0.6) and silently drop the note.
    const seq = makeSeq({
      humanizeMs: 200,
      steps: [
        { on: false, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
        { on: false, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
        { on: false, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
        { on: true, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
      ],
    });
    const ctx: SequenceWindowContext = { ...CTX, rngForLoop: () => () => 0.9 };
    const before = eventsInWindow(seq, ctx, 0.4, 0.5); // not yet — 0.555 ≥ window end
    const after = eventsInWindow(seq, ctx, 0.5, 0.6); // the spilled event, once
    expect(before.filter((e) => Math.abs(e.timeSec - 0.555) < 1e-6)).toHaveLength(0);
    expect(after).toHaveLength(1);
    expect(after[0]!.timeSec).toBeCloseTo(0.555, 6);
  });

  it('produces the same count across N loops (determinism)', () => {
    const loopDur = 0.5;
    const counts: number[] = [];
    for (let i = 0; i < 4; i++) {
      counts.push(eventsInWindow(makeSeq(), CTX, i * loopDur, (i + 1) * loopDur).length);
    }
    // All loops have 2 on-steps and the same probabilities → always 2 per loop
    expect(counts).toEqual([2, 2, 2, 2]);
  });

  // ---- swing -------------------------------------------------------------------

  it('odd steps are pushed back by swing amount', () => {
    // Make step 1 on so we can measure the swing offset
    const seq = makeSeq({
      swing: 0.5,
      steps: [
        { on: true, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
        { on: true, degree: 1, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
        { on: false, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
        { on: false, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
      ],
    });
    const events = eventsInWindow(seq, CTX, 0, 0.5);
    const times = events.map((e) => e.timeSec).sort((a, b) => a - b);
    // Step 0 at t=0 (no swing); step 1 pushed by 0.5 * 0.5 * 0.125 = 0.03125
    expect(times[0]).toBeCloseTo(0, 5);
    expect(times[1]).toBeCloseTo(SEC_PER_STEP + 0.5 * 0.5 * SEC_PER_STEP, 4);
  });

  // ---- probability -------------------------------------------------------------

  it('all-probability-0 steps never fire', () => {
    const seq = makeSeq({
      steps: [
        { on: true, degree: 0, octave: 0, velocity: 0.8, probability: 0, lengthSteps: 1, ratchet: 1 },
        { on: true, degree: 0, octave: 0, velocity: 0.8, probability: 0, lengthSteps: 1, ratchet: 1 },
        { on: true, degree: 0, octave: 0, velocity: 0.8, probability: 0, lengthSteps: 1, ratchet: 1 },
        { on: true, degree: 0, octave: 0, velocity: 0.8, probability: 0, lengthSteps: 1, ratchet: 1 },
      ],
    });
    // Never fires regardless of window size
    expect(eventsInWindow(seq, CTX, 0, 100)).toHaveLength(0);
  });

  it('probability=1 steps always fire', () => {
    const seq = makeSeq({
      steps: [
        { on: true, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
        { on: true, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
        { on: true, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
        { on: true, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
      ],
    });
    expect(eventsInWindow(seq, CTX, 0, 0.5)).toHaveLength(4);
  });

  // ---- ratchet -----------------------------------------------------------------

  it('ratchet=2 fires 2 events in one step slot', () => {
    const seq = makeSeq({
      steps: [
        { on: true, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 2 },
        { on: false, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
        { on: false, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
        { on: false, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
      ],
    });
    const events = eventsInWindow(seq, CTX, 0, SEC_PER_STEP);
    expect(events).toHaveLength(2);
    // Second ratchet fires at 0 + ratchetSlot (= secPerStep / 2)
    const times = events.map((e) => e.timeSec).sort((a, b) => a - b);
    expect(times[0]).toBeCloseTo(0, 5);
    expect(times[1]).toBeCloseTo(SEC_PER_STEP / 2, 4);
  });

  // ---- port target -------------------------------------------------------------

  it('port-target sequences emit port events', () => {
    const seq = makeSeq({
      target: { kind: 'port', port: 'drift.depth' },
      steps: [
        { on: true, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1, value: 0.5 },
        { on: false, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
        { on: false, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
        { on: false, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
      ],
    });
    const events = eventsInWindow(seq, CTX, 0, SEC_PER_STEP);
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.kind).toBe('port');
    if (ev.kind === 'port') {
      expect(ev.port).toBe('drift.depth');
      expect(ev.value).toBeCloseTo(0.5);
    }
  });

  // ---- gate duration -----------------------------------------------------------

  it('note duration equals gate * secPerStep', () => {
    const events = eventsInWindow(makeSeq({ gate: 0.5 }), CTX, 0, SEC_PER_STEP * 0.5);
    expect(events).toHaveLength(1);
    if (events[0] && events[0].kind === 'note') {
      expect(events[0].durationSec).toBeCloseTo(SEC_PER_STEP * 0.5, 4);
    }
  });

  // ---- octave shift ------------------------------------------------------------

  it('octave +1 shifts MIDI by 7 scale degrees = 12 semitones for natural minor', () => {
    const noOctave = eventsInWindow(
      makeSeq({ steps: [
        { on: true, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
        { on: false, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
        { on: false, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
        { on: false, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
      ]}),
      CTX, 0, SEC_PER_STEP,
    );
    const withOctave = eventsInWindow(
      makeSeq({ steps: [
        { on: true, degree: 0, octave: 1, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
        { on: false, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
        { on: false, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
        { on: false, degree: 0, octave: 0, velocity: 0.8, probability: 1, lengthSteps: 1, ratchet: 1 },
      ]}),
      CTX, 0, SEC_PER_STEP,
    );
    const baseMidi = noOctave[0] && noOctave[0].kind === 'note' ? noOctave[0].midi : 0;
    const octMidi = withOctave[0] && withOctave[0].kind === 'note' ? withOctave[0].midi : 0;
    expect(octMidi - baseMidi).toBe(12);
  });

  // ---- schema round-trip -------------------------------------------------------

  it('eventsInWindow accepts a schema-parsed Sequence', async () => {
    const { SequenceSchema } = await import('../src/patch/schema');
    const raw = {
      id: 'seq1',
      target: { kind: 'notes', nodeId: 'voices' },
      steps: [{ on: true }],
    };
    const seq = SequenceSchema.parse(raw);
    const events = eventsInWindow(seq, CTX, 0, 10);
    expect(events.length).toBeGreaterThanOrEqual(0);
  });
});
