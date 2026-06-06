import type { Patch } from '../patch/types';
import type { EngineOptions } from './types';
import { Transport } from './transport';
import { unlockAudio, resumeAudio, isAudioRunning } from '../audio/context';
import { VisualEngine } from '../visual/visualEngine';

/**
 * The engine consumes a validated Patch and renders it. Framework-agnostic: the
 * player and the studio both instantiate this same class with the same Patch.
 *
 * Phase 0: owns the shared transport + a minimal visual engine and the single
 * cancellable rAF loop (paused when the tab is hidden). The audio graph, generative
 * composer, modulation matrix and gesture handling arrive in Phase 1.
 */
export class Engine {
  readonly patch: Patch;
  private readonly transport = new Transport();
  private visual: VisualEngine | null = null;
  private rafId: number | null = null;
  private lastTs = 0;
  private running = false;
  private disposed = false;

  private readonly onVisibilityChange = (): void => {
    if (typeof document === 'undefined') return;
    if (document.hidden) this.pauseLoop();
    else if (this.running) this.startLoop();
  };

  constructor(opts: EngineOptions) {
    this.patch = opts.patch;
    if (opts.container) {
      this.visual = new VisualEngine({
        container: opts.container,
        reducedMotion: opts.reducedMotion,
      });
    }
    const [minBpm, maxBpm] = this.patch.dna.tempoRange;
    this.transport.setBpm((minBpm + maxBpm) / 2);
  }

  /** Unlock audio (MUST be called inside a user gesture), start transport + loop. */
  async start(): Promise<void> {
    if (this.disposed || this.running) return;
    await unlockAudio();
    this.transport.start();
    this.running = true;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.startLoop();
  }

  get isRunning(): boolean {
    return this.running;
  }

  get audioRunning(): boolean {
    return isAudioRunning();
  }

  /** Re-unlock after an iOS interruption/background. May fail; the UI offers a tap. */
  async resume(): Promise<boolean> {
    return resumeAudio();
  }

  private startLoop(): void {
    if (this.rafId !== null || typeof requestAnimationFrame === 'undefined') return;
    this.lastTs = 0;
    const tick = (ts: number): void => {
      const dt = this.lastTs === 0 ? 0 : (ts - this.lastTs) / 1000;
      this.lastTs = ts;
      this.visual?.render(this.transport.seconds, dt);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private pauseLoop(): void {
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
    this.pauseLoop();
    this.transport.stop();
    this.visual?.dispose();
    this.visual = null;
  }
}
