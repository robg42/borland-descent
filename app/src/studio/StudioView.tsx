import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { JsonPatchStore, type ModulationRoute, type Patch } from '@borland/engine';
import { useEngine } from '../engineReact/useEngine';
import { TransportBar } from './TransportBar';
import { SceneParams } from './SceneParams';
import { MatrixTable } from './MatrixTable';
import { PatchIO } from './PatchIO';

/**
 * The studio: a live engine instance against the working Patch, beside the controls.
 * The scene selector rebuilds the engine for a chosen scene (so both structurally
 * different scenes can be auditioned); scene parameters and the modulation matrix
 * edit the engine live; the arc can be scrubbed; the Patch round-trips to JSON.
 */
export function StudioView() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [patch, setPatch] = useState<Patch | null>(null);
  const [reload, setReload] = useState(0);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [arc, setArc] = useState(0);
  const engine = useEngine(patch, container, patch ? 1 + reload : 0, { sceneIndex, initialArc: arc });

  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [tick, setTick] = useState(0);
  const [routes, setRoutes] = useState<ModulationRoute[]>([]);
  const startedRef = useRef(false);

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

  // whenever the engine (re)builds — boot, scene switch, import — resume if we were
  // already playing (the audio context stays unlocked, so start() needs no gesture).
  useEffect(() => {
    if (!engine) return;
    setTick((t) => t + 1);
    if (startedRef.current) {
      void engine.start().then(() => {
        setStarted(true);
        setPlaying(true);
        setTick((t) => t + 1); // refresh the port list now that audio has built
      });
    } else {
      setStarted(false);
      setPlaying(false);
    }
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
        startedRef.current = true;
        setStarted(true);
        setPlaying(true);
        setTick((t) => t + 1);
      })
      .catch((err: unknown) => console.error('[borland] could not begin', err))
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

  const selectScene = useCallback((index: number) => {
    setSceneIndex(index);
    setReload((r) => r + 1); // rebuild the engine for the chosen scene
  }, []);

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
    setSceneIndex(0);
    setReload((r) => r + 1);
  }, []);

  const scenes = patch?.scenes ?? [];

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
            {scenes.length > 1 && (
              <div className="row" style={{ marginTop: '0.9rem' }}>
                <span className="ctl__name">
                  <b>scene</b>
                </span>
                <select
                  className="field"
                  style={{ maxWidth: '14rem' }}
                  value={sceneIndex}
                  onChange={(e) => selectScene(Number(e.target.value))}
                >
                  {scenes.map((s, i) => (
                    <option key={s.id} value={i}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
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
            Drag, scroll or pinch the preview to move through the arc. Edits apply live;
            switching scene rebuilds the engine.
          </p>
        </aside>
      </div>
    </div>
  );
}
