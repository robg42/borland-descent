import type { ModulationRoute } from '../patch/types';
import { applyCurve } from '../core/curves';

/**
 * Pure control-rate evaluation: for each enabled control route, shape the source by
 * its curve, scale by amount, and accumulate onto the target's base value. Returns
 * the raw (un-smoothed, un-clamped) target values. Smoothing + clamping + writing
 * happen in the Matrix (stateful), as do trigger envelopes — which is why the
 * source reader receives the whole ROUTE: trigger routes read their envelope,
 * numeric routes read their registry port. Kept pure so it is unit-testable.
 */
export function evaluateControlTargets(
  routes: ModulationRoute[],
  readSource: (route: ModulationRoute) => number | undefined,
  baseOf: (ref: string) => number | undefined,
  out?: Map<string, number>,
): Map<string, number> {
  // A caller-owned `out` map is cleared and reused — the Matrix runs this every
  // frame, so allocating a fresh Map per call is avoidable GC pressure.
  const targets = out ?? new Map<string, number>();
  targets.clear();
  for (const r of routes) {
    if (r.enabled === false || r.rate !== 'control') continue;
    const src = readSource(r);
    if (src === undefined) continue;
    const base = baseOf(r.target);
    if (base === undefined) continue;
    const contribution = applyCurve(src, r.curve) * r.amount;
    targets.set(r.target, (targets.get(r.target) ?? base) + contribution);
  }
  return targets;
}
