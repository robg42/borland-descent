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
import { ArcTrack } from './ArcTrack';
import { DEFAULT_SMOOTHING_MS, routeId } from './ids';

/** The workbench editors, one mounted at a time (focus + render cost). */
const TABS = [
  { id: 'params', label: 'params', full: 'scene parameters' },
  { id: 'matrix', label: 'matrix', full: 'modulation matrix' },
  { id: 'sequencer', label: 'sequencer', full: 'sequencer' },
  { id: 'fx', label: 'fx rack', full: 'fx rack' },
  { id: 'samples', label: 'samples', full: 'samples' },
  { id: 'patch', label: 'patch', full: 'patch' },
] as const;
type TabId = (typeof TABS)[number]['id'];
// derived once so a missing label is impossible, not an empty header at runtime
const TAB_FULL = Object.fromEntries(TABS.map((t) => [t.id, t.full])) as Record<TabId, string>;

/**
 * The studio as a console: a sticky RAIL on the left holds the live preview, the
 * transport, an instrument gauge cluster (depth / zone / live tempo) and the scene
 * identity pickers; the BENCH on the right is a tabbed workbench where exactly one
 * editor mounts at a time — the preview never scrolls away, and the editing surface
 * gets the full remaining width instead of a single buried column. On narrow
 * screens the rail compacts to the top and a sticky console strip (begin/play,
 * mute, the ticked depth scrubber) keeps the instrument under the thumbs above the
 * pinned tab strip.
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

  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [tick, setTick] = useState(0);
  const [routes, setRoutes] = useState<ModulationRoute[]>([]);
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [matrixPulse, setMatrixPulse] = useState(false);
  const startedRef = useRef(false);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // dev-only debug handle: lets headless preview verification reach the engine.
  // In an effect (not the render body) so StrictMode's doubled render stays pure.
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __engine?: unknown }).__engine = engine;
  }, [engine]);

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
    setMuted(engine.monitorMuted); // monitor mute is ephemeral engine state
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

  // clear any pending automate-highlight timer on unmount
  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    [],
  );

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

  const onMute = useCallback(() => {
    if (!engine) return;
    const next = !muted;
    engine.setMonitorMuted(next);
    setMuted(next);
  }, [engine, muted]);

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
    // keep the author in the scene they were checking, clamped to the new document
    setSceneIndex((i) => Math.max(0, Math.min(i, next.scenes.length - 1)));
    setReload((r) => r + 1);
  }, []);

  // Stable identity so the memoised FxRackPanel doesn't re-render on every arc tick.
  const onFxPatchChange = useCallback((next: Patch) => {
    setPatch(next);
    setReload((r) => r + 1);
  }, []);

  const getPatch = useCallback(() => engine?.patch ?? patch, [engine, patch]);

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
  // defaulting its source to the arc (so it moves with the descent) — then HAND OVER:
  // flash the new row, pulse the matrix tab if it isn't the one you're looking at.
  const onAutomate = useCallback(
    (target: string) => {
      const source = outputs.find((o) => o.ref === 'arc.darkness')?.ref ?? outputs[0]?.ref;
      if (!source) return;
      const id = routeId();
      const route: ModulationRoute = {
        id,
        source,
        target,
        amount: 0.4,
        curve: 'linear',
        smoothing: DEFAULT_SMOOTHING_MS,
        rate: 'control',
        enabled: true,
      };
      applyRoutes([...routes, route]);
      // The highlight persists until the author ARRIVES on the matrix tab —
      // selectTab starts the fade countdown then. Expiring it from the click
      // would let the flash burn out while the row cannot be seen.
      setHighlightId(id);
      if (tab !== 'matrix') setMatrixPulse(true);
    },
    [outputs, routes, applyRoutes, tab],
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
  const zones = useMemo(
    () => (patch?.scenes ?? []).map((s) => ({ id: s.id, name: s.name, range: s.arcRange })),
    [patch],
  );

  const selectTab = useCallback(
    (id: TabId): void => {
      setTab(id);
      if (id === 'matrix') {
        setMatrixPulse(false); // seen — no need to keep pulsing
        // the author has arrived: give the row flash its full run, then let go
        if (highlightId) {
          if (highlightTimer.current) clearTimeout(highlightTimer.current);
          highlightTimer.current = setTimeout(() => setHighlightId(null), 2500);
        }
      }
    },
    [highlightId],
  );

  const onTabKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      // Roving focus moves from the FOCUSED tab (which may not be the selected one —
      // manual activation: arrows move focus, Enter/Space selects).
      const focusIdx = tabRefs.current.findIndex((el) => el === document.activeElement);
      const idx = focusIdx >= 0 ? focusIdx : TABS.findIndex((t) => t.id === tab);
      let next = -1;
      if (e.key === 'ArrowRight') next = (idx + 1) % TABS.length;
      else if (e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = TABS.length - 1;
      if (next === -1) return;
      e.preventDefault();
      tabRefs.current[next]?.focus();
    },
    [tab],
  );

  return (
    <div className={`studio${started ? ' studio--live' : ''}`}>
      <header className="studio__bar">
        <h1 className="studio__title">Borland</h1>
        <span className="studio__tag">descent · studio</span>
      </header>

      <div className="studio__workspace">
        <aside className="studio__rail">
          <div className="studio__preview">
            <span className="studio__previewLabel">{started ? 'live' : 'standby'}</span>
            {/* this node's identity keys the engine — never move it into a conditional branch */}
            <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
          </div>

          <TransportBar
            engine={engine}
            started={started}
            busy={busy}
            playing={playing}
            muted={muted}
            arc={arc}
            zones={zones}
            editingIndex={sceneIndex}
            onBegin={begin}
            onToggle={toggle}
            onMute={onMute}
            onArc={onArc}
          />

          <dl className="gauges" aria-label="live readouts">
            <div className="gauge">
              <dt className="gauge__label">depth</dt>
              <dd className="gauge__value gauge__value--meter">
                <span className="gauge__meter" aria-hidden="true">
                  <span
                    className="gauge__cursor"
                    style={{ transform: `translateX(${arc * 100}%)` }}
                  />
                </span>
                <span>
                  {(arc * 100).toFixed(0)}
                  <em>%</em>
                </span>
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
                <span className="rail__pickerLabel">editing</span>
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
          <div className="console" role="group" aria-label="live transport">
            {!started ? (
              <button className="btn btn--accent" onClick={begin} disabled={!engine || busy}>
                {busy ? 'beginning…' : 'begin'}
              </button>
            ) : (
              <button className="btn" onClick={toggle}>
                {playing ? 'pause' : 'play'}
              </button>
            )}
            <button
              className={`btn${muted ? ' btn--held' : ''}`}
              onClick={onMute}
              disabled={!engine}
              aria-pressed={muted}
              title="monitor mute: silences the output without touching the patch"
            >
              mute
            </button>
            <ArcTrack value={arc} zones={zones} editingIndex={sceneIndex} onChange={onArc} />
            <span className="console__depth" aria-hidden>
              {Math.round(arc * 100)}%
            </span>
          </div>

          <nav className="tabs" role="tablist" aria-label="studio editors" onKeyDown={onTabKeyDown}>
            {TABS.map((t, i) => (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="bench-panel"
                aria-label={
                  t.id === 'matrix' && routes.length > 0
                    ? `matrix, ${routes.length} routes`
                    : t.id === 'sequencer' && sequences.length > 0
                      ? `sequencer, ${sequences.length} sequences`
                      : undefined
                }
                tabIndex={tab === t.id ? 0 : -1}
                className={`tab${tab === t.id ? ' tab--sel' : ''}${
                  t.id === 'matrix' && matrixPulse ? ' tab--pulse' : ''
                }`}
                onClick={() => selectTab(t.id)}
                onAnimationEnd={t.id === 'matrix' ? () => setMatrixPulse(false) : undefined}
              >
                {t.label}
                {t.id === 'matrix' && routes.length > 0 && (
                  <span className="tab__count" aria-hidden>
                    {routes.length}
                  </span>
                )}
                {t.id === 'sequencer' && sequences.length > 0 && (
                  <span className="tab__count" aria-hidden>
                    {sequences.length}
                  </span>
                )}
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
              <p className="panel__label">{TAB_FULL[tab]}</p>
            </div>
            {tab === 'params' && (
              <SceneParams
                engine={engine}
                inputs={inputs}
                patch={engine?.patch ?? patch}
                canAutomate={outputs.length > 0}
                onAutomate={onAutomate}
              />
            )}
            {tab === 'matrix' && (
              <MatrixTable
                routes={routes}
                inputs={inputs}
                outputs={outputs}
                scenes={sceneRefs}
                highlightId={highlightId}
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
            {tab === 'patch' && <PatchIO getPatch={getPatch} onImport={onImport} />}
          </section>
        </main>
      </div>
    </div>
  );
}
