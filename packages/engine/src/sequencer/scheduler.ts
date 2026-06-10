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
  private readonly registry: SignalRegistry;
  private readonly getSynth: (nodeId: string) => SynthModule | null;
  private unsubscribe: (() => void) | null = null;
  private disposed = false;

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

  start(): void {
    if (this.unsubscribe || this.disposed) return;
    this.unsubscribe = this.transport.scheduleWindow(
      (windowStartSec, windowEndSec, audioTimeAtWindowStart) => {
        for (const seq of this.sequences) {
          if (!seq.enabled) continue;
          const events = eventsInWindow(seq, this.ctx, windowStartSec, windowEndSec);
          for (const ev of events) {
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
        }
      },
      0.1,
    );
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
  }
}
