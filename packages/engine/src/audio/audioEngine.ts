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
import { generateHallIR } from './effects/hallIR';
import { smoothWrite } from './smoothWrite';

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
  private reverb: Tone.Convolver | null = null;
  private reverbHP: Tone.Filter | null = null;
  private tape: TapeWarmth | null = null;
  private lfo: Tone.LFO | null = null;
  private drift: Tone.Vibrato | null = null;
  private padDry: Tone.Gain | null = null;
  private glue: Tone.Compressor | null = null;
  private shimmer: Tone.PitchShift | null = null;
  private shimmerReverb: Tone.Reverb | null = null;
  private shimmerOut: Tone.Gain | null = null;
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
    // Convolution reverb — real space. By default a warm generated hall IR (early
    // reflections + a frequency-damped, stereo-decorrelated tail); a real recorded IR
    // (e.g. an Open AIR cathedral) drops in via the reverb node's `ir` and replaces it.
    const reverbNode = this.patch.audioGraph.nodes.find((n) => n.id === 'reverb');
    this.reverb = new Tone.Convolver();
    this.reverb.buffer = Tone.ToneAudioBuffer.fromArray(
      generateHallIR(Tone.getContext().sampleRate, 1.4 + reverbSize * 7, 0.012 + reverbSize * 0.03),
    );
    if (typeof reverbNode?.ir === 'string' && reverbNode.ir.length > 0) {
      try {
        await this.reverb.load(reverbNode.ir);
      } catch (err) {
        console.warn('[borland] reverb IR failed to load; using the generated hall.', err);
      }
    }

    // Shimmer's own reverb blooms the octave-up signal; built async like the main one.
    const shimmerParams = nodeParams(this.patch, 'shimmer');
    const shimmerReverb = new Tone.Reverb({ decay: num(shimmerParams.decay, 5), wet: 1 });
    this.shimmerReverb = shimmerReverb;
    await shimmerReverb.ready;

    try {
      this.tape = new TapeWarmth(nodeParams(this.patch, 'tape'));
      await this.tape.init();
    } catch (err) {
      console.warn('[borland] tape-warmth worklet unavailable; continuing without it.', err);
      this.tape = null;
    }

    // Slow pitch DRIFT on the voices — the Boards-of-Canada warped-tape instability: a
    // gentle, sub-Hz pitch wander over the whole wet/pad bus. The dry bass bypasses it
    // and stays tight. Sits before the reverb so the tail follows the drift.
    const driftParams = nodeParams(this.patch, 'drift');
    this.drift = new Tone.Vibrato({
      frequency: num(driftParams.frequency, 0.13),
      depth: num(driftParams.depth, 0.22),
      maxDelay: num(driftParams.maxDelay, 0.02),
      type: 'sine',
    });

    // High-pass the reverb SEND so lows stay out of the long tail (clarity, no mud) —
    // the dry sub owns the bottom. Wet chain: pad → drift → wetBus → HP → reverb → [tape] → master.
    this.reverbHP = new Tone.Filter({
      type: 'highpass',
      frequency: num(nodeParams(this.patch, 'reverbHP').frequency, 280),
      Q: 0.5,
    });
    this.pad.output.connect(this.drift);
    this.drift.connect(this.wetBus);
    this.wetBus.connect(this.reverbHP);
    this.reverbHP.connect(this.reverb);
    if (this.tape) {
      this.reverb.connect(this.tape.input);
      this.tape.output.connect(this.master);
    } else {
      this.reverb.connect(this.master);
    }

    // A little DRY pad in parallel gives the voices presence and definition under the
    // wash (they were 100% wet before — distant and undefined). Clean, stable-pitched.
    this.padDry = new Tone.Gain(num(nodeParams(this.patch, 'padDry').gain, 0.32));
    this.pad.output.connect(this.padDry);
    this.padDry.connect(this.master);

    // Shimmer send — an octave-up pitch-shifted feedback bloom off the voices, smoothed
    // by its own reverb: the ascending AWVFTS/Cocteau sheen. Parallel into the master so
    // the glue + limiter catch it; kept clean (no tape) to stay ethereal.
    const shimmer = new Tone.PitchShift({
      pitch: num(shimmerParams.pitch, 12),
      windowSize: num(shimmerParams.windowSize, 0.1),
      feedback: num(shimmerParams.feedback, 0.35),
      wet: 1,
    });
    const shimmerOut = new Tone.Gain(num(shimmerParams.level, 0.22));
    this.shimmer = shimmer;
    this.shimmerOut = shimmerOut;
    this.wetBus.connect(shimmer);
    shimmer.connect(shimmerReverb);
    shimmerReverb.connect(shimmerOut);
    shimmerOut.connect(this.master);

    // Dry chain: bass → dryBus → master
    this.bass.output.connect(this.dryBus);
    this.dryBus.connect(this.master);

    // Per-scene glue compression for cohesion. The brick-wall limiter lives on the HOST
    // master bus (Engine.masterBus → hostLimiter → Destination) so two summed scenes
    // during a crossfade can never push the final output over FS.
    const glueParams = nodeParams(this.patch, 'glue');
    this.glue = new Tone.Compressor({
      threshold: num(glueParams.threshold, -18),
      ratio: num(glueParams.ratio, 2),
      attack: num(glueParams.attack, 0.03),
      release: num(glueParams.release, 0.25),
      knee: 8,
    });
    this.master.connect(this.glue);

    // Analyser taps sit on the PRE-glue master, so audio→visual modulation tracks the
    // mix itself rather than the limiter's gain reduction.
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

    // If this scene's voice is a sampler, bind its user sample (referenced by id from the
    // patch; the binary is read from the runtime SampleStore / IndexedDB).
    const voicesNode = this.patch.audioGraph.nodes.find((n) => n.id === 'voices');
    if (voicesNode?.sampleId) this.pad.bindSample?.(voicesNode.sampleId);

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
      write: (v) => { smoothWrite(this.master.gain, clamp(v, 0, 1.5)); },
      audioTarget: this.master.gain,
    });

    if (this.padDry) {
      const padDry = this.padDry;
      this.registry.addInput(makePortRef('padDry', 'gain'), {
        kind: 'unipolar',
        base: padDry.gain.value,
        min: 0,
        max: 1.5,
        write: (v) => { smoothWrite(padDry.gain, clamp(v, 0, 1.5)); },
        audioTarget: padDry.gain,
      });
    }
    if (this.reverbHP) {
      const hp = this.reverbHP;
      this.registry.addInput(makePortRef('reverbHP', 'frequency'), {
        kind: 'scalar',
        base: num(nodeParams(this.patch, 'reverbHP').frequency, 280),
        min: 20,
        max: 2000,
        write: (v) => { smoothWrite(hp.frequency, clamp(v, 20, 2000)); },
        audioTarget: hp.frequency,
      });
    }

    if (this.shimmerOut) {
      const shimmerOut = this.shimmerOut;
      this.registry.addInput(makePortRef('shimmer', 'level'), {
        kind: 'unipolar',
        base: shimmerOut.gain.value,
        min: 0,
        max: 1.5,
        write: (v) => { smoothWrite(shimmerOut.gain, clamp(v, 0, 1.5)); },
        audioTarget: shimmerOut.gain,
      });
    }
    if (this.shimmer) {
      const shimmer = this.shimmer;
      this.registry.addInput(makePortRef('shimmer', 'feedback'), {
        kind: 'unipolar',
        base: shimmer.feedback.value,
        min: 0,
        max: 0.9,
        write: (v) => { smoothWrite(shimmer.feedback, clamp(v, 0, 0.9)); },
        audioTarget: shimmer.feedback,
      });
    }

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

    // V2 feature layer — eight log-spaced envelope-followed bands, spectral
    // flux, and the onset TRIGGER (fires decaying envelopes via the matrix).
    for (let b = 0; b < 8; b++) {
      this.registry.addOutput(makePortRef('audio', `band${b + 1}`), {
        kind: 'unipolar',
        read: () => this.analysers.readFeatureBand(b),
      });
    }
    this.registry.addOutput(makePortRef('audio', 'flux'), {
      kind: 'unipolar',
      read: () => this.analysers.readFlux(),
    });
    this.registry.addOutput(makePortRef('audio', 'onset'), {
      kind: 'trigger',
      read: () => this.analysers.readOnset(),
    });

    if (this.drift) {
      const drift = this.drift;
      this.registry.addInput(makePortRef('drift', 'depth'), {
        kind: 'unipolar',
        base: drift.depth.value,
        min: 0,
        max: 1,
        write: (v) => { smoothWrite(drift.depth, clamp(v, 0, 1)); },
        audioTarget: drift.depth,
      });
    }

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

  /** Look up a synth by its audioGraph nodeId ('voices' or 'bass'). Used by the
   *  sequencer scheduler to dispatch note events to the right synth module. */
  getSynth(nodeId: string): SynthModule | null {
    if (nodeId === 'bass') return this.bass;
    if (nodeId === 'voices') return this.pad;
    return null;
  }

  /** Refresh the audio features for this frame (engine loop, before the matrix). */
  tickFeatures(dt: number): void {
    this.analysers.update(dt);
  }

  /** Apply arc macros to the global audio feel each frame (cheap params only). */
  applyArc(position: number): void {
    const m = macrosAt(this.patch.dna.arc, position);
    this.composer.density = m.density;
  }

  /** The scene's mixed audio output (post glue) — the host routes this into the shared
   *  master bus which carries the host-level limiter. Falls back to the raw master
   *  before build() wires the spine. */
  get output(): Tone.ToneAudioNode {
    return this.glue ?? this.master;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.composer.dispose();
    this.lfo?.dispose();
    this.pad.dispose();
    this.bass.dispose();
    this.tape?.dispose();
    this.drift?.dispose();
    this.reverbHP?.dispose();
    this.reverb?.dispose();
    this.shimmer?.dispose();
    this.shimmerReverb?.dispose();
    this.shimmerOut?.dispose();
    this.padDry?.dispose();
    this.glue?.dispose();
    this.wetBus.dispose();
    this.dryBus.dispose();
    this.master.dispose();
    this.analysers.dispose();
  }
}
