import type { Patch, Scene, ModulationRoute } from '../patch/schema';
import type { EngineOptions } from './types';
import { Transport } from './transport';
import { unlockAudio, resumeAudio, isAudioRunning } from '../audio/context';
import { SignalRegistry, type InputPortInfo, type OutputPortInfo } from './registry';
import { Rng } from './rng';
import { parsePortRef, type PortRef } from './ports';
import { AudioEngine } from '../audio/audioEngine';
import { VisualEngine } from '../visual/visualEngine';
import { Matrix } from '../modulation/matrix';
import { GestureController } from '../gesture/gesture';

/**
 * The engine consumes a validated Patch and renders it. Framework-agnostic: the
 * player and the studio both instantiate this same class with the same Patch.
 *
 * Visuals + gesture are created up front (the still first frame). Audio is built on
 * start() — inside a user gesture — then the matrix is wired and the single rAF loop
 * runs: read arc from the gesture, apply it, evaluate control-rate routes, render.
 */
export class Engine {
  readonly patch: Patch;
  readonly scene: Scene;
  private readonly registry = new SignalRegistry();
  private readonly transport = new Transport();
  private readonly rng: Rng;
  private readonly reducedMotion: boolean;
  private visual: VisualEngine | null = null;
  private gesture: GestureController | null = null;
  private audio: AudioEngine | null = null;
  private matrix: Matrix | null = null;
  private routes: ModulationRoute[];
  private rafId: number | null = null;
  private lastTs = 0;
  private running = false;
  private disposed = false;
  private manualArc = 0;

  private readonly onVisibilityChange = (): void => {
    if (typeof document === 'undefined') return;
    if (document.hidden) this.stopLoop();
    else if (this.running) this.startLoop();
  };

  constructor(opts: EngineOptions) {
    this.patch = opts.patch;
    const scene = opts.patch.scenes[opts.sceneIndex ?? 0] ?? opts.patch.scenes[0];
    if (!scene) throw new Error('Patch has no scenes');
    this.scene = scene;
    this.routes = opts.patch.modulationMatrix;
    this.rng = new Rng(opts.patch.meta.seed);
    this.manualArc = Math.min(1, Math.max(0, opts.initialArc ?? 0));
    this.reducedMotion =
      opts.reducedMotion ??
      (typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    const [minBpm, maxBpm] = this.patch.dna.tempoRange;
    this.transport.setBpm((minBpm + maxBpm) / 2);

    if (opts.container) {
      this.visual = new VisualEngine({
        patch: this.patch,
        scene,
        registry: this.registry,
        container: opts.container,
        reducedMotion: this.reducedMotion,
      });
      this.gesture = new GestureController(opts.container);
      this.gesture.setArcPosition(this.manualArc); // preserve arc across a scene rebuild
      this.gesture.registerPorts(this.registry);
      // a still, inviting first frame before audio is unlocked
      this.visual.applyArc(this.arcPosition);
      this.visual.render(0, 0);
    }
  }

  /** Unlock audio (MUST be inside a user gesture), build the audio graph + matrix. */
  async start(): Promise<void> {
    if (this.disposed) return;
    if (this.running) {
      this.play();
      return;
    }
    await unlockAudio();
    this.audio = new AudioEngine(this.patch, this.scene, this.rng, this.registry);
    await this.audio.build();
    this.matrix = new Matrix(this.routes, this.registry);
    this.matrix.setup();
    this.transport.start();
    this.audio.startComposer();
    this.running = true;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.startLoop();
  }

  play(): void {
    this.transport.start();
  }
  pause(): void {
    this.transport.pause();
  }
  get isPlaying(): boolean {
    return this.transport.isStarted;
  }
  get isRunning(): boolean {
    return this.running;
  }
  get audioRunning(): boolean {
    return isAudioRunning();
  }
  async resume(): Promise<boolean> {
    return resumeAudio();
  }

  get arcPosition(): number {
    return this.gesture?.arcPosition ?? this.manualArc;
  }
  setArcPosition(v: number): void {
    this.manualArc = Math.min(1, Math.max(0, v));
    this.gesture?.setArcPosition(this.manualArc);
  }

  // ---- studio live-edit surface --------------------------------------------------
  inputs(): InputPortInfo[] {
    return this.registry.listInputs();
  }
  outputs(): OutputPortInfo[] {
    return this.registry.listOutputs();
  }

  /** Set a port's base value live (and keep the working patch in sync for export). */
  setInputBase(ref: string, value: number): void {
    const input = this.registry.getInput(ref);
    if (!input) return;
    input.base = value;
    input.write(value); // unmodulated ports respond immediately; modulated ones next frame
    this.writeParamToPatch(ref, value);
  }

  /** Replace the modulation routes live (re-wires audio-rate connections). */
  setRoutes(routes: ModulationRoute[]): void {
    this.routes = routes;
    this.patch.modulationMatrix = routes;
    if (this.matrix) {
      this.matrix.dispose();
      this.matrix = new Matrix(routes, this.registry);
      this.matrix.setup();
    }
  }

  private writeParamToPatch(ref: string, value: number): void {
    const { nodeId, portName } = parsePortRef(ref as PortRef);
    const audioNode = this.patch.audioGraph.nodes.find((n) => n.id === nodeId);
    if (audioNode) {
      audioNode.params[portName] = value;
      return;
    }
    const visualNode = [...this.patch.visualGraph.layers, ...this.patch.visualGraph.postChain].find(
      (n) => n.id === nodeId,
    );
    if (visualNode) visualNode.params[portName] = value;
  }

  // ---- frame loop ----------------------------------------------------------------
  private startLoop(): void {
    if (this.rafId !== null || typeof requestAnimationFrame === 'undefined') return;
    this.lastTs = 0;
    const tick = (ts: number): void => {
      const dt = this.lastTs === 0 ? 0 : (ts - this.lastTs) / 1000;
      this.lastTs = ts;
      const pos = this.arcPosition;
      this.audio?.applyArc(pos);
      this.visual?.applyArc(pos);
      this.matrix?.evaluateControl(dt);
      this.visual?.render(this.reducedMotion ? 0 : this.transport.seconds, dt);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }
  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.stopLoop();
    this.transport.stop();
    this.matrix?.dispose();
    this.audio?.dispose();
    this.gesture?.dispose();
    this.visual?.dispose();
    this.registry.clear();
  }
}
