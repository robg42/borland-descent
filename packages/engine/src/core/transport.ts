import * as Tone from 'tone';

export type TransportState = 'stopped' | 'started' | 'paused';

export interface TransportPosition {
  bar: number;
  beat: number;
  sixteenth: number;
}

/**
 * The shared transport contract (brief §2/§6, golden rule 5: ONE clock). The
 * sequencer's lookahead pump, the generative composer and the visual frame loop
 * all consume this façade; Tone's transport — a worker-driven lookahead scheduler
 * sourced from the audio clock — remains the single underlying clock. Never
 * setTimeout/setInterval for musical timing.
 */
export interface TransportClock {
  readonly state: TransportState;
  /** Current transport position in seconds (the visual loop READS this). */
  readonly seconds: number;
  /** Musical position derived from Tone's bars:beats:sixteenths. */
  readonly position: TransportPosition;
  bpm: number;
  timeSignature: [number, number];
  start(): void;
  pause(): void;
  stop(): void;
  /**
   * Lookahead pump for sample-accurate scheduling. The callback fires AHEAD of
   * the playhead with the exact AudioContext time of the window start; schedule
   * every event in [windowStartSec, windowEndSec) — both in TRANSPORT seconds —
   * at `audioTimeAtWindowStart + (eventSec − windowStartSec)`. Returns an
   * unsubscribe. Note: `stop()` cancels all scheduled transport events, so pump
   * owners must re-subscribe after a stop (pause/start preserves them).
   */
  scheduleWindow(
    cb: (windowStartSec: number, windowEndSec: number, audioTimeAtWindowStart: number) => void,
    intervalSec?: number,
  ): () => void;
}

/** v15: access via getters, never `Tone.Transport`. */
export class Transport implements TransportClock {
  private started = false;
  private meter: [number, number] = [4, 4];

  get state(): TransportState {
    const s = Tone.getTransport().state;
    return s === 'started' ? 'started' : s === 'paused' ? 'paused' : 'stopped';
  }

  /** Kept alongside the `bpm` setter for existing call sites. */
  setBpm(bpm: number): void {
    Tone.getTransport().bpm.value = bpm;
  }

  get bpm(): number {
    return Tone.getTransport().bpm.value;
  }
  set bpm(v: number) {
    Tone.getTransport().bpm.value = v;
  }

  get timeSignature(): [number, number] {
    return [this.meter[0], this.meter[1]];
  }
  set timeSignature(ts: [number, number]) {
    this.meter = [ts[0], ts[1]];
    // Tone expresses the signature as beats-per-bar relative to quarter notes.
    Tone.getTransport().timeSignature = [ts[0], ts[1]];
  }

  get seconds(): number {
    return Tone.getTransport().seconds;
  }

  get position(): TransportPosition {
    const parts = String(Tone.getTransport().position).split(':');
    return {
      bar: Number(parts[0] ?? 0) || 0,
      beat: Number(parts[1] ?? 0) || 0,
      sixteenth: Number(parts[2] ?? 0) || 0,
    };
  }

  get isStarted(): boolean {
    return this.started;
  }

  start(): void {
    if (this.started) return;
    Tone.getTransport().start();
    this.started = true;
  }

  pause(): void {
    Tone.getTransport().pause();
    this.started = false;
  }

  stop(): void {
    const t = Tone.getTransport();
    t.stop();
    t.cancel(); // clear scheduled events — pumps must re-subscribe after a stop
    this.started = false;
  }

  scheduleWindow(
    cb: (windowStartSec: number, windowEndSec: number, audioTimeAtWindowStart: number) => void,
    intervalSec = 0.1,
  ): () => void {
    const transport = Tone.getTransport();
    const id = transport.scheduleRepeat((audioTime) => {
      const startSec = transport.getSecondsAtTime(audioTime);
      cb(startSec, startSec + intervalSec, audioTime);
    }, intervalSec);
    return () => {
      transport.clear(id);
    };
  }
}
