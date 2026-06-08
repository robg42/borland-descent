import type { Patch, Scene } from '../patch/schema';
import type { SignalRegistry } from './registry';
import type { Rng } from './rng';
import { AudioEngine } from '../audio/audioEngine';
import { VisualEngine } from '../visual/visualEngine';

export interface SceneInstanceOptions {
  patch: Patch;
  scene: Scene;
  registry: SignalRegistry;
  rng: Rng;
  container?: HTMLElement;
  reducedMotion: boolean;
}

/**
 * One scene, made real: its own VisualEngine and (after build()) AudioEngine, each
 * registering its ports into the shared registry. The Engine hosts exactly one of
 * these today — but holding two and blending between them is the §18.2 crossfade
 * seam this carve-out opens, since the Engine no longer owns audio/visual directly.
 *
 * The visual is created up front so the player can show a still, inviting first frame
 * before audio is unlocked; the audio graph is built on build(), inside the user
 * gesture (the reverb impulse and the tape worklet load there).
 */
export class SceneInstance {
  readonly scene: Scene;
  private readonly patch: Patch;
  private readonly registry: SignalRegistry;
  private readonly rng: Rng;
  private visual: VisualEngine | null = null;
  private audio: AudioEngine | null = null;
  private disposed = false;

  constructor(opts: SceneInstanceOptions) {
    this.patch = opts.patch;
    this.scene = opts.scene;
    this.registry = opts.registry;
    this.rng = opts.rng;
    if (opts.container) {
      this.visual = new VisualEngine({
        patch: opts.patch,
        scene: opts.scene,
        registry: opts.registry,
        container: opts.container,
        reducedMotion: opts.reducedMotion,
      });
    }
  }

  /** Build the audio graph (async: reverb IR + tape worklet). Inside a user gesture. */
  async build(): Promise<void> {
    if (this.disposed) return;
    this.audio = new AudioEngine(this.patch, this.scene, this.rng, this.registry);
    await this.audio.build();
  }

  startComposer(): void {
    this.audio?.startComposer();
  }

  /** Apply arc macros to both the audio feel and the visual feel for this frame. */
  applyArc(position: number): void {
    this.audio?.applyArc(position);
    this.visual?.applyArc(position);
  }

  /** Render one visual frame. Transport time is shared and passed in by the host. */
  render(timeSeconds: number, deltaSeconds: number): void {
    this.visual?.render(timeSeconds, deltaSeconds);
  }

  /** The inviting pre-audio frame: apply the arc and draw a single still frame. */
  renderStill(position: number): void {
    this.visual?.applyArc(position);
    this.visual?.render(0, 0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.audio?.dispose();
    this.visual?.dispose();
  }
}
