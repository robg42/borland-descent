import type { Patch } from '../patch/types';

export interface EngineOptions {
  /** The validated patch the engine renders. */
  patch: Patch;
  /** Container the visual canvas mounts into (player or studio). Optional headless. */
  container?: HTMLElement;
  /** Override prefers-reduced-motion detection. */
  reducedMotion?: boolean;
}

export interface Disposable {
  dispose(): void;
}
