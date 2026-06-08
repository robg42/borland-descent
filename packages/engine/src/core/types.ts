import type { Patch } from '../patch/types';

export interface EngineOptions {
  /** The validated patch the engine renders. */
  patch: Patch;
  /** Which scene to build (index into patch.scenes). Defaults to 0. */
  sceneIndex?: number;
  /** Arc position to start at (0..1) — preserved across a scene rebuild. */
  initialArc?: number;
  /** Container the visual canvas mounts into (player or studio). Optional headless. */
  container?: HTMLElement;
  /** Override prefers-reduced-motion detection. */
  reducedMotion?: boolean;
  /** Drive scene selection from the arc position (the player). The studio leaves this
   *  off and selects scenes manually. */
  autoScene?: boolean;
}

export interface Disposable {
  dispose(): void;
}
