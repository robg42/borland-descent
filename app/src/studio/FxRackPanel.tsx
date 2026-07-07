import { memo, useCallback, useState } from 'react';
import {
  EFFECT_PRESETS,
  PROTECTED_NODE_IDS,
  insertEffectBefore,
  removeEffect,
  type Patch,
} from '@borland/engine';

interface Props {
  patch: Patch | null;
  onPatchChange: (next: Patch) => void;
}

/** Walk connections and build an ordered node-id list reachable from `start` to `end`. */
function chainBetween(
  connections: Patch['audioGraph']['connections'],
  start: string,
  end: string,
): string[] {
  const adj = new Map<string, string[]>();
  for (const c of connections) {
    const arr = adj.get(c.from) ?? [];
    arr.push(c.to);
    adj.set(c.from, arr);
  }
  // BFS; stop at end
  const visited = new Set<string>();
  const path: string[] = [];
  const queue = [start];
  while (queue.length) {
    const node = queue.shift()!;
    if (visited.has(node)) continue;
    visited.add(node);
    path.push(node);
    if (node === end) break;
    for (const next of adj.get(node) ?? []) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  return path;
}

/**
 * A compact FX-rack view: shows the nodes on key audio paths (voices→master,
 * bass→master), lets you insert new effects before any node, and remove effect
 * nodes. Topology changes rebuild the engine (the caller passes `onPatchChange`
 * which StudioView routes to `setPatch + setReload`).
 */
const FALLBACK_INSERT = 'glue';

export const FxRackPanel = memo(function FxRackPanel({ patch, onPatchChange }: Props) {
  const [selPreset, setSelPreset] = useState(0);
  const [insertBefore, setInsertBefore] = useState(FALLBACK_INSERT);

  const nodes = patch?.audioGraph.nodes ?? [];
  const connections = patch?.audioGraph.connections ?? [];

  // Paths we'll display
  const voicesChain = chainBetween(connections, 'voices', 'master');
  const bassChain = chainBetween(connections, 'bass', 'master');
  const shimmerChain = chainBetween(connections, 'wetBus', 'master');

  // All nodes that could be insert targets (non-source nodes reachable from voices/bass)
  const chainNodes = new Set([...voicesChain, ...bassChain]);
  const insertTargets = nodes.filter((n) => chainNodes.has(n.id) && n.id !== 'voices' && n.id !== 'bass');

  // Reconciled at render time: after an import (or a removal) the remembered id may
  // no longer exist in the graph, which would leave the select DISPLAYING one node
  // while add() silently targets another.
  const effectiveInsertBefore = insertTargets.some((n) => n.id === insertBefore)
    ? insertBefore
    : (insertTargets[0]?.id ?? FALLBACK_INSERT);

  const addEffect = useCallback(() => {
    if (!patch) return;
    const preset = EFFECT_PRESETS[selPreset];
    if (!preset) return;
    const id = `${preset.moduleId}_${Date.now().toString(36).slice(-4)}`;
    onPatchChange(insertEffectBefore(patch, preset, effectiveInsertBefore, id));
  }, [patch, selPreset, effectiveInsertBefore, onPatchChange]);

  const removeNode = useCallback(
    (nodeId: string) => {
      if (!patch) return;
      onPatchChange(removeEffect(patch, nodeId));
    },
    [patch, onPatchChange],
  );

  if (!patch) return <p className="hint">Load a patch to edit its effect chain.</p>;

  return (
    <div className="fx">
      {/* Add effect */}
      <div className="fx__add row">
        <select
          className="field"
          value={selPreset}
          onChange={(e) => setSelPreset(Number(e.target.value))}
        >
          {EFFECT_PRESETS.map((p, i) => (
            <option key={p.moduleId} value={i}>
              {p.label}
            </option>
          ))}
        </select>
        <span className="seq__fl">before</span>
        <select
          className="field"
          value={effectiveInsertBefore}
          onChange={(e) => setInsertBefore(e.target.value)}
        >
          {insertTargets.map((n) => (
            <option key={n.id} value={n.id}>
              {n.id}
            </option>
          ))}
        </select>
        <button className="btn" onClick={addEffect}>
          + add
        </button>
      </div>

      {/* Chain views */}
      <ChainView label="voices → wet" chain={voicesChain} nodes={nodes} onRemove={removeNode} />
      {shimmerChain.length > 1 && (
        <ChainView label="shimmer" chain={shimmerChain} nodes={nodes} onRemove={removeNode} />
      )}
      <ChainView label="bass" chain={bassChain} nodes={nodes} onRemove={removeNode} />
    </div>
  );
});

interface ChainViewProps {
  label: string;
  chain: string[];
  nodes: Patch['audioGraph']['nodes'];
  onRemove: (id: string) => void;
}

function ChainView({ label, chain, nodes, onRemove }: ChainViewProps) {
  if (chain.length === 0) return null;
  return (
    <div className="fx__chain">
      <span className="fx__chain-label">{label}</span>
      <div className="fx__nodes">
        {chain.map((id, i) => {
          const node = nodes.find((n) => n.id === id);
          const isEffect = node?.kind === 'effect';
          const removable = isEffect && !PROTECTED_NODE_IDS.has(id);
          return (
            <div key={id} className="fx__node-wrap">
              {i > 0 && <span className="fx__arrow">→</span>}
              <div className={`fx__node${isEffect ? ' fx__node--effect' : ''}`}>
                <span className="fx__node-id">{id}</span>
                {node?.moduleId && node.moduleId !== id && (
                  <span className="fx__node-mod">{node.moduleId}</span>
                )}
                {removable && (
                  <button
                    className="btn btn--ghost btn--icon fx__remove btn--del"
                    onClick={() => onRemove(id)}
                    title={`Remove ${id}`}
                    aria-label={`remove ${id}`}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
