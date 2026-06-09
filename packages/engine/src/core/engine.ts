import type { Patch, Scene, ModulationRoute } from '../patch/schema';
import type { EngineOptions } from './types';
import * as Tone from 'tone';
import { Transport } from './transport';
import { unlockAudio, resumeAudio, isAudioRunning } from '../audio/context';
import { SignalRegistry, type InputPortInfo, type OutputPortInfo } from './registry';
import { Rng } from './rng';
import { makePortRef, parsePortRef, type PortRef } from './ports';
import { macrosAt } from './arc';
import { Matrix, restoreDroppedControlTargets } from '../modulation/matrix';
import { GestureController } from '../gesture/gesture';
import { SceneInstance } from './sceneInstance';

/**
 * The engine consumes a validated Patch and renders it. Framework-agnostic: the
 * player and the studio both instantiate this same class with the same Patch.
 *
 * The Engine is a HOST: it owns the shared clock, the gesture input, the shared
 * registry, the master bus and the modulation matrix, and it drives one active
 * SceneInstance (which owns that scene's audio + visual).
 *
 * In `autoScene` mode (the player) the arc position selects the scene: as the arc
 * crosses into another scene's `arcRange`, the host swaps the active SceneInstance in
 * place — the visual switches immediately and the new scene's audio rebuilds — while
 * the transport, gesture and master bus keep running. Exactly one scene is live at a
 * time, so scene ports never collide. The studio leaves `autoScene` off and selects
 * scenes manually. (A crossfade that overlaps two scenes is the §18.2 follow-on.)
 */
export class Engine {
  readonly patch: Patch;
  private activeIndex: number;
  private readonly autoScene: boolean;
  private swapping = false;
  private readonly registry = new SignalRegistry();
  private readonly transport = new Transport();
  private readonly rng: Rng;
  private readonly reducedMotion: boolean;
  private readonly container?: HTMLElement;
  private active: SceneInstance | null = null;
  private masterBus: Tone.Gain | null = null;
  private gesture: GestureController | null = null;
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
    if (opts.patch.scenes.length === 0) throw new Error('Patch has no scenes');
    this.container = opts.container;
    this.autoScene = opts.autoScene ?? false;
    this.routes = opts.patch.modulationMatrix;
    this.rng = new Rng(opts.patch.meta.seed);
    this.manualArc = Math.min(1, Math.max(0, opts.initialArc ?? 0));
    this.reducedMotion =
      opts.reducedMotion ??
      (typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    // In autoScene mode the arc picks the scene; otherwise honour sceneIndex.
    this.activeIndex = this.autoScene
      ? this.coveringScene(this.manualArc)
      : Math.min(opts.patch.scenes.length - 1, Math.max(0, opts.sceneIndex ?? 0));

    const [minBpm, maxBpm] = this.patch.dna.tempoRange;
    this.transport.setBpm((minBpm + maxBpm) / 2);

    // The arc position is itself a modulation SOURCE (arc.darkness, …), read live each
    // frame — so routes can drive anything from the descent (e.g. degradation deepening).
    // Host-level: re-registered after every scene swap (which clears the registry).
    this.registerArcPorts();

    if (opts.container) {
      this.gesture = new GestureController(opts.container);
      this.gesture.setArcPosition(this.manualArc); // preserve arc across a scene rebuild
      this.gesture.registerPorts(this.registry);
      this.active = this.makeScene();
      // a still, inviting first frame before audio is unlocked
      this.active.renderStill(this.arcPosition);
    }
  }

  /** The currently active scene. In autoScene mode this changes as the arc descends. */
  get scene(): Scene {
    return this.patch.scenes[this.activeIndex]!;
  }

  private makeScene(): SceneInstance {
    return new SceneInstance({
      patch: this.patch,
      scene: this.scene,
      registry: this.registry,
      rng: this.rng,
      container: this.container,
      reducedMotion: this.reducedMotion,
    });
  }

