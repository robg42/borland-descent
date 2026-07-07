import type { Patch, Scene } from '../patch/types';

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
  /** Drive scene selection from the arc position (the player). The studio pins a
   *  scene by default and enables this for its voyage (hear-the-piece) mode. */
  autoScene?: boolean;
  /** Called when a scene handover BEGINS (the crossfade announces the scene being
   *  entered) — the player fades in the scene's name. */
  onSceneChange?: (scene: Scene) => void;
  /** Called when a scene handover COMPLETES: the incoming scene's registry is now
   *  the active one and its ports are addressable. Hosts that snapshot ports (the
   *  studio's editors) must refresh HERE, not at onSceneChange — at fade start the
   *  incoming ports are not yet the active registry. */
  onSceneSettled?: (scene: Scene) => void;
}

export interface Disposable {
  dispose(): void;
}
