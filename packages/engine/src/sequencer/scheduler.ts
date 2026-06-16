import * as Tone from 'tone';
import type { Sequence } from '../patch/schema';
import type { TransportClock } from '../core/transport';
import type { SignalRegistry } from '../core/registry';
import type { SynthModule } from '../audio/synths/types';
import type { PortRef } from '../core/ports';
import { eventsInWindow } from './core';
import type { SequenceWindowContext } from './types';

/**
 * The sequencer scheduler (Workstream A). Binds the pure `eventsInWindow` core to
 * `TransportClock.scheduleWindow` and dispatches events:
 *   - Note events → synth.trigger() with the exact AudioContext time.
 *   - Port events → written at the rAF frame closest to the event time via Tone.getDraw(),
 *     so they land at control-rate precision (one frame) without blocking the audio thread.
 *
 * The scheduler is scene-aware: `updateContext()` is called whenever the scene
 * changes so note degrees continue to quantise through the new scale. It is
 * transport-aware: `start()` / `stop()` track the pump subscription so crossfades
 * and scene reloads don't leak duplicate pumps.
 */
export interface SchedulerOptions {
  sequences: Sequence[];
  transport: TransportClock;
  registry: SignalRegistry;
  /** Map from audioGraph nodeId (e.g. 'voices', 'bass') to its live SynthModule. */
  getSynth: (nodeId: string) => SynthModule | null;
  ctx: SequenceWindowContext;
}

export class Sequencer {
  private sequences: Sequence[];
  private ctx: SequenceWindowContext;
  private readonly transport: TransportClock;
  private registry: SignalRegistry;
  private readonly getSynth: (nodeId: string) => SynthModule | null;
  private unsubscribe: (() => void) | null = null;
  private disposed = false;
  /** Latest dispatched event time per sequence — tempo drift re-grids the loop
   *  layout between windows, and without this monotonic guard an event near a
   *  window edge could be scanned (and fired) twice. */
  private readonly lastDispatched = new Map<string, number>();

  constructor(opts: SchedulerOptions) {
    this.sequences = opts.sequences;
    this.ctx = opts.ctx;
    this.transport = opts.transport;
    this.registry = opts.registry;
    this.getSynth = opts.getSynth;
  }

  /** Hot-swap sequence list (e.g. when the studio edits a sequence). */
  updateSequences(sequences: Sequence[]): void {
    this.sequences = sequences;
  }

  /** Hot-swap musical context (e.g. on scene change). */
  updateContext(ctx: SequenceWindowContext): void {
    this.ctx = ctx;
  }

  /** Re-point port-event writes at a new registry (a crossfade hands the active
   *  registry over to the incoming scene's; without this, port tracks keep writing
   *  into the old, cleared registry and silently die). */
  setRegistry(registry: SignalRegistry): void {
    this.registry = registry;
  }

  start(): void {
    if (this.unsubscribe || this.disposed) return;
    this.unsubscribe = this.transport.scheduleWindow(
      (windowStartSec, windowEndSec, audioTimeAtWindowStart) => {
        for (const seq of this.sequences) {
          if (!seq.enabled) continue;
          const events = eventsInWindow(seq, this.ctx, windowStartSec, windowEndSec);
          const floor = this.lastDispatched.get(seq.id) ?? -Infinity;
          let latest = floor;
          for (const ev of events) {
            // Strictly-after-the-floor guard: coincident events WITHIN this window
            // all dispatch (they share one scan), but anything at or before the
            // previous windows' high-water mark is a re-scan and is dropped.
            if (ev.timeSec <= floor) continue;
            if (ev.timeSec > latest) latest = ev.timeSec;
            const relSec = ev.timeSec - windowStartSec;
            const audioTime = audioTimeAtWindowStart + relSec;
            if (ev.kind === 'note') {
              const synth = this.getSynth(ev.targetNodeId);
              synth?.trigger(ev.midi, ev.durationSec, audioTime, ev.velocity);
            } else {
              // Port events are control-rate — schedule write at the closest rAF frame.
              Tone.getDraw().schedule(() => {
                const input = this.registry.getInput(ev.port as PortRef);
                if (input) {
                  input.write(ev.value);
                  input.base = ev.value;
                }
              }, audioTime);
            }
          }
          if (latest > floor) this.lastDispatched.set(seq.id, latest);
        }
      },
      0.1,
    );
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.lastDispatched.clear(); // transport stop resets seconds — the floor must too
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
  }
}
