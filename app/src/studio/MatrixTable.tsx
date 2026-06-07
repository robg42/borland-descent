import type {
  CurveKind,
  InputPortInfo,
  ModulationRoute,
  OutputPortInfo,
  RouteRate,
} from '@borland/engine';

interface Props {
  routes: ModulationRoute[];
  inputs: InputPortInfo[];
  outputs: OutputPortInfo[];
  onChange: (routes: ModulationRoute[]) => void;
}

const CURVES: CurveKind[] = ['linear', 'exp', 'log', 'sCurve', 'invert'];
const RATES: RouteRate[] = ['control', 'audio'];

/**
 * The modulation matrix as a table (source, target, amount, curve, rate). The
 * studio's working patch is the source of truth; every edit is applied to the live
 * engine via onChange → engine.setRoutes (audio-rate routes are re-wired natively).
 */
export function MatrixTable({ routes, inputs, outputs, onChange }: Props) {
  const update = (i: number, patch: Partial<ModulationRoute>): void => {
    onChange(routes.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const remove = (i: number): void => {
    onChange(routes.filter((_, idx) => idx !== i));
  };
  const add = (): void => {
    onChange([
      ...routes,
      {
        id: crypto.randomUUID(),
        source: outputs[0]?.ref ?? '',
        target: inputs[0]?.ref ?? '',
        amount: 0.5,
        curve: 'linear',
        smoothing: 80,
        rate: 'control',
        enabled: true,
      },
    ]);
  };

  const ready = outputs.length > 0 && inputs.length > 0;

  return (
    <div>
      <table className="matrix">
        <thead>
          <tr>
            <th>on</th>
            <th>source</th>
            <th>target</th>
            <th>amt</th>
            <th>curve</th>
            <th>rate</th>
            <th aria-label="remove" />
          </tr>
        </thead>
        <tbody>
          {routes.map((r, i) => (
            <tr key={r.id}>
              <td>
                <input
                  type="checkbox"
                  checked={r.enabled !== false}
                  onChange={(e) => update(i, { enabled: e.target.checked })}
                />
              </td>
              <td>
                <select className="field" value={r.source} onChange={(e) => update(i, { source: e.target.value })}>
                  {outputs.map((o) => (
                    <option key={o.ref} value={o.ref}>
                      {o.ref}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select className="field" value={r.target} onChange={(e) => update(i, { target: e.target.value })}>
                  {inputs.map((o) => (
                    <option key={o.ref} value={o.ref}>
                      {o.ref}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  className="field matrix__num"
                  type="number"
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
                <button
                  className="btn btn--icon btn--ghost"
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
      <div className="row" style={{ marginTop: '0.7rem' }}>
        <button className="btn" onClick={add} disabled={!ready}>
          add route
        </button>
        {!ready && <span className="hint">Press begin to reveal source &amp; target ports.</span>}
      </div>
    </div>
  );
}

function clampAmount(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(-1, n));
}
