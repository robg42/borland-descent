import { memo, useEffect, useRef } from 'react';
import {
  isCompatible,
  type CurveKind,
  type InputPortInfo,
  type ModulationRoute,
  type OutputPortInfo,
  type RouteRate,
} from '@borland/engine';
import { DEFAULT_SMOOTHING_MS, routeId } from './ids';

interface Props {
  routes: ModulationRoute[];
  inputs: InputPortInfo[];
  outputs: OutputPortInfo[];
  /** Scene ids + names for the per-route scope picker (empty = global-only UI). */
  scenes: Array<{ id: string; name: string }>;
  /** Route id to flash + scroll into view (the one-click-automate handoff). */
  highlightId?: string | null;
  onChange: (routes: ModulationRoute[]) => void;
}

const CURVES: CurveKind[] = ['linear', 'exp', 'log', 'sCurve', 'invert'];
const RATES: RouteRate[] = ['control', 'audio'];

/** Group port snapshots by their node id, preserving registry order. */
function groupByNode<T extends { ref: string }>(list: T[]): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const o of list) {
    const node = o.ref.split('.')[0] ?? o.ref;
    const arr = groups.get(node);
    if (arr) arr.push(o);
    else groups.set(node, [o]);
  }
  return [...groups.entries()];
}

const portName = (ref: string): string => ref.split('.')[1] ?? ref;

/**
 * The modulation matrix as a table (source, target, amount, curve, rate, smoothing,
 * scope). The studio's working patch is the source of truth; every edit is applied
 * to the live engine via onChange → engine.setRoutes (audio-rate routes are re-wired
 * natively). Target options are filtered to ports type-compatible with the chosen
 * source, so the table cannot author a route the engine would reject (golden rule
 * §4). A route's scope (`sceneId`) limits wiring to one scene — the natural home
 * for routes whose target port only exists in that scene's visual module.
 */
