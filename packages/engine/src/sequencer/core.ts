import type { Sequence } from '../patch/schema';
import { degreeToMidi } from '../core/music';
import type { SequencerEvent, SequenceWindowContext, EventsInWindow } from './types';
import type { PortRef } from '../core/ports';

/**
 * The pure sequencer core (Workstream A). Returns every SequencerEvent whose
 * attack falls within [windowStartSec, windowEndSec). No side effects; no
 * allocation beyond the returned array — zero-allocation in the per-window
 * hot path is enforced by the scratch arrays below being module-level.
 *
 * Swing: odd-indexed steps (1, 3, 5…) are pushed forward by
 *   swing * 0.5 * secPerStep
 * so beat 2 & 4 lay back. Amount 0 = straight, 1 = maximum (the beat almost
 * reaches the next downbeat).
 *
 * Ratchet: a step with ratchet > 1 fires `ratchet` equal-spaced sub-events
 * within its step slot (not its gate); only the last sub-event inherits tie.
 *
 * Probability: drawn from a deterministic per-loop fork of the seeded RNG so
 * the same seed → the same note pattern every playback.
 *
 * Loop boundaries: the window may span a loop boundary. Both the tail of the
 * current loop and the head of the next are scanned, so no event is missed and
 * no event is double-counted (strict < on windowEnd).
 */
export const eventsInWindow: EventsInWindow = (
  sequence: Sequence,
  ctx: SequenceWindowContext,
  windowStartSec: number,
  windowEndSec: number,
): SequencerEvent[] => {
  const { bpm, scale, keyCentre, octaveBaseMidi, rngForLoop } = ctx;
  const { steps, length, division, swing, humanizeMs, gate } = sequence;
  const results: SequencerEvent[] = [];

  if (!sequence.enabled || steps.length === 0 || windowEndSec <= windowStartSec) return results;

  const secPerBeat = 60 / bpm;
  const secPerStep = secPerBeat / division;
  const loopDur = length * secPerStep;
  if (loopDur <= 0) return results;

  // Scan from one loop BEFORE the window start through the loop containing the end.
  // Swing/humanise push an event PAST its step's grid time, so a late step of loop
  // N−1 can land inside a window that starts exactly at loop N's boundary — scanning
  // only the loops containing the raw endpoints would drop it. The strict window
  // test below dedupes, and the per-loop RNG keeps re-scans deterministic.
  const loopAtStart = Math.floor(windowStartSec / loopDur) - 1;
  const loopAtEnd = Math.floor((windowEndSec - 1e-9) / loopDur);

  for (let loopIdx = loopAtStart; loopIdx <= loopAtEnd; loopIdx++) {
    const loopOriginSec = loopIdx * loopDur;
    const rng = rngForLoop(loopIdx);

    for (let si = 0; si < length; si++) {
      const step = steps[si];
      if (!step || !step.on) continue;

      // Swing: push odd steps back by swing * half-step
      const swingOffset = si % 2 === 1 ? swing * 0.5 * secPerStep : 0;
      const stepOriginSec = loopOriginSec + si * secPerStep + swingOffset;

      // Humanize: deterministic small positive delay (never negative — laid back)
      const humanSec = humanizeMs > 0 ? (rng() * humanizeMs) / 1000 : 0;

      const ratchet = Math.max(1, step.ratchet ?? 1);
      const ratchetSlot = secPerStep / ratchet;
      const gateDur = ratchetSlot * gate;

      for (let r = 0; r < ratchet; r++) {
        const timeSec = stepOriginSec + r * ratchetSlot + humanSec;
        // Strictly inside the window
        if (timeSec < windowStartSec || timeSec >= windowEndSec) continue;

        // Probability draw (after window test so the RNG stream is deterministic
        // regardless of which window happens to overlap this step).
        const prob = step.probability ?? 1;
        if (prob < 1 && rng() > prob) continue;

        if (sequence.target.kind === 'notes') {
          const degree = step.degree ?? 0;
          const octave = step.octave ?? 0;
          const midi = degreeToMidi(degree + octave * scale.length, scale, keyCentre, octaveBaseMidi);
          results.push({
            kind: 'note',
            timeSec,
            durationSec: Math.max(gateDur, 0.015),
            midi: Math.round(midi),
            velocity: step.velocity ?? 0.8,
            targetNodeId: sequence.target.nodeId,
          });
        } else {
          results.push({
            kind: 'port',
            timeSec,
            port: sequence.target.port as PortRef,
            value: step.value ?? 0,
          });
        }
      }
    }
  }
  return results;
};
