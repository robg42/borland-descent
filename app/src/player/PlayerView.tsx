import { useCallback, useEffect, useState } from 'react';
import { JsonPatchStore, type Patch } from '@borland/engine';
import { useEngine } from '../engineReact/useEngine';

/**
 * The player. Opens on a still, inviting first frame; a single tap unlocks audio
 * and starts the transport (brief §7/§10). You touch the space, not controls.
 */
export function PlayerView() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [patch, setPatch] = useState<Patch | null>(null);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);

  // Load the canonical patch at boot; the store falls back to the bundled default.
  useEffect(() => {
    let cancelled = false;
    const store = new JsonPatchStore({ url: `${import.meta.env.BASE_URL}borland.json` });
    void store.load().then((loaded) => {
      if (!cancelled) setPatch(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const engine = useEngine(patch, container, patch ? 1 : 0, { autoScene: true });

  const begin = useCallback(() => {
    if (!engine || busy || started) return;
    setBusy(true);
    void engine
      .start()
      .then(() => setStarted(true))
      .catch((err: unknown) => console.error('[borland] could not begin', err))
      .finally(() => setBusy(false));
  }, [engine, busy, started]);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainer(node);
  }, []);

  const ready = Boolean(engine) && !busy;
  const label = busy ? 'beginning…' : engine ? 'tap to begin' : 'loading…';

  return (
    <main className="player">
      <div className="player__canvas" ref={containerRef} />
      <button
        type="button"
        className={`veil${started ? ' veil--hidden' : ''}`}
        onClick={begin}
        aria-label="Begin"
        aria-hidden={started}
      >
        <span className="wordmark">
          Bor<em>land</em>
        </span>
        <span className="tagline">descent</span>
        <span className="begin" data-state={ready ? 'ready' : 'loading'}>
          {label}
        </span>
      </button>
    </main>
  );
}
