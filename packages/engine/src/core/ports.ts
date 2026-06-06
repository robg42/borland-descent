/**
 * Typed, addressable ports (brief §2). A PortRef is a stable "nodeId.portName".
 * Port DEFINITIONS live in the engine's module registries (§8 #1) — the Patch
 * stores only param values and routes. The matrix validates that a route connects
 * type-compatible ports.
 */

export const PORT_KINDS = ['scalar', 'unipolar', 'bipolar', 'trigger', 'vector'] as const;
export type PortKind = (typeof PORT_KINDS)[number];
export type PortDirection = 'in' | 'out';

/** A stable address "nodeId.portName". The patch schema validates the format. */
export type PortRef = `${string}.${string}`;

export interface PortDef {
  name: string;
  kind: PortKind;
  direction: PortDirection;
  /** Numeric bounds for input ports (informational; the engine clamps). */
  min?: number;
  max?: number;
  default?: number | number[];
}

export function makePortRef(nodeId: string, portName: string): PortRef {
  return `${nodeId}.${portName}`;
}

export function parsePortRef(ref: PortRef): { nodeId: string; portName: string } {
  const dot = ref.indexOf('.');
  return { nodeId: ref.slice(0, dot), portName: ref.slice(dot + 1) };
}

/** Whether an OUTPUT port of kind `from` may drive an INPUT port of kind `to`. */
export function isCompatible(from: PortKind, to: PortKind): boolean {
  if (from === 'trigger' || to === 'trigger') return from === to;
  if (from === 'vector' || to === 'vector') return from === to;
  // scalar / unipolar / bipolar are all numeric — the matrix scales & curves them.
  return true;
}

/** Clamp a numeric value into a port's natural range, given its kind. */
export function clampToKind(value: number, kind: PortKind): number {
  switch (kind) {
    case 'unipolar':
      return Math.min(1, Math.max(0, value));
    case 'bipolar':
      return Math.min(1, Math.max(-1, value));
    case 'trigger':
      return value > 0 ? 1 : 0;
    default:
      return value;
  }
}
