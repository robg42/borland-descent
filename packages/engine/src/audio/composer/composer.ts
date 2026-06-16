import * as Tone from 'tone';
import type { Dna, SceneAudioParams } from '../../patch/types';
import type { Rng } from '../../core/rng';
import type { SynthModule } from '../synths/types';
import { decideStep, initComposerState, type ComposerMacros, type ComposerState } from './decide';

/**
 * Schedules the composer's decisions against the shared transport (a Tone.Loop at
 * the scene subdivision). Never looped playback — it runs continuously within the
 * scene's guardrails. `density` and `macros` are updated each frame from the arc
 * position, so the descent shapes harmony, weight and register — not just busyness.
 */
export class Composer {
  private loop: Tone.Loop | null = null;
  private state: ComposerState = initComposerState();
  density = 0.4;
  macros: ComposerMacros = { darkness: 0, dissonance: 0, rhythmicWeight: 0 };

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
      // Recomputed per tick so the swing offsets track the arc's tempo drift.
      const stepSec = Tone.Time(interval).toSeconds();
      const decisions = decideStep({
        dna: this.dna,
        scene: this.scene,
        density: this.density,
        rng: this.rng,
        state: this.state,
        macros: this.macros,
        stepSec,
      });
      for (const d of decisions) {
        const synth = d.voice === 'bass' ? this.bass : this.pad;
        synth.trigger(d.midi, d.durationSteps * stepSec, time + d.timeOffsetSec, d.velocity);
      }
    }, interval).start(0);
  }

  dispose(): void {
    this.loop?.dispose();
    this.loop = null;
  }
}
