import { useEffect, useRef, useState } from 'react';
import { Engine, type Patch } from '@borland/engine';

/**
 * StrictMode- and HMR-safe engine lifecycle. The engine is created and disposed
 * symmetrically in useEffect (NOT via a useRef guard — lazy ref init is unsafe under
 * StrictMode). The effect keys on `container` and `reloadToken`, NOT the patch
 * object, so the studio can edit patch values live (via engine methods) without
 * tearing down and rebuilding the audio graph. Bump `reloadToken` to force a rebuild
 * (e.g. on Patch import); the latest patch is read from a ref at build time.
 */
export function useEngine(
  patch: Patch | null,
  container: HTMLElement | null,
  reloadToken: number,
): Engine | null {
  const patchRef = useRef(patch);
  patchRef.current = patch;
  const [engine, setEngine] = useState<Engine | null>(null);

  useEffect(() => {
    const current = patchRef.current;
    if (!current || !container) return;
    const instance = new Engine({ patch: current, container });
    setEngine(instance);
    return () => {
      instance.dispose();
      setEngine(null);
    };
    // deps intentionally exclude `patch` — it is read via patchRef so live studio
    // edits don't rebuild the engine; bump `reloadToken` to force a rebuild.
  }, [container, reloadToken]);

  return engine;
}
