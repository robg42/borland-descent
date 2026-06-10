import * as Tone from 'tone';
import type { Patch, Scene } from '../patch/schema';
import type { Rng } from '../core/rng';
import { macrosAt } from '../core/arc';
import type { SignalRegistry } from '../core/registry';
import { createSynth, type SynthModule } from './synths';
import { Analysers } from './analysers';
import { Composer } from './composer/composer';
import { buildAudioNode, type BuiltNode } from './effects/buildAudioNode';

/**
 * The audio engine builds the audio graph from the patch's `audioGraph.nodes` and
 * `connections` (data-driven topology — golden rule §1). An EffectModule registry
 * handles every node kind; the engine wires connections and registers all ports.
 *
 * The limiter lives on the host Engine master bus (not here); the composer drives
 * the voice modules directly and is not in the audio connection chain.
 */
export class AudioEngine {
  private readonly analysers = new Analysers();
  readonly pad: SynthModule;
  readonly bass: SynthModule;
  private readonly composer: Composer;

  private builtNodes = new Map<string, BuiltNode>();
  private disposed = false;

  constructor(
    private readonly patch: Patch,
    scene: Scene,
    rng: Rng,
    private readonly registry: SignalRegistry,
  ) {
    this.pad = createSynth(scene.synthModuleId, { maxPolyphony: scene.audioParams.voices.maxPolyphony });
    this.bass = createSynth('subBass');
    this.composer = new Composer(this.pad, this.bass, patch.dna, scene.audioParams, rng);
  }

  /** Build the graph from patch.audioGraph.nodes + connections. Async: IR + worklet init. */
  async build(): Promise<void> {
    if (this.disposed) return;
    const synths = { voices: this.pad, bass: this.bass };

    // 1. Build all nodes; collect init promises for async effects.
    const initPromises: Array<Promise<void>> = [];
    for (const node of this.patch.audioGraph.nodes) {
      if (node.id === 'limiter') continue; // host-owned; not in the per-scene graph
      const built = buildAudioNode(node, synths, this.analysers);
      this.builtNodes.set(node.id, built);
      if (built.init) initPromises.push(built.init());
    }

    // 2. Await all async inits in parallel (IR load, worklet registration, etc.).
    await Promise.all(initPromises);

    // 3. Wire connections from the patch.
    for (const conn of this.patch.audioGraph.connections) {
      if (conn.to === 'limiter') continue; // limiter lives on the host
      const from = this.builtNodes.get(conn.from);
      const to = this.builtNodes.get(conn.to);
      if (!from?.output || !to?.input) continue;
      from.output.connect(to.input);
    }

    // 4. Register all ports.
    for (const node of this.patch.audioGraph.nodes) {
      if (node.id === 'limiter') continue;
      const built = this.builtNodes.get(node.id);
      if (built) built.registerPorts(node.id, this.registry, node.params);
    }

    // 5. Start nodes that auto-produce signal (LFO, etc.).
    for (const built of this.builtNodes.values()) {
      built.start?.();
    }

    // 6. Bind any user sample to the voices.
    const voicesNode = this.patch.audioGraph.nodes.find((n) => n.id === 'voices');
    if (voicesNode?.sampleId) this.pad.bindSample?.(voicesNode.sampleId);
  }

  startComposer(): void {
    this.composer.start();
  }

  /** Look up a synth by its audioGraph nodeId ('voices' or 'bass'). */
  getSynth(nodeId: string): SynthModule | null {
    if (nodeId === 'bass') return this.bass;
    if (nodeId === 'voices') return this.pad;
    return null;
  }

  /** Refresh the audio features for this frame (engine loop, before the matrix). */
  tickFeatures(dt: number): void {
    this.analysers.update(dt);
  }

  /** Apply arc macros to the global audio feel each frame. */
  applyArc(position: number): void {
    const m = macrosAt(this.patch.dna.arc, position);
    this.composer.density = m.density;
  }

  /** The scene's mixed audio output — the host routes this into the shared master bus.
   *  Returns the 'glue' compressor output if present, else 'master', else the pad output. */
  get output(): Tone.ToneAudioNode {
    return (
      this.builtNodes.get('glue')?.output ??
      this.builtNodes.get('master')?.output ??
      this.pad.output
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.composer.dispose();
    this.pad.dispose();
    this.bass.dispose();
    this.analysers.dispose();
    for (const built of this.builtNodes.values()) {
      built.dispose();
    }
    this.builtNodes.clear();
  }
}
