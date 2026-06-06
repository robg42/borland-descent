import { useEffect, useState } from 'react';
import { Engine, type Patch } from '@borland/engine';

/**
 * StrictMode- and HMR-safe engine lifecycle. The engine is created and disposed
 * symmetrically inside useEffect (NOT via a useRef guard — lazy ref init is unsafe
 * under StrictMode). One instance per (patch, container); disposed on unmount or
 * when either changes. `patch` is set once by the caller, so it is referentially
 * stable and the effect does not thrash.
 */
export function useEngine(patch: Patch | null, container: HTMLElement | null): Engine | null {
  const [engine, setEngine] = useState<Engine | null>(null);

  useEffect(() => {
    if (!patch || !container) return;
    const instance = new Engine({ patch, container });
    setEngine(instance);
    return () => {
      instance.dispose();
      setEngine(null);
    };
  }, [patch, container]);

  return engine;
}
