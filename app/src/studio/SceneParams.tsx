import { useEffect, useState } from 'react';
import type { Engine, InputPortInfo } from '@borland/engine';

interface Props {
  engine: Engine | null;
  inputs: InputPortInfo[];
}

/**
 * Scene parameters, driven entirely by the engine's port registry — every
 * modulatable input becomes a slider. Editing sets the port's base value live
 * (and the engine keeps the working patch in sync for export).
 */
export function SceneParams({ engine, inputs }: Props) {
  const [vals, setVals] = useState<Record<string, number>>({});

  // reset local overrides when the port set changes (e.g. after begin / import)
  useEffect(() => {
    setVals({});
  }, [inputs]);

  if (inputs.length === 0) {
    return <p className="hint">Press begin to start audio and reveal the scene’s parameters.</p>;
  }

  const set = (ref: string, v: number): void => {
    setVals((s) => ({ ...s, [ref]: v }));
    engine?.setInputBase(ref, v);
  };

  return (
    <div>
      {inputs.map((p) => {
        const min = p.min ?? 0;
        const max = p.max ?? 1;
        const value = vals[p.ref] ?? p.base;
        const parts = p.ref.split('.');
        const node = parts[0] ?? p.ref;
        const port = parts[1] ?? '';
        const step = (max - min) / 200 || 0.01;
        return (
          <div className="ctl" key={p.ref}>
            <span className="ctl__name" title={p.ref}>
              <b>{node}.</b>
              {port}
            </span>
            <span className="ctl__val">{format(value)}</span>
            <input
              className="ctl__range"
              type="range"
              min={min}
              max={max}
              step={step}
              value={value}
              onChange={(e) => set(p.ref, parseFloat(e.target.value))}
            />
          </div>
        );
      })}
    </div>
  );
}

function format(v: number): string {
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2);
}
