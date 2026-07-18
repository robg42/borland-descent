import { describe, expect, it, vi } from 'vitest';
import { Matrix, restoreDroppedControlTargets, routesForScene } from '../src/modulation/matrix';
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
    // numeric → trigger is incompatible (only a trigger may drive a trigger).
    const { registry, writes, source, target } = harness('unipolar', 'trigger');
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

describe('matrix — trigger routes fire decaying envelopes (V2)', () => {
  it('a trigger pulse snaps the target to full and decays over the release', () => {
    const registry = new SignalRegistry();
    const writes: number[] = [];
    let fire = 1;
    registry.addOutput('audio.onset' as PortRef, { kind: 'trigger', read: () => fire });
    registry.addInput('field.flicker' as PortRef, { kind: 'unipolar', base: 0, write: (v) => writes.push(v) });
    // smoothing on a trigger route = the envelope RELEASE in ms.
    const m = new Matrix(
      [route({ source: 'audio.onset' as PortRef, target: 'field.flicker' as PortRef, smoothing: 200 })],
      registry,
    );
    m.setup();
    expect(m.controlTargets().has('field.flicker')).toBe(true);

    m.evaluateControl(0.016); // the pulse frame: attack is instant (no target smoothing)
    expect(writes.at(-1)).toBeCloseTo(1, 5);

    fire = 0;
    m.evaluateControl(0.2); // one release-constant later: e^-1 of the peak remains
    expect(writes.at(-1)).toBeCloseTo(Math.exp(-1), 2);

    m.evaluateControl(0.2);
    expect(writes.at(-1)).toBeCloseTo(Math.exp(-2), 2);
  });
});

describe('matrix — amount is a fraction of the target port range', () => {
  it('scales contributions by the target span so wide ports are actually modulatable', () => {
    const registry = new SignalRegistry();
    const writes: number[] = [];
    registry.addOutput('src.out' as PortRef, { kind: 'unipolar', read: () => 1 });
    // A cutoff-like port: 80–12 080 Hz. With raw-unit amounts (capped at ±1 by the
    // schema) the strongest possible route moved this by ±1 Hz — inaudible.
    registry.addInput('voice.cutoff' as PortRef, {
      kind: 'scalar',
      base: 800,
      min: 80,
      max: 12080,
      write: (v) => writes.push(v),
    });
    const m = new Matrix(
      [route({ source: 'src.out' as PortRef, target: 'voice.cutoff' as PortRef, amount: 0.5 })],
      registry,
    );
    m.setup();
    m.evaluateControl(0.016);
    // base 800 + source 1 × amount 0.5 × span 12 000 = 6 800
    expect(writes.at(-1)).toBeCloseTo(6800);
  });

  it('ports without declared bounds keep the legacy 1:1 amount scale', () => {
    const { registry, writes, source, target } = harness('unipolar', 'scalar', 0.25);
    const m = new Matrix([route({ source, target, amount: 0.5 })], registry);
    m.setup();
    m.evaluateControl(0.016);
    expect(writes.at(-1)).toBeCloseTo(0.75); // base 0.25 + 1 × 0.5 × span 1
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

describe('matrix — per-scene route scoping', () => {
  it('keeps global routes everywhere and tagged routes only in their scene', () => {
    const routes = [
      route({ source: 'a.x' as PortRef, target: 'b.y' as PortRef }), // global
      route({ source: 'a.x' as PortRef, target: 'c.z' as PortRef, sceneId: 'midnight' }),
    ];
    expect(routesForScene(routes, 'midnight').map((r) => r.target)).toEqual(['b.y', 'c.z']);
    expect(routesForScene(routes, 'surface').map((r) => r.target)).toEqual(['b.y']);
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

describe('evaluateControlTargets — reusable output map', () => {
  it('clears and reuses a caller-supplied map without changing results', async () => {
    const { evaluateControlTargets } = await import('../src/modulation/evaluate');
    const routes: ModulationRoute[] = [
      { id: 'r1', source: 'a.out', target: 'b.in', amount: 0.5, curve: 'linear', smoothing: 0, rate: 'control', enabled: true },
    ];
    const read = () => 1;
    const base = () => 0;
    const reused = new Map<string, number>([['stale.ref', 99]]);
    const first = evaluateControlTargets(routes, read, base, undefined, reused);
    expect(first).toBe(reused); // same instance handed back
    expect(first.has('stale.ref')).toBe(false); // cleared before writing
    const fresh = evaluateControlTargets(routes, read, base, undefined);
    expect([...first.entries()]).toEqual([...fresh.entries()]); // identical output either way
  });
});
