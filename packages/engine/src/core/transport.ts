import * as Tone from 'tone';

/**
 * The single shared clock (brief §2/§6). Audio events schedule against Tone's
 * look-ahead transport; the visual loop *reads* transport time each frame
 * (related, not sample-accurate). v15: access via getters, never `Tone.Transport`.
 */
export class Transport {
  private started = false;

  setBpm(bpm: number): void {
    Tone.getTransport().bpm.value = bpm;
  }

  get bpm(): number {
    return Tone.getTransport().bpm.value;
  }

  /** Current transport position in seconds. */
  get seconds(): number {
    return Tone.getTransport().seconds;
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
    t.cancel(); // clear scheduled events
    this.started = false;
  }
}
