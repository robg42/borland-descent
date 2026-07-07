import { memo, type CSSProperties, useEffect, useState } from 'react';
import type { Engine, InputPortInfo, Patch } from '@borland/engine';

interface Props {
  engine: Engine | null;
  inputs: InputPortInfo[];
  /** The working patch — used to classify each port's node (synth / effect / mix / visual). */
  patch: Patch | null;
  /** Add a modulation route targeting this port (one-click automate). */
  onAutomate?: (target: string) => void;
}

/** Display order + labels for the parameter sections. */
const CATEGORIES: Array<{ key: string; label: string }> = [
  { key: 'synth', label: 'synth' },
  { key: 'effects', label: 'effects' },
  { key: 'mix', label: 'mix' },
  { key: 'visual', label: 'visual' },
  { key: 'other', label: 'other' },
];

/** Classify a node id into a parameter section by its role in the patch graph. */
function categoryOf(nodeId: string, patch: Patch | null): string {
  const a = patch?.audioGraph.nodes.find((n) => n.id === nodeId);
  if (a) {
    if (a.kind === 'synthModule') return 'synth';
    if (a.kind === 'effect') return 'effects';
    return 'mix'; // master / bus
  }
  const visual = [...(patch?.visualGraph.layers ?? []), ...(patch?.visualGraph.postChain ?? [])];
  if (visual.some((n) => n.id === nodeId)) return 'visual';
  return 'other';
}

/**
 * Scene parameters, driven by the engine's port registry, organised into Synth / Effects
 * / Mix / Visual sections (so the synthesis controls are up top, not buried under the
 * visual params). Every modulatable input is a slider; editing sets the port's base value
 * live; the ⤳ button drops a modulation route targeting the parameter into the matrix.
 */
export const SceneParams = memo(function SceneParams({ engine, inputs, patch, onAutomate }: Props) {
  const [vals, setVals] = useState<Record<string, number>>({});

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

  // group ports by node, then bucket node-groups into sections by category
  const nodeGroups = new Map<string, InputPortInfo[]>();
  for (const p of inputs) {
    const node = p.ref.split('.')[0] ?? p.ref;
    const list = nodeGroups.get(node);
    if (list) list.push(p);
    else nodeGroups.set(node, [p]);
  }
  const byCategory = new Map<string, Array<[string, InputPortInfo[]]>>();
  for (const entry of nodeGroups) {
    const cat = categoryOf(entry[0], patch);
    const arr = byCategory.get(cat) ?? [];
    arr.push(entry);
    byCategory.set(cat, arr);
  }

  const ctl = (p: InputPortInfo) => {
    const value = vals[p.ref] ?? p.base;
    const port = p.ref.split('.')[1] ?? p.ref;

    if (p.kind === 'option' && p.options && p.options.length > 0) {
      const idx = Math.round(value);
      return (
        <div className="ctl" key={p.ref} style={{ gridTemplateColumns: '1fr auto' }}>
          <span className="ctl__name" title={p.ref}>{port}</span>
          <span />
          <select
            className="ctl__range field"
            value={p.options[idx] ?? p.options[0]}
            onChange={(e) => {
              const i = p.options!.indexOf(e.target.value);
              if (i >= 0) set(p.ref, i);
            }}
          >
            {p.options.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
      );
    }

    const min = p.min ?? 0;
    const max = p.max ?? 1;
    const step = (max - min) / 200 || 0.01;
    return (
      <div className="ctl" key={p.ref} style={{ gridTemplateColumns: '1fr auto auto' }}>
        <span className="ctl__name" title={p.ref}>
          {port}
        </span>
        <span className="ctl__val">{format(value)}</span>
        {onAutomate ? (
          <button
            className="btn btn--icon btn--ghost"
            title="automate — add a route targeting this parameter"
            onClick={() => onAutomate(p.ref)}
          >
            ⤳
          </button>
        ) : (
          <span />
        )}
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
  };

  const audioReady = byCategory.has('synth');

  return (
    <div className="params">
      {!audioReady && (
        <p className="hint" style={{ marginBottom: '0.4rem' }}>
          Press begin — the synth, effects and mix load with the audio.
        </p>
      )}
      {CATEGORIES.filter((c) => byCategory.has(c.key)).map((c) => (
        <div key={c.key}>
          <p style={CAT_STYLE}>{c.label}</p>
          {byCategory.get(c.key)!.map(([node, ports]) => (
            <div key={node} className="params__node">
              <p style={NODE_STYLE}>{node}</p>
              {ports.map(ctl)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
});

const CAT_STYLE: CSSProperties = {
  fontSize: '0.66rem',
  textTransform: 'uppercase',
  letterSpacing: '0.2em',
  color: 'var(--ink)',
  fontWeight: 600,
  margin: '1.1rem 0 0.2rem',
  paddingBottom: '0.3rem',
  borderBottom: '1px solid var(--hairline)',
};

const NODE_STYLE: CSSProperties = {
  fontSize: '0.58rem',
  textTransform: 'uppercase',
  letterSpacing: '0.16em',
  color: 'var(--accent)',
  margin: '0.55rem 0 0.05rem',
};

function format(v: number): string {
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2);
}