  /** Expose the arc macros as modulation SOURCE ports (arc.darkness, arc.density, …),
   *  evaluated at the current arc position each frame. Host-level (survives scene swaps),
   *  so the descent itself can drive params — e.g. tape hiss / pitch drift deepening. */
  private registerArcPorts(): void {
    const keys = [
      'darkness',
      'rhythmicWeight',
      'reverbSize',
      'filterPosition',
      'dissonance',
      'density',
    ] as const;
    for (const key of keys) {
      this.registry.addOutput(makePortRef('arc', key), {
        kind: 'unipolar',
        read: () => macrosAt(this.patch.dna.arc, this.arcPosition)[key],
      });
    }
  }

  /** The scene whose arcRange covers `arc` (clamped to the ends if none does). */
  private coveringScene(arc: number): number {
    const scenes = this.patch.scenes;
    for (let i = 0; i < scenes.length; i++) {
      const [lo, hi] = scenes[i]!.arcRange;
      if (arc >= lo && arc <= hi) return i;
    }
    return arc <= 0 ? 0 : scenes.length - 1;
  }

  /** Like coveringScene, but sticky: stay in the active scene while the arc is still
   *  within its range (plus a small margin), so hovering a boundary doesn't thrash. */
  private sceneIndexForArc(arc: number): number {
    const cur = this.patch.scenes[this.activeIndex];
    if (cur) {
      const [lo, hi] = cur.arcRange;
      const margin = 0.015;
      if (arc >= lo - margin && arc <= hi + margin) return this.activeIndex;
    }
    return this.coveringScene(arc);
  }

  /** Swap the active scene in place: tear down the current one + matrix, build the
   *  next, and re-wire the matrix — while the host (transport, gesture, master bus)
   *  keeps running. The visual switches immediately; the new scene's audio has a short
   *  build latency (its reverb), so there is a brief audio gap a later crossfade will
   *  smooth. One scene is live at a time, so ports never collide. */
  private async swapScene(index: number): Promise<void> {
    if (this.swapping || this.disposed || index === this.activeIndex) return;
    if (index < 0 || index >= this.patch.scenes.length) return;
    this.swapping = true;
    try {
      this.activeIndex = index;
      this.matrix?.dispose();
      this.matrix = null;
      this.active?.dispose();
      this.active = null;
      // reset the registry to host-only ports, then build the incoming scene
      this.registry.clear();
      this.gesture?.registerPorts(this.registry);
      this.registerArcPorts();
      const next = this.makeScene();
      this.active = next;
      next.renderStill(this.arcPosition); // show the new world immediately
      if (this.masterBus) {
        await next.build(); // audio + its ports (async: reverb IR)
        if (this.disposed) return;
        next.output?.connect(this.masterBus);
        this.matrix = new Matrix(this.routes, this.registry);
        this.matrix.setup();
        next.startComposer();
      }
    } finally {
      this.swapping = false;
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
    // The host owns the shared master bus; each scene feeds it through its own gain,
    // so two scenes can be summed and crossfaded (§18.2). One scene wired today.
    this.masterBus = new Tone.Gain(1);
    this.masterBus.connect(Tone.getDestination());
    this.active ??= this.makeScene();
    await this.active.build(); // builds the scene's audio + registers its ports
    this.active.output?.connect(this.masterBus); // scene → shared master → speakers
    this.matrix = new Matrix(this.routes, this.registry);
    this.matrix.setup();
    this.transport.start();
    this.active.startComposer();
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
      const before = this.matrix.controlTargets();
      this.matrix.dispose();
      this.matrix = new Matrix(routes, this.registry);
      this.matrix.setup();
      // any input that lost all its control routes must relax back to base,
      // otherwise it stays frozen at its last modulated value.
      restoreDroppedControlTargets(before, this.matrix.controlTargets(), this.registry);
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
      if (this.autoScene && this.running && !this.swapping) {
        const target = this.sceneIndexForArc(pos);
        if (target !== this.activeIndex) void this.swapScene(target);
      }
      this.active?.applyArc(pos);
      this.matrix?.evaluateControl(dt);
      this.active?.render(this.reducedMotion ? 0 : this.transport.seconds, dt);
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
    this.active?.dispose();
    this.masterBus?.dispose();
    this.gesture?.dispose();
    this.registry.clear();
  }
}
