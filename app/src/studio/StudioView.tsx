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

/**
 * The studio: a live engine instance against the working Patch. The live preview +
 * transport sit in a sticky stage pinned to the top, so you see and hear changes as
 * you make them; the editing panels scroll beneath. The scene selector rebuilds the
 * engine for a chosen scene (so both structurally different scenes can be auditioned).
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

  return (
    <div className="studio">
      <header className="studio__bar">
        <h1 className="studio__title">Borland</h1>
        <span className="studio__tag">descent · studio</span>
      </header>

      <div className="studio__stage">
        <div className="studio__preview">
          <span className="studio__previewLabel">live</span>
          <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
        </div>
        <div className="studio__stageControls">
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
            <div className="row">
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
          <div className="row">
            <span className="ctl__name">
              <b>voice</b>
            </span>
            <select
              className="field"
              style={{ maxWidth: '14rem' }}
              value={scenes[sceneIndex]?.synthModuleId ?? ''}
              onChange={(e) => setVoice(e.target.value)}
            >
              {SYNTH_MODULE_IDS.filter((id) => id !== 'subBass').map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <span className="ctl__name">
              <b>visual</b>
            </span>
            <select
              className="field"
              style={{ maxWidth: '14rem' }}
              value={scenes[sceneIndex]?.shaderModuleId ?? ''}
              onChange={(e) => setShader(e.target.value)}
            >
              {VISUAL_MODULE_IDS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </div>
          <p className="hint">
            Drag, scroll or pinch the preview to move through the arc. Edits apply live;
            switching scene, voice or visual rebuilds the engine.
          </p>
        </div>
      </div>

      <div className="studio__panels">
        <section className="panel">
          <div className="panel__head">
            <p className="panel__label">scene parameters</p>
          </div>
          <SceneParams
            engine={engine}
            inputs={inputs}
            patch={engine?.patch ?? patch}
            onAutomate={onAutomate}
          />
        </section>

        <section className="panel">
          <div className="panel__head">
            <p className="panel__label">modulation matrix</p>
          </div>
          <MatrixTable routes={routes} inputs={inputs} outputs={outputs} onChange={applyRoutes} />
        </section>

        <section className="panel">
          <div className="panel__head">
            <p className="panel__label">samples</p>
          </div>
          <SamplesPanel onAssign={assignSample} activeSceneName={scenes[sceneIndex]?.name} />
        </section>

        <section className="panel">
          <div className="panel__head">
            <p className="panel__label">fx rack</p>
          </div>
          <FxRackPanel patch={engine?.patch ?? patch} onPatchChange={onFxPatchChange} />
        </section>

        <section className="panel">
          <div className="panel__head">
            <p className="panel__label">sequencer</p>
          </div>
          <SequencerPanel sequences={sequences} inputs={inputs} onChange={applySequences} />
        </section>

        <section className="panel">
          <div className="panel__head">
            <p className="panel__label">patch</p>
          </div>
          <PatchIO getPatch={() => engine?.patch ?? patch} onImport={onImport} />
        </section>
      </div>
    </div>
  );
}
