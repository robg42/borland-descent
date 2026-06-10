import type { Patch, AudioGraphNode } from '../../patch/schema';

/**
 * Available effect presets the FX-rack can instantiate. Each entry provides a
 * default node spec (id is generated on insert) and a human label.
 */
export interface EffectPreset {
  label: string;
  moduleId: string;
  /** Reasonable defaults for the effect's params. */
  defaultParams: Record<string, number>;
}

export const EFFECT_PRESETS: EffectPreset[] = [
  {
    label: 'Compressor',
    moduleId: 'compressor',
    defaultParams: { threshold: -18, ratio: 2, attack: 0.03, release: 0.25 },
  },
  {
    label: 'Highpass filter',
    moduleId: 'highpass',
    defaultParams: { frequency: 280 },
  },
  {
    label: 'Pitch drift (vibrato)',
    moduleId: 'pitchDrift',
    defaultParams: { frequency: 0.13, depth: 0.22, maxDelay: 0.02 },
  },
  {
    label: 'Convolution reverb',
    moduleId: 'reverb',
    defaultParams: { size: 0.5 },
  },
  {
    label: 'Shimmer',
    moduleId: 'shimmer',
    defaultParams: { pitch: 12, windowSize: 0.1, feedback: 0.35, level: 0.22, decay: 5 },
  },
  {
    label: 'Tape warmth',
    moduleId: 'tapeWarmth',
    defaultParams: {},
  },
];

/**
 * Insert a new effect node before `beforeNodeId` in the patch audio graph.
 * All connections `* → beforeNodeId` are redirected through the new node.
 * Returns a new Patch (immutable — caller provides a structuredClone).
 */
export function insertEffectBefore(
  patch: Patch,
  preset: EffectPreset,
  beforeNodeId: string,
  newNodeId: string,
): Patch {
  const next = structuredClone(patch);

  // Add the new node.
  const newNode: AudioGraphNode = {
    id: newNodeId,
    kind: 'effect',
    moduleId: preset.moduleId,
    params: { ...preset.defaultParams },
  };
  next.audioGraph.nodes.push(newNode);

  // Redirect all connections that currently point to `beforeNodeId`.
  for (const conn of next.audioGraph.connections) {
    if (conn.to === beforeNodeId) {
      conn.to = newNodeId;
    }
  }

  // Add the new node → beforeNodeId connection.
  next.audioGraph.connections.push({ from: newNodeId, to: beforeNodeId });

  return next;
}

/**
 * Remove an effect node and stitch its predecessors directly to its successors.
 * Each `from → nodeId → to` triple becomes `from → to` (one per predecessor×successor).
 * Returns a new Patch.
 */
export function removeEffect(patch: Patch, nodeId: string): Patch {
  const next = structuredClone(patch);

  const preds = next.audioGraph.connections.filter((c) => c.to === nodeId).map((c) => c.from);
  const succs = next.audioGraph.connections.filter((c) => c.from === nodeId).map((c) => c.to);

  // Remove all connections touching the node.
  next.audioGraph.connections = next.audioGraph.connections.filter(
    (c) => c.from !== nodeId && c.to !== nodeId,
  );

  // Stitch predecessors directly to successors.
  for (const pred of preds) {
    for (const succ of succs) {
      if (!next.audioGraph.connections.some((c) => c.from === pred && c.to === succ)) {
        next.audioGraph.connections.push({ from: pred, to: succ });
      }
    }
  }

  // Remove the node from the node list.
  next.audioGraph.nodes = next.audioGraph.nodes.filter((n) => n.id !== nodeId);

  return next;
}

/**
 * Non-destructive node ids — these exist for structural/compositional reasons
 * and are protected from removal in the FX rack.
 */
export const PROTECTED_NODE_IDS = new Set([
  'voices', 'bass', 'composer', 'master', 'glue', 'limiter',
  'dryBus', 'wetBus', 'padDry',
  'masterMeter', 'bassMeter', 'fft', 'wobble',
]);
