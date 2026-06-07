import type { Pass } from 'three/addons/postprocessing/Pass.js';
import type { SignalRegistry } from '../../core/registry';
import type { Scalar } from '../../patch/schema';

/**
 * A visual layer MODULE: a full-screen fragment shader as a post-processing Pass,
 * plus its modulatable uniform ports. Scenes select one by id, so scenes can be
 * structurally different visuals, not just parameter variations (brief §5/§8).
 */
export interface VisualLayer {
  readonly pass: Pass;
  registerPorts(nodeId: string, registry: SignalRegistry, params: Record<string, Scalar>): void;
  update(timeSec: number): void;
  setResolution(width: number, height: number): void;
  /** Arc-driven darkness (0 = surface, 1 = the dark centre). */
  setArc(darkness: number): void;
  dispose(): void;
}

export type VisualLayerFactory = () => VisualLayer;
