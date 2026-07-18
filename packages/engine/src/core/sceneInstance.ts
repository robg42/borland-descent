import * as Tone from 'tone';
import type { Patch, Scene } from '../patch/schema';
import type { ArcMacros } from '../patch/types';
import type { SignalRegistry } from './registry';
import type { Rng } from './rng';
import { AudioEngine } from '../audio/audioEngine';
import type { SynthModule } from '../audio/synths/types';

export interface SceneInstanceOptions {
  patch: Patch;
  scene: Scene;
  registry: SignalRegistry;
  rng: Rng;
}

/**
 * One scene's AUDIO, made real (V1 rebuild: the visual side now lives in the
 * shared VisualHost — one renderer for the whole engine — so this carve-out is
 * audio-only). After build() the AudioEngine registers its ports into the
 * shared registry; the host Engine mounts the scene's visual layer into the
 * VisualHost against the same registry, and ramps this instance's scene gain
 * to crossfade it against another scene (§18.2).
 *
 * The audio graph is built on build(), inside the user gesture (the reverb
 * impulse and the tape worklet load there).
 */
export class SceneInstance {
  readonly scene: Scene;
  private readonly patch: Patch;
  private readonly registry: SignalRegistry;
  private readonly rng: Rng;
  private audio: AudioEngine | null = null;
  private sceneGain: Tone.Gain | null = null;
  private disposed = false;

  constructor(opts: SceneInstanceOptions) {
    this.patch = opts.patch;
    this.scene = opts.scene;
    this.registry = opts.registry;
    this.rng = opts.rng;
  }

  /** Build the audio graph (async: reverb IR + tape worklet). Inside a user gesture. */
  async build(): Promise<void> {
    if (this.disposed) return;
    this.audio = new AudioEngine(this.patch, this.scene, this.rng, this.registry);
    await this.audio.build();
    // This scene's mixed output passes through its own gain, which the host connects
    // into the shared master — and ramps to crossfade between two scenes (§18.2).
    this.sceneGain = new Tone.Gain(1);
    this.audio.output.connect(this.sceneGain);
  }

  startComposer(): void {
    this.audio?.startComposer();
  }

  /** This scene's audio output node — null until build(). The host connects it into
   *  the shared master and ramps its gain for crossfades (§18.2). */
  get output(): Tone.ToneAudioNode | null {
    return this.sceneGain;
  }

  /** Apply arc macros to the audio feel for this frame (visuals: VisualHost.setArc). */
  applyArc(macros: ArcMacros): void {
    this.audio?.applyArc(macros);
  }

  /** Per-frame feature refresh (bands/flux/onset) — before the matrix reads. */
  tick(dt: number): void {
    this.audio?.tickFeatures(dt);
  }

  /** Look up a synth by audioGraph nodeId. Used by the sequencer. Null before build(). */
  getSynth(nodeId: string): SynthModule | null {
    return this.audio?.getSynth(nodeId) ?? null;
  }

  /** Ramp this scene's audio level to `v` (0..1) over one frame (~16 ms). The per-frame
   *  call from advanceCrossfade means each step is smooth; the short ramp de-zippers the
   *  gain write so there is no click even at dropped frames. No-op before build(). */
  setLevel(v: number): void {
    if (this.sceneGain) this.sceneGain.gain.rampTo(v, 0.016);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.audio?.dispose();
    this.sceneGain?.dispose();
  }
}
