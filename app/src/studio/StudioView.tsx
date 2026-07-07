import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  JsonPatchStore,
  SYNTH_MODULE_IDS,
  VISUAL_MODULE_IDS,
  type ModulationRoute,
  type Patch,
  type Sequence,
} from '@borland/engine';
import { useEngine } from '../engineReact/useEngine';
import { TransportBar } from './TransportBar';
import { SceneParams } from './SceneParams';
import { MatrixTable } from './MatrixTable';
import { PatchIO } from './PatchIO';
import { SamplesPanel } from './SamplesPanel';
import { SequencerPanel } from './SequencerPanel';
import { FxRackPanel } from './FxRackPanel';

/** The workbench editors, one mounted at a time (focus + render cost). */
const TABS = [
  { id: 'params', label: 'params' },
  { id: 'matrix', label: 'matrix' },
  { id: 'sequencer', label: 'sequencer' },
  { id: 'fx', label: 'fx rack' },
  { id: 'samples', label: 'samples' },
  { id: 'patch', label: 'patch' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/**
 * The studio as a console: a sticky RAIL on the left holds the live preview, the
 * transport, an instrument gauge cluster (depth / zone / live tempo) and the scene
 * identity pickers; the BENCH on the right is a tabbed workbench where exactly one
 * editor mounts at a time — the preview never scrolls away, and the editing surface
 * gets the full remaining width instead of a single buried column. On narrow
 * screens the rail compacts to the top and the tab strip pins below the header.
 */
export function StudioView() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [patch, setPatch] = useState<Patch | null>(null);
  const [reload, setReload] = useState(0);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [arc, setArc] = useState(0);
  const [bpm, setBpm] = useState(0);
  const [tab, setTab] = useState<TabId>('params');
  const engine = useEngine(patch, container, patch ? 1 + reload : 0, { sceneIndex, initialArc: arc });
  // dev-only debug handle: lets headless preview verification reach the engine
  if (import.meta.env.DEV) (window as unknown as { __engine?: unknown }).__engine = engine;

  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [tick, setTick] = useState(0);
  const [routes, setRoutes] = useState<ModulationRoute[]>([]);
  const [sequences, setSequences] = useState<Sequence[]>([]);
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
    setSequences(patch?.sequences ?? []);
  }, [patch]);

  // keep the arc slider + the tempo gauge in step with the live engine
  useEffect(() => {
    if (!engine) return;
    let raf = 0;
    let last = -1;
    let lastBpm = -1;
    const loop = (): void => {
      const p = engine.arcPosition;
      if (Math.abs(p - last) > 0.001) {
        last = p;
        setArc(p);
      }
      const b = engine.bpm;
      if (Math.abs(b - lastBpm) > 0.05) {
        lastBpm = b;
        setBpm(b);
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

  // Re-snapshot on tab switches too: with one editor mounted at a time, a params
  // edit made before leaving the tab must show its CURRENT base on return.
  const inputs = useMemo(() => engine?.inputs() ?? [], [engine, tick, tab]);
  const outputs = useMemo(() => engine?.outputs() ?? [], [engine, tick, tab]);

  const applyRoutes = useCallback(
    (next: ModulationRoute[]) => {
      setRoutes(next);
      engine?.setRoutes(next);
    },
    [engine],
  );

  const applySequences = useCallback(
    (next: Sequence[]) => {
      setSequences(next);
      engine?.setSequences(next);
    },
    [engine],
  );

  const onImport = useCallback((next: Patch) => {
    setPatch(next);
    setSceneIndex(0);
    setReload((r) => r + 1);
  }, []);

  // Stable identity so the memoised FxRackPanel doesn't re-render on every arc tick.
  const onFxPatchChange = useCallback((next: Patch) => {
    setPatch(next);
    setReload((r) => r + 1);
  }, []);

  // Assign a loaded sample as the current scene's voice: point the scene + its 'voices'
  // node at the sampler module and reference the sample by id, then rebuild the engine.
  const assignSample = useCallback(
    (sampleId: string) => {
      setPatch((prev) => {
        if (!prev) return prev;
        const next = structuredClone(prev);
        const sc = next.scenes[sceneIndex];
        if (sc) sc.synthModuleId = 'sampler';
        const voices = next.audioGraph.nodes.find((n) => n.id === 'voices');
        if (voices) {
          voices.moduleId = 'sampler';
          voices.sampleId = sampleId;
        }
        return next;
      });
      setReload((r) => r + 1);
    },
    [sceneIndex],
  );

  // One-click automate: drop a control route targeting a parameter into the matrix,
  // defaulting its source to the arc (so it moves with the descent) — tune it from there.
  const onAutomate = useCallback(
    (target: string) => {
      const source = outputs.find((o) => o.ref === 'arc.darkness')?.ref ?? outputs[0]?.ref;
      if (!source) return;
      const id = `auto_${target.replace(/\W/g, '_')}_${Math.random().toString(36).slice(2, 7)}`;
      const route: ModulationRoute = {
        id,
        source,
        target,
        amount: 0.4,
        curve: 'linear',
        smoothing: 80,
        rate: 'control',
        enabled: true,
      };
      applyRoutes([...routes, route]);
    },
    [outputs, routes, applyRoutes],
  );

  // Set the active scene's voice to any registered synth module, then rebuild the engine.
  const setVoice = useCallback(
    (moduleId: string) => {
      setPatch((prev) => {
        if (!prev) return prev;
        const next = structuredClone(prev);
        const sc = next.scenes[sceneIndex];
        if (sc) sc.synthModuleId = moduleId;
        const voices = next.audioGraph.nodes.find((n) => n.id === 'voices');
        if (voices) {
          voices.moduleId = moduleId;
          if (moduleId !== 'sampler') delete voices.sampleId;
        }
        return next;
      });
      setReload((r) => r + 1);
    },
    [sceneIndex],
  );

  // Set the active scene's visual module, then rebuild the engine (V1 rebuild:
  // modules are interchangeable behind the descriptor contract).
  const setShader = useCallback(
    (moduleId: string) => {
      setPatch((prev) => {
        if (!prev) return prev;
        const next = structuredClone(prev);
        const sc = next.scenes[sceneIndex];
        if (sc) sc.shaderModuleId = moduleId;
        const layer = next.visualGraph.layers[0];
        if (layer) layer.moduleId = moduleId;
        return next;
      });
      setReload((r) => r + 1);
    },
    [sceneIndex],
  );

  const scenes = patch?.scenes ?? [];
  const sceneRefs = useMemo(() => scenes.map((s) => ({ id: s.id, name: s.name })), [scenes]);

  const TAB_LABELS: Record<TabId, string> = {
    params: 'scene parameters',
    matrix: 'modulation matrix',
    sequencer: 'sequencer',
    fx: 'fx rack',
    samples: 'samples',
    patch: 'patch',
  };

  return (
    <div className="studio">
      <header className="studio__bar">
        <h1 className="studio__title">Borland</h1>
        <span className="studio__tag">descent · studio</span>
      </header>

      <div className="studio__workspace">
        <aside className="studio__rail">
          <div className="studio__preview">
            <span className="studio__previewLabel">live</span>
            <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
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

          <dl className="gauges" aria-label="live readouts">
            <div className="gauge">
              <dt className="gauge__label">depth</dt>
              <dd className="gauge__value">
                {(arc * 100).toFixed(0)}
                <em>%</em>
              </dd>
            </div>
            <div className="gauge">
              <dt className="gauge__label">zone</dt>
              <dd className="gauge__value gauge__value--name">{scenes[sceneIndex]?.name ?? '—'}</dd>
            </div>
            <div className="gauge">
              <dt className="gauge__label">tempo</dt>
              <dd className="gauge__value">
                {started && bpm > 0 ? bpm.toFixed(1) : '—'}
                <em>bpm</em>
              </dd>
            </div>
          </dl>

          <div className="rail__pickers">
            {scenes.length > 1 && (
              <label className="rail__picker">
                <span className="rail__pickerLabel">scene</span>
                <select
                  className="field"
                  value={sceneIndex}
                  onChange={(e) => selectScene(Number(e.target.value))}
                >
                  {scenes.map((s, i) => (
                    <option key={s.id} value={i}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="rail__picker">
              <span className="rail__pickerLabel">voice</span>
              <select
                className="field"
                value={scenes[sceneIndex]?.synthModuleId ?? ''}
                onChange={(e) => setVoice(e.target.value)}
              >
                {SYNTH_MODULE_IDS.filter((id) => id !== 'subBass').map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            <label className="rail__picker">
              <span className="rail__pickerLabel">visual</span>
              <select
                className="field"
                value={scenes[sceneIndex]?.shaderModuleId ?? ''}
                onChange={(e) => setShader(e.target.value)}
              >
                {VISUAL_MODULE_IDS.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="hint">
            Drag, scroll or pinch the preview to move through the arc. Edits apply live;
            switching scene, voice or visual rebuilds the engine.
          </p>
        </aside>

        <main className="studio__bench">
          <nav className="tabs" role="tablist" aria-label="studio editors">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="bench-panel"
                className={`tab${tab === t.id ? ' tab--sel' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <section
            id="bench-panel"
            role="tabpanel"
            aria-labelledby={`tab-${tab}`}
            className="panel panel--bench"
          >
            <div className="panel__head">
              <p className="panel__label">{TAB_LABELS[tab]}</p>
            </div>
            {tab === 'params' && (
              <SceneParams
                engine={engine}
                inputs={inputs}
                patch={engine?.patch ?? patch}
                onAutomate={onAutomate}
              />
            )}
            {tab === 'matrix' && (
              <MatrixTable
                routes={routes}
                inputs={inputs}
                outputs={outputs}
                scenes={sceneRefs}
                onChange={applyRoutes}
              />
            )}
            {tab === 'sequencer' && (
              <SequencerPanel sequences={sequences} inputs={inputs} onChange={applySequences} />
            )}
            {tab === 'fx' && (
              <FxRackPanel patch={engine?.patch ?? patch} onPatchChange={onFxPatchChange} />
            )}
            {tab === 'samples' && (
              <SamplesPanel onAssign={assignSample} activeSceneName={scenes[sceneIndex]?.name} />
            )}
            {tab === 'patch' && (
              <PatchIO getPatch={() => engine?.patch ?? patch} onImport={onImport} />
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
