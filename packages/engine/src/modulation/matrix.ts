import * as Tone from 'tone';
import type { ModulationRoute } from '../patch/types';
import type { SignalRegistry, SignalInput, SignalOutput } from '../core/registry';
import { isCompatible } from '../core/ports';
import { clamp, smoothingCoeff } from '../core/curves';
import { evaluateControlTargets } from './evaluate';

/**
 * The modulation matrix (brief §2/§9). Control-rate routes are evaluated each frame
 * and smoothed; audio-rate routes are wired ONCE as native Tone connections (LFO →
 * cutoff, etc.) and never written per frame. Bidirectional: audio→visual,
 * gesture/visual→audio.
 *
 * Type-compatibility (golden rule §4) is enforced here for BOTH rates: a route whose
 * ports are unknown or kind-incompatible is warned about and dropped, never silently
 * summed or wired. When several control routes share one target their contributions
 * sum, but a single deterministic smoothing — the slowest (max) across those routes —
 * governs the result, so reordering routes can no longer change the feel.
 */
export class Matrix {
  private readonly audioGains: Tone.Gain[] = [];
  /** Enabled, type-compatible control routes with both ports registered. */
  private readonly controlRoutes: ModulationRoute[] = [];
  /** Last smoothed value written per control target. */
  private readonly smoothed = new Map<string, number>();
  /** Effective smoothing (ms) per control target — the max across its routes. */
  private readonly smoothingByTarget = new Map<string, number>();

  constructor(
    private readonly routes: ModulationRoute[],
    private readonly registry: SignalRegistry,
  ) {}

  /** Validate every route, wire the audio-rate ones, and prepare the control-rate ones. */
  setup(): void {
    for (const r of this.routes) {
      if (r.enabled === false) continue;
      const out = this.registry.getOutput(r.source);
      const inp = this.registry.getInput(r.target);
      if (!out || !inp) {
        console.warn(
          `[borland] route ${r.source}→${r.target}: unknown ${!out ? 'source' : 'target'} port; skipped.`,
        );
        continue;
      }
      if (!isCompatible(out.kind, inp.kind)) {
        console.warn(
          `[borland] route ${r.source}→${r.target}: incompatible port kinds (${out.kind}→${inp.kind}); skipped.`,
        );
        continue;
      }
      if (r.rate === 'audio') {
        this.wireAudioRoute(r, out, inp);
        continue;
      }
      // control-rate: accumulate per-target, smoothing = slowest route to that target
      this.controlRoutes.push(r);
      this.smoothingByTarget.set(r.target, Math.max(this.smoothingByTarget.get(r.target) ?? 0, r.smoothing));
      if (!this.smoothed.has(r.target)) this.smoothed.set(r.target, inp.base);
    }
  }

  private wireAudioRoute(r: ModulationRoute, out: SignalOutput, inp: SignalInput): void {
    if (!out.audioNode || !inp.audioTarget) {
      console.warn(`[borland] audio-rate route ${r.source}→${r.target} is not natively connectable; skipped.`);
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
      this.controlRoutes,
      (ref) => this.registry.getOutput(ref)?.read(),
      (ref) => this.registry.getInput(ref)?.base,
    );
    for (const [ref, raw] of targets) {
      const inp = this.registry.getInput(ref);
      if (!inp) continue;
      const ms = this.smoothingByTarget.get(ref) ?? 0;
      const prev = this.smoothed.get(ref) ?? inp.base;
      const next = prev + (raw - prev) * smoothingCoeff(ms, dt);
      this.smoothed.set(ref, next);
      inp.write(clamp(next, inp.min ?? -Infinity, inp.max ?? Infinity));
    }
  }

  /** The set of inputs currently driven by at least one enabled control route. */
  controlTargets(): Set<string> {
    return new Set(this.smoothingByTarget.keys());
  }

  dispose(): void {
    for (const g of this.audioGains) g.dispose();
    this.audioGains.length = 0;
    this.controlRoutes.length = 0;
    this.smoothed.clear();
    this.smoothingByTarget.clear();
  }
}

/**
 * After a live route change, snap any input that was a control target before but is
 * no longer back to its base value. Without this a removed or disabled route would
 * leave its target frozen at the last modulated value — it would simply stop being
 * written, never relaxing to base (the studio-edit freeze bug).
 */
export function restoreDroppedControlTargets(
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
  registry: SignalRegistry,
): void {
  for (const ref of before) {
    if (after.has(ref)) continue;
    const inp = registry.getInput(ref);
    if (inp) inp.write(inp.base);
  }
}
