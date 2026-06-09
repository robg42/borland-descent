import { useEffect, useRef, useState } from 'react';
import { Engine, type Patch, type Scene } from '@borland/engine';

interface EngineBuildOpts {
  sceneIndex?: number;
  initialArc?: number;
  autoScene?: boolean;
  onSceneChange?: (scene: Scene) => void;
}

/**
 * StrictMode- and HMR-safe engine lifecycle. The engine is created and disposed
 * symmetrically in useEffect (NOT via a useRef guard — lazy ref init is unsafe under
 * StrictMode). The effect keys on `container` and `reloadToken`, NOT the patch or
 * opts, so the studio can edit values live (via engine methods) without rebuilding
 * the audio graph. Bump `reloadToken` to force a rebuild — e.g. on Patch import or a
 * scene switch; the latest patch + opts are read from refs at build time.
 */
export function useEngine(
  patch: Patch | null,
  container: HTMLElement | null,
  reloadToken: number,
  opts?: EngineBuildOpts,
): Engine | null {
  const patchRef = useRef(patch);
  patchRef.current = patch;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const [engine, setEngine] = useState<Engine | null>(null);

  useEffect(() => {
    const current = patchRef.current;
    if (!current || !container) return;
    const instance = new Engine({
      patch: current,
      container,
      sceneIndex: optsRef.current?.sceneIndex,
      initialArc: optsRef.current?.initialArc,
      autoScene: optsRef.current?.autoScene,
      onSceneChange: optsRef.current?.onSceneChange,
    });
    setEngine(instance);
    return () => {
      instance.dispose();
      setEngine(null);
    };
    // deps intentionally exclude patch/opts — read via refs; bump reloadToken to rebuild
  }, [container, reloadToken]);

  return engine;
}
