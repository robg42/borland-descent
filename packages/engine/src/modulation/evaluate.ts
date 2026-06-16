import type { ModulationRoute } from '../patch/types';
import { applyCurve } from '../core/curves';

/**
 * Pure control-rate evaluation: for each enabled control route, shape the source by
 * its curve, scale by amount, and accumulate onto the target's base value. Returns
 * the raw (un-smoothed, un-clamped) target values. Smoothing + clamping + writing
 * happen in the Matrix (stateful), as do trigger envelopes — which is why the
 * source reader receives the whole ROUTE: trigger routes read their envelope,
 * numeric routes read their registry port. Kept pure so it is unit-testable.
 *
 * Contributions are normalised by the TARGET PORT'S SPAN (`spanOf`, max − min,
 * 1 when unknown): `amount` is a fraction of the port's range, not a raw value
 * in the port's units. Without this, the schema's ±1 amount cap makes any port
 * with a range wider than ~1 (a cutoff in Hz, a detune in cents) unmodulatable —
 * the shipped zoom→cutoff route moved an 80–12 000 Hz filter by ±1 Hz.
 */
export function evaluateControlTargets(
  routes: ModulationRoute[],
  readSource: (route: ModulationRoute) => number | undefined,
  baseOf: (ref: string) => number | undefined,
  spanOf?: (ref: string) => number,
): Map<string, number> {
  const targets = new Map<string, number>();
  for (const r of routes) {
    if (r.enabled === false || r.rate !== 'control') continue;
    const src = readSource(r);
    if (src === undefined) continue;
    const base = baseOf(r.target);
    if (base === undefined) continue;
    const span = spanOf?.(r.target) ?? 1;
    const contribution = applyCurve(src, r.curve) * r.amount * span;
    targets.set(r.target, (targets.get(r.target) ?? base) + contribution);
  }
  return targets;
}
