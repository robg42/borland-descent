import * as Tone from 'tone';
import type { Patch, Scene } from '../patch/schema';
import type { SignalRegistry } from './registry';
import type { Rng } from './rng';
import { AudioEngine } from '../audio/audioEngine';

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
  applyArc(position: number): void {
    this.audio?.applyArc(position);
  }

  /** Set this scene's audio level instantly (0..1). The host ramps it per frame to
   *  cross-fade against another scene (§18.2). No-op before build(). */
  setLevel(v: number): void {
    if (this.sceneGain) this.sceneGain.gain.value = v;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.audio?.dispose();
    this.sceneGain?.dispose();
  }
}