export const MatrixTable = memo(function MatrixTable({
  routes,
  inputs,
  outputs,
  scenes,
  highlightId,
  onChange,
}: Props) {
  const highlightRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    if (highlightId) highlightRef.current?.scrollIntoView({ block: 'nearest' });
  }, [highlightId]);

  const update = (i: number, patch: Partial<ModulationRoute>): void => {
    onChange(routes.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const remove = (i: number): void => {
    onChange(routes.filter((_, idx) => idx !== i));
  };
  /** Inputs whose kind is compatible with the given source ref (all, if unknown). */
  const targetsFor = (sourceRef: string): InputPortInfo[] => {
    const srcKind = outputs.find((o) => o.ref === sourceRef)?.kind;
    return srcKind ? inputs.filter((inp) => isCompatible(srcKind, inp.kind)) : inputs;
  };
  /** Change a route's source, keeping its target compatible (reset it if not). */
  const changeSource = (i: number, r: ModulationRoute, source: string): void => {
    const opts = targetsFor(source);
    const target = opts.some((o) => o.ref === r.target) ? r.target : (opts[0]?.ref ?? r.target);
    update(i, { source, target });
  };
  const add = (): void => {
    const source = outputs[0];
    const target = source ? (targetsFor(source.ref)[0] ?? inputs[0]) : inputs[0];
    onChange([
      ...routes,
      {
        id: routeId(),
        source: source?.ref ?? '',
        target: target?.ref ?? '',
        amount: 0.5,
        curve: 'linear',
        smoothing: DEFAULT_SMOOTHING_MS,
        rate: 'control',
        enabled: true,
      },
    ]);
  };

  const ready = outputs.length > 0 && inputs.length > 0;

  return (
    <div>
      <p className="hint matrix__hint">
        amt is a fraction of the target port's range: ±1 sweeps it fully · smoothing eases
        control routes (ms)
      </p>
      <div className="matrix-wrap">
      <table className="matrix">
        <thead>
          <tr>
            <th>on</th>
            <th>source</th>
            <th>target</th>
            <th>amt</th>
            <th>curve</th>
            <th>rate</th>
            <th title="smoothing (ms)">ms</th>
            <th>scope</th>
            <th aria-label="remove" />
          </tr>
        </thead>
        <tbody>
          {routes.map((r, i) => (
            <tr
              key={r.id}
              ref={r.id === highlightId ? highlightRef : undefined}
              className={r.id === highlightId ? 'matrix__row--new' : undefined}
            >
              <td>
                <input
                  type="checkbox"
                  aria-label={`route ${i + 1} enabled`}
                  checked={r.enabled !== false}
                  onChange={(e) => update(i, { enabled: e.target.checked })}
                />
              </td>
              <td>
                <select
                  className="field"
                  aria-label="source port"
                  value={r.source}
                  onChange={(e) => changeSource(i, r, e.target.value)}
                >
                  {/* a stored ref the current scene doesn't register must still DISPLAY
                      truthfully — without this the select silently shows option #1 */}
                  {!outputs.some((o) => o.ref === r.source) && (
                    <option value={r.source}>{r.source} ⋯</option>
                  )}
                  {groupByNode(outputs).map(([node, ports]) => (
                    <optgroup key={node} label={node}>
                      {ports.map((o) => (
                        <option key={o.ref} value={o.ref}>
                          {portName(o.ref)} · {o.kind}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </td>
              <td>
                <select
                  className="field"
                  aria-label="target port"
                  title={
                    targetsFor(r.source).some((o) => o.ref === r.target)
                      ? undefined
                      : `${r.target} is not a port of the active scene; the route stays authored and wires when its scene is live`
                  }
                  value={r.target}
                  onChange={(e) => update(i, { target: e.target.value })}
                >
                  {!targetsFor(r.source).some((o) => o.ref === r.target) && (
                    <option value={r.target}>{r.target} ⋯</option>
                  )}
                  {groupByNode(targetsFor(r.source)).map(([node, ports]) => (
                    <optgroup key={node} label={node}>
                      {ports.map((o) => (
                        <option key={o.ref} value={o.ref}>
                          {portName(o.ref)} · {o.kind}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </td>
              <td>
                <input
                  className="field matrix__num"
                  type="number"
                  aria-label="amount"
                  title="amount: fraction of the target port's range (±1 = the full range)"
                  step={0.05}
                  min={-1}
                  max={1}
                  value={r.amount}
                  onChange={(e) => update(i, { amount: clampAmount(parseFloat(e.target.value)) })}
                />
              </td>
              <td>
                <select
                  className="field"
                  aria-label="curve"
                  value={r.curve}
                  onChange={(e) => update(i, { curve: e.target.value as CurveKind })}
                >
                  {CURVES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  className="field"
                  aria-label="rate"
                  value={r.rate}
                  onChange={(e) => update(i, { rate: e.target.value as RouteRate })}
                >
                  {RATES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  className="field matrix__num"
                  type="number"
                  aria-label="smoothing (ms)"
                  title="smoothing: how quickly a control-rate route eases to its target, in ms"
                  step={10}
                  min={0}
                  max={2000}
                  value={r.smoothing}
                  disabled={r.rate === 'audio'}
                  onChange={(e) => update(i, { smoothing: clampSmoothing(parseFloat(e.target.value)) })}
                />
              </td>
              <td>
                <select
                  className="field"
                  aria-label="scene scope"
                  title="scope: wired only while this scene is active; global otherwise"
                  value={r.sceneId ?? ''}
                  onChange={(e) => update(i, { sceneId: e.target.value || undefined })}
                >
                  <option value="">global</option>
                  {scenes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <button
                  className="btn btn--icon btn--ghost btn--del"
                  onClick={() => remove(i)}
                  aria-label="remove route"
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <div className="row matrix__foot">
        <button className="btn" onClick={add} disabled={!ready}>
          add route
        </button>
        {!ready && <span className="hint">Press begin to reveal source &amp; target ports.</span>}
      </div>
    </div>
  );
});

function clampAmount(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(-1, n));
}

function clampSmoothing(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SMOOTHING_MS;
  return Math.round(Math.min(2000, Math.max(0, n)));
}
