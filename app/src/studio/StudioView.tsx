import { useCallback, useEffect, useMemo, useState } from 'react';
import { JsonPatchStore, type ModulationRoute, type Patch } from '@borland/engine';
import { useEngine } from '../engineReact/useEngine';
import { TransportBar } from './TransportBar';
import { SceneParams } from './SceneParams';
import { MatrixTable } from './MatrixTable';
import { PatchIO } from './PatchIO';

/**
 * The studio: a live engine instance against the working Patch, beside the controls.
 * Scene parameters and the modulation matrix edit the engine live; the arc can be
 * scrubbed; the Patch round-trips to JSON (brief §11).
 */
export function StudioView() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [patch, setPatch] = useState<Patch | null>(null);
  const [reload, setReload] = useState(0);
  const engine = useEngine(patch, container, patch ? 1 + reload : 0);

  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [arc, setArc] = useState(0);
  const [tick, setTick] = useState(0);
  const [routes, setRoutes] = useState<ModulationRoute[]>([]);

  // load the canonical patch at boot
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

  // reset session state whenever the engine (re)builds
  useEffect(() => {
    setStarted(false);
    setPlaying(false);
    setTick((t) => t + 1);
  }, [engine]);

  useEffect(() => {
    setRoutes(patch?.modulationMatrix ?? []);
  }, [patch]);

  // keep the arc slider in step with gestures on the preview
  useEffect(() => {
    if (!engine) return;
    let raf = 0;
    let last = -1;
    const loop = (): void => {
      const p = engine.arcPosition;
      if (Math.abs(p - last) > 0.001) {
        last = p;
        setArc(p);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  const containerRef = useCallback((node: HTMLDivElement | null) => setContainer(node), []);

  const begin = useCallback(() => {
    if (!engine || busy) return;
    setBusy(true);
    void engine
      .start()
      .then(() => {
        setStarted(true);
        setPlaying(true);
        setTick((t) => t + 1);
      })
      .finally(() => setBusy(false));
  }, [engine, busy]);

  const toggle = useCallback(() => {
    if (!engine) return;
    if (engine.isPlaying) {
      engine.pause();
      setPlaying(false);
    } else {
      engine.play();
      setPlaying(true);
    }
  }, [engine]);

  const onArc = useCallback(
    (v: number) => {
      setArc(v);
      engine?.setArcPosition(v);
    },
    [engine],
  );

  const inputs = useMemo(() => engine?.inputs() ?? [], [engine, tick]);
  const outputs = useMemo(() => engine?.outputs() ?? [], [engine, tick]);

  const applyRoutes = useCallback(
    (next: ModulationRoute[]) => {
      setRoutes(next);
      engine?.setRoutes(next);
    },
    [engine],
  );

  const onImport = useCallback((next: Patch) => {
    setPatch(next);
    setReload((r) => r + 1);
  }, []);

  return (
    <div className="studio">
      <header className="studio__bar">
        <h1 className="studio__title">Borland</h1>
        <span className="studio__tag">descent · studio</span>
      </header>
      <div className="studio__layout">
        <div className="studio__main">
          <section className="panel">
            <div className="panel__head">
              <p className="panel__label">transport</p>
            </div>
            <TransportBar
              engine={engine}
              started={started}
              busy={busy}
              playing={playing}
              arc={arc}
              onBegin={begin}
              onToggle={toggle}
              onArc={onArc}
            />
          </section>

          <section className="panel">
            <div className="panel__head">
              <p className="panel__label">scene parameters</p>
            </div>
            <SceneParams engine={engine} inputs={inputs} />
          </section>

          <section className="panel">
            <div className="panel__head">
              <p className="panel__label">modulation matrix</p>
            </div>
            <MatrixTable routes={routes} inputs={inputs} outputs={outputs} onChange={applyRoutes} />
          </section>

          <section className="panel">
            <div className="panel__head">
              <p className="panel__label">patch</p>
            </div>
            <PatchIO getPatch={() => engine?.patch ?? patch} onImport={onImport} />
          </section>
        </div>

        <aside className="studio__aside">
          <div className="studio__preview">
            <span className="studio__previewLabel">live</span>
            <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
          </div>
          <p className="hint" style={{ marginTop: '0.6rem' }}>
            Drag, scroll or pinch the preview to move through the arc. Edits apply live.
          </p>
        </aside>
      </div>
    </div>
  );
}
