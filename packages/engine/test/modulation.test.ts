import { describe, expect, it, vi } from 'vitest';
import { Matrix, restoreDroppedControlTargets } from '../src/modulation/matrix';
import { SignalRegistry } from '../src/core/registry';
import type { ModulationRoute } from '../src/patch/types';
import type { PortKind, PortRef } from '../src/core/ports';

/**
 * Headless tests for the control-rate matrix behaviour — the studio-edit surface.
 * Audio-rate wiring needs Tone/Web-Audio and is out of scope for the CI gate; these
 * cover the pure control path: type enforcement, deterministic smoothing, and the
 * restore-to-base behaviour when a route is removed.
 */

function route(over: Partial<ModulationRoute> & Pick<ModulationRoute, 'source' | 'target'>): ModulationRoute {
  return {
    id: over.source + '->' + over.target,
    amount: 1,
    curve: 'linear',
    smoothing: 0,
    rate: 'control',
    enabled: true,
    ...over,
  };
}

/** A registry with a single constant output and a single write-capturing input. */
function harness(outKind: PortKind, inKind: PortKind, base = 0): {
  registry: SignalRegistry;
  writes: number[];
  source: PortRef;
  target: PortRef;
} {
  const registry = new SignalRegistry();
  const writes: number[] = [];
  const source = 'src.out' as PortRef;
  const target = 'dst.in' as PortRef;
  registry.addOutput(source, { kind: outKind, read: () => 1 });
  registry.addInput(target, { kind: inKind, base, write: (v) => writes.push(v) });
  return { registry, writes, source, target };
}

describe('matrix — type compatibility (golden rule §4)', () => {
  it('drops an incompatible control route and never writes its target', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // trigger → unipolar is incompatible (trigger only pairs with trigger).
    const { registry, writes, source, target } = harness('trigger', 'unipolar');
    const m = new Matrix([route({ source, target })], registry);
    m.setup();
    expect(m.controlTargets().has(target)).toBe(false);
    m.evaluateControl(0.016);
    expect(writes).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('keeps a numeric control route (unipolar → scalar) and drives its target', () => {
    const { registry, writes, source, target } = harness('unipolar', 'scalar');
    const m = new Matrix([route({ source, target })], registry);
    m.setup();
    expect(m.controlTargets().has(target)).toBe(true);
    m.evaluateControl(0.016); // smoothing 0 → instant
    expect(writes.at(-1)).toBeCloseTo(1); // base 0 + source 1 * amount 1
  });
});

describe('matrix — deterministic smoothing across routes to one target', () => {
  it('uses the slowest (max) smoothing regardless of route order', () => {
    const { registry, writes, source, target } = harness('unipolar', 'scalar');
    // Snappy route first, heavily-smoothed route second; max policy must win.
    const m = new Matrix(
      [
        route({ source, target, amount: 0.5, smoothing: 0 }),
        route({ source, target, amount: 0.5, smoothing: 500 }),
      ],
      registry,
    );
    m.setup();
    m.evaluateControl(0.016); // one ~16ms frame
    // raw target = 0 + 2×(1×0.5) = 1.0; with 500ms smoothing one frame barely moves.
    // 'first-wins' would have used 0ms and jumped straight to 1.0.
    expect(writes.at(-1)).toBeLessThan(0.2);
    expect(writes.at(-1)).toBeGreaterThan(0);
  });
});

describe('matrix — restoreDroppedControlTargets (studio route removal)', () => {
  it('restores a target to base when its only control route is removed', () => {
    const { registry, writes, source, target } = harness('unipolar', 'scalar', 0.4);
    const before = new Matrix([route({ source, target })], registry);
    before.setup();
    before.evaluateControl(0.016); // drive it away from base
    expect(writes.at(-1)).not.toBeCloseTo(0.4);

    const after = new Matrix([], registry); // route removed
    after.setup();
    restoreDroppedControlTargets(before.controlTargets(), after.controlTargets(), registry);
    expect(writes.at(-1)).toBeCloseTo(0.4); // snapped back to base
  });

  it('leaves a surviving target untouched across a route change', () => {
    const { registry, writes, source, target } = harness('unipolar', 'scalar', 0.4);
    const before = new Matrix([route({ source, target })], registry);
    before.setup();
    const after = new Matrix([route({ source, target })], registry); // still present
    after.setup();
    restoreDroppedControlTargets(before.controlTargets(), after.controlTargets(), registry);
    expect(after.controlTargets().has(target)).toBe(true);
    expect(writes).toHaveLength(0); // target survives → no restore write
  });
});
