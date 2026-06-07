import * as Tone from 'tone';
import type { Patch, Scene, Scalar } from '../patch/schema';
import type { Rng } from '../core/rng';
import { makePortRef } from '../core/ports';
import { clamp } from '../core/curves';
import { macrosAt } from '../core/arc';
import type { SignalRegistry } from '../core/registry';
import { createSynth, type SynthModule } from './synths';
import { Analysers } from './analysers';
import { Composer } from './composer/composer';
import { TapeWarmth } from './effects/tapeWarmth';

function nodeParams(patch: Patch, id: string): Record<string, Scalar> {
  return patch.audioGraph.nodes.find((n) => n.id === id)?.params ?? {};
}
function num(v: Scalar | undefined, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}

/**
 * The audio engine builds the fixed bus topology (a tight DRY low bus + a WET reverb
 * bus with the tape-warmth worklet) and the scene's synth modules + generative
 * composer, then registers every measurement output and modulatable input as a port.
 */
export class AudioEngine {
  private readonly master = new Tone.Gain(0.9);
  private readonly dryBus = new Tone.Gain(0.95);
  private readonly wetBus = new Tone.Gain(0.85);
  private readonly analysers = new Analysers();
  private readonly pad: SynthModule;
  private readonly bass: SynthModule;
  private readonly composer: Composer;
  private reverb: Tone.Reverb | null = null;
  private tape: TapeWarmth | null = null;
  private lfo: Tone.LFO | null = null;
  private disposed = false;

  constructor(
    private readonly patch: Patch,
    private readonly scene: Scene,
    rng: Rng,
    private readonly registry: SignalRegistry,
  ) {
    this.pad = createSynth(scene.synthModuleId, { maxPolyphony: scene.audioParams.voices.maxPolyphony });
    this.bass = createSynth('subBass');
    this.composer = new Composer(this.pad, this.bass, patch.dna, scene.audioParams, rng);
  }

  /** Build the graph. Async: the reverb IR and the worklet module load here. */
  async build(): Promise<void> {
    const reverbSize = this.scene.audioParams.reverbSize;
    this.reverb = new Tone.Reverb({ decay: 1.5 + reverbSize * 9, preDelay: 0.02, wet: 1 });
    await this.reverb.ready;

    try {
      this.tape = new TapeWarmth(nodeParams(this.patch, 'tape'));
      await this.tape.init();
    } catch (err) {
      console.warn('[borland] tape-warmth worklet unavailable; continuing without it.', err);
      this.tape = null;
    }

    // Wet chain: pad → wetBus → reverb → [tape] → master
    this.pad.output.connect(this.wetBus);
    this.wetBus.connect(this.reverb);
    if (this.tape) {
      this.reverb.connect(this.tape.input);
      this.tape.output.connect(this.master);
    } else {
      this.reverb.connect(this.master);
    }

    // Dry chain: bass → dryBus → master
    this.bass.output.connect(this.dryBus);
    this.dryBus.connect(this.master);

    // Master out + analyser taps
    this.master.connect(Tone.getDestination());
    this.master.connect(this.analysers.masterMeter);
    this.master.connect(this.analysers.fft);
    this.bass.output.connect(this.analysers.bassMeter);

    // Modulation LFO (audio-rate source). Range is a bipolar offset (Hz).
    const lfoParams = nodeParams(this.patch, 'wobble');
    this.lfo = new Tone.LFO({
      frequency: num(lfoParams.frequency, 0.1),
      min: num(lfoParams.min, -220),
      max: num(lfoParams.max, 220),
      type: 'sine',
    }).start();

    this.registerPorts();
  }

  private registerPorts(): void {
    this.pad.registerPorts('voices', this.registry, nodeParams(this.patch, 'voices'));
    this.bass.registerPorts('bass', this.registry, nodeParams(this.patch, 'bass'));
    this.tape?.registerPorts('tape', this.registry);

    this.registry.addInput(makePortRef('master', 'gain'), {
      kind: 'unipolar',
      base: this.master.gain.value,
      min: 0,
      max: 1.5,
      write: (v) => {
        this.master.gain.value = clamp(v, 0, 1.5);
      },
      audioTarget: this.master.gain,
    });

    this.registry.addOutput(makePortRef('masterMeter', 'level'), {
      kind: 'unipolar',
      read: () => this.analysers.readMaster(),
    });
    this.registry.addOutput(makePortRef('bassMeter', 'level'), {
      kind: 'unipolar',
      read: () => this.analysers.readBass(),
    });
    this.registry.addOutput(makePortRef('fft', 'low'), {
      kind: 'unipolar',
      read: () => this.analysers.readBand(0, 0.18),
    });
    this.registry.addOutput(makePortRef('fft', 'mid'), {
      kind: 'unipolar',
      read: () => this.analysers.readBand(0.18, 0.5),
    });
    this.registry.addOutput(makePortRef('fft', 'high'), {
      kind: 'unipolar',
      read: () => this.analysers.readBand(0.5, 1),
    });

    if (this.lfo) {
      this.registry.addOutput(makePortRef('wobble', 'out'), {
        kind: 'bipolar',
        read: () => 0, // audio-rate only; control reads are not meaningful for the raw LFO
        audioNode: this.lfo,
      });
    }
  }

  startComposer(): void {
    this.composer.start();
  }

  /** Apply arc macros to the global audio feel each frame (cheap params only). */
  applyArc(position: number): void {
    const m = macrosAt(this.patch.dna.arc, position);
    this.composer.density = m.density;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.composer.dispose();
    this.lfo?.dispose();
    this.pad.dispose();
    this.bass.dispose();
    this.tape?.dispose();
    this.reverb?.dispose();
    this.wetBus.dispose();
    this.dryBus.dispose();
    this.master.dispose();
    this.analysers.dispose();
  }
}
