import type { PortRef } from '../core/ports';
import type { Sequence } from '../patch/schema';

/**
 * The sequencer's shared contract (Workstream A). The windowing core is PURE:
 * given a sequence, its musical context and a lookahead window in TRANSPORT
 * seconds, it returns the exact events inside that window. The scheduler shim
 * binds it to TransportClock.scheduleWindow and dispatches: note events trigger
 * synth modules with exact times; port events write through the same
 * SignalInput path the modulation matrix uses.
 */

export interface SequencerNoteEvent {
  kind: 'note';
  /** Absolute transport time of the attack, seconds. */
  timeSec: number;
  durationSec: number;
  midi: number;
  velocity: number;
  /** audioGraph synth node to trigger (e.g. 'voices' | 'bass'). */
  targetNodeId: string;
}

export interface SequencerPortEvent {
  kind: 'port';
  /** Absolute transport time the value lands, seconds. */
  timeSec: number;
  port: PortRef;
  value: number;
}

export type SequencerEvent = SequencerNoteEvent | SequencerPortEvent;

export interface SequenceWindowContext {
  bpm: number;
  /** Scene scale as semitone offsets; degrees quantise through this. */
  scale: number[];
  /** Pitch class of the key centre (0–11). */
  keyCentre: number;
  /** MIDI note anchoring degree 0. */
  octaveBaseMidi: number;
  /**
   * Deterministic RNG per loop iteration — fork from
   * hash(meta.seed, sequence.id, loopIndex) so probability outcomes reproduce
   * per seed and are independent of the composer's draw order.
   */
  rngForLoop: (loopIndex: number) => () => number;
}

/** The pure windowing core A implements in sequencer/core.ts — fully unit-testable. */
export type EventsInWindow = (
  sequence: Sequence,
  ctx: SequenceWindowContext,
  windowStartSec: number,
  windowEndSec: number,
) => SequencerEvent[];
