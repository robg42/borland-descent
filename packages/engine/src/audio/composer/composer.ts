import * as Tone from 'tone';
import type { Dna, SceneAudioParams } from '../../patch/types';
import type { Rng } from '../../core/rng';
import type { SynthModule } from '../synths/types';
import { decideStep, initComposerState, type ComposerState } from './decide';

/**
 * Schedules the composer's decisions against the shared transport (a Tone.Loop at
 * the scene subdivision). Never looped playback — it runs continuously within the
 * scene's guardrails. `density` is updated each frame from the arc position.
 */
export class Composer {
  private loop: Tone.Loop | null = null;
  private state: ComposerState = initComposerState();
  density = 0.4;

  constructor(
    private readonly pad: SynthModule,
    private readonly bass: SynthModule,
    private readonly dna: Dna,
    private readonly scene: SceneAudioParams,
    private readonly rng: Rng,
  ) {}

  start(): void {
    if (this.loop) return;
    const interval = `${this.scene.rhythm.subdivision}n`;
    this.loop = new Tone.Loop((time) => {
      const decisions = decideStep({
        dna: this.dna,
        scene: this.scene,
        density: this.density,
        rng: this.rng,
        state: this.state,
      });
      const stepSec = Tone.Time(interval).toSeconds();
      for (const d of decisions) {
        const synth = d.voice === 'bass' ? this.bass : this.pad;
        synth.trigger(d.midi, d.durationSteps * stepSec, time, d.velocity);
      }
    }, interval).start(0);
  }

  dispose(): void {
    this.loop?.dispose();
    this.loop = null;
  }
}
