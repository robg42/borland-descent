import * as Tone from 'tone';
import type { ModulationRoute } from '../patch/types';
import type { SignalRegistry } from '../core/registry';
import { isCompatible } from '../core/ports';
import { clamp, smoothingCoeff } from '../core/curves';
import { evaluateControlTargets } from './evaluate';

/**
 * The modulation matrix (brief §2/§9). Control-rate routes are evaluated each frame
 * and smoothed; audio-rate routes are wired ONCE as native Tone connections (LFO →
 * cutoff, etc.) and never written per frame. Bidirectional: audio→visual,
 * gesture/visual→audio.
 */
export class Matrix {
  private readonly audioGains: Tone.Gain[] = [];
  private readonly smoothed = new Map<string, number>();
  private readonly controlRouteByTarget = new Map<string, ModulationRoute>();

  constructor(
    private readonly routes: ModulationRoute[],
    private readonly registry: SignalRegistry,
  ) {}

  /** Wire audio-rate routes as native connections (called once after registration). */
  setup(): void {
    for (const r of this.routes) {
      if (r.enabled === false) continue;
      if (r.rate === 'audio') {
        this.wireAudioRoute(r);
      } else {
        if (!this.controlRouteByTarget.has(r.target)) {
          this.controlRouteByTarget.set(r.target, r);
          const base = this.registry.getInput(r.target)?.base;
          if (base !== undefined) this.smoothed.set(r.target, base);
        }
      }
    }
  }

  private wireAudioRoute(r: ModulationRoute): void {
    const out = this.registry.getOutput(r.source);
    const inp = this.registry.getInput(r.target);
    if (!out?.audioNode || !inp?.audioTarget) {
      console.warn(`[borland] audio-rate route ${r.source}→${r.target} is not connectable; skipped.`);
      return;
    }
    if (!isCompatible(out.kind, inp.kind)) {
      console.warn(`[borland] audio-rate route ${r.source}→${r.target} has incompatible port kinds; skipped.`);
      return;
    }
    const gain = new Tone.Gain(r.amount);
    out.audioNode.connect(gain);
    gain.connect(inp.audioTarget);
    this.audioGains.push(gain);
  }

  /** Evaluate control-rate routes for this frame and write smoothed values. */
  evaluateControl(dt: number): void {
    const targets = evaluateControlTargets(
      this.routes,
      (ref) => this.registry.getOutput(ref)?.read(),
      (ref) => this.registry.getInput(ref)?.base,
    );
    for (const [ref, raw] of targets) {
      const inp = this.registry.getInput(ref);
      if (!inp) continue;
      const ms = this.controlRouteByTarget.get(ref)?.smoothing ?? 0;
      const prev = this.smoothed.get(ref) ?? inp.base;
      const next = prev + (raw - prev) * smoothingCoeff(ms, dt);
      this.smoothed.set(ref, next);
      inp.write(clamp(next, inp.min ?? -Infinity, inp.max ?? Infinity));
    }
  }

  dispose(): void {
    for (const g of this.audioGains) g.dispose();
    this.audioGains.length = 0;
    this.smoothed.clear();
    this.controlRouteByTarget.clear();
  }
}
