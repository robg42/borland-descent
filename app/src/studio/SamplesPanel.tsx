import { useCallback, useEffect, useRef, useState } from 'react';
import {
  sampleStore,
  previewSample,
  resynthesizeSample,
  type SampleMeta,
  type ResynthSpec,
} from '@borland/engine';
import { loadStaticLibrary } from './staticSamples';

interface Props {
  /** Make the chosen sample the current scene's voice (rebuilds the engine). */
  onAssign: (sampleId: string) => void;
  /** Name of the scene "use" will assign to (for the hint). */
  activeSceneName?: string;
}

type ResynthKind = 'paulstretch' | 'granular';

/**
 * Load your own samples into the engine, audition them, resynthesise them (PaulStretch /
 * granular — offline, producing new derived samples), and assign one as the current
 * scene's voice. Decoded buffers live in the runtime sampleStore (persisted to
 * IndexedDB); a sample that's the scene voice exposes its level / filter / envelope in
 * Scene Parameters for editing and as targets in the Modulation Matrix for automation.
 */
export function SamplesPanel({ onAssign, activeSceneName }: Props) {
  const [samples, setSamples] = useState<SampleMeta[]>([]);
  const [rootMidi, setRootMidi] = useState(60);
  const [busy, setBusy] = useState(false);
  const [libStatus, setLibStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resynthKind, setResynthKind] = useState<ResynthKind>('paulstretch');
  const [stretch, setStretch] = useState(8);
  const [rendering, setRendering] = useState<{ id: string; pct: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    void sampleStore.hydrate().then(() => {
      if (!cancelled) setSamples(sampleStore.list());
    });
    return () => {
      cancelled = true;
      stopRef.current?.();
    };
  }, []);

  const refresh = useCallback(() => setSamples(sampleStore.list()), []);
  const locked = busy || rendering !== null;

  const loadLibrary = useCallback(async () => {
    setError(null);
    setLibStatus('loading…');
    setBusy(true);
    try {
      const r = await loadStaticLibrary();
      refresh();
      const parts: string[] = [];
      if (r.loaded > 0) parts.push(`${r.loaded} loaded`);
      if (r.skipped > 0) parts.push(`${r.skipped} already present`);
      if (r.failed.length > 0) {
        setError(`Failed: ${r.failed.join('; ')}`);
      }
      setLibStatus(parts.length ? parts.join(', ') : 'nothing new in library');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load library.');
      setLibStatus(null);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const onFiles = useCallback(
    async (files: FileList) => {
      setError(null);
      setBusy(true);
      try {
        for (const file of Array.from(files)) {
          const bytes = await file.arrayBuffer();
          await sampleStore.add(file.name, rootMidi, bytes);
        }
        refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load that file.');
      } finally {
        setBusy(false);
      }
    },
    [rootMidi, refresh],
  );

  const preview = useCallback(async (id: string) => {
    stopRef.current?.();
    stopRef.current = await previewSample(id);
  }, []);

  const remove = useCallback(
    async (id: string) => {
      await sampleStore.remove(id);
      refresh();
    },
    [refresh],
  );

  const runResynth = useCallback(
    async (id: string) => {
      setError(null);
      setRendering({ id, pct: 0 });
      try {
        const spec: ResynthSpec =
          resynthKind === 'paulstretch'
            ? { kind: 'paulstretch', stretch }
            : { kind: 'granular', stretch };
        await resynthesizeSample(id, spec, (pct) => setRendering({ id, pct }));
        refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Resynthesis failed.');
      } finally {
        setRendering(null);
      }
    },
    [resynthKind, stretch, refresh],
  );

  return (
    <div>
      <div className="row" style={{ marginBottom: '0.4rem' }}>
        <button className="btn" disabled={locked} onClick={() => void loadLibrary()}>
          load library
        </button>
        {libStatus && <span className="hint">{libStatus}</span>}
      </div>

      <div className="row">
        <button className="btn" disabled={locked} onClick={() => fileRef.current?.click()}>
          {busy ? 'loading…' : 'load sample'}
        </button>
        <span className="ctl__name" style={{ flex: '0 0 auto' }}>
          <b>root midi</b>
        </span>
        <input
          className="field"
          type="number"
          min={0}
          max={127}
          value={rootMidi}
          style={{ width: '4.5rem' }}
          onChange={(e) =>
            setRootMidi(Math.min(127, Math.max(0, parseInt(e.target.value || '60', 10) || 0)))
          }
        />
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files;
            if (f && f.length) void onFiles(f);
            e.target.value = '';
          }}
        />
      </div>

      <div className="row" style={{ marginTop: '0.45rem' }}>
        <span className="ctl__name" style={{ flex: '0 0 auto' }}>
          <b>resynth</b>
        </span>
        <select
          className="field"
          style={{ maxWidth: '9rem' }}
          value={resynthKind}
          onChange={(e) => setResynthKind(e.target.value as ResynthKind)}
        >
          <option value="paulstretch">paulstretch</option>
          <option value="granular">granular</option>
        </select>
        <span className="ctl__name" style={{ flex: '0 0 auto' }}>
          <b>×</b>
        </span>
        <input
          className="field"
          type="number"
          min={1}
          max={50}
          step={1}
          value={stretch}
          style={{ width: '4.5rem' }}
          onChange={(e) =>
            setStretch(Math.min(50, Math.max(1, parseInt(e.target.value || '8', 10) || 1)))
          }
        />
      </div>

      {error && (
        <p className="hint" style={{ color: 'var(--accent-warm)', marginTop: '0.5rem' }}>
          {error}
        </p>
      )}

      {samples.length === 0 ? (
        <p className="hint" style={{ marginTop: '0.6rem' }}>
          Load your own audio (WAV / MP3 / OGG) to play it, resynthesise it, or assign it as the
          current scene's voice. Set <b>root midi</b> to the pitch the recording sounds at (60 =
          middle C).
        </p>
      ) : (
        <div style={{ marginTop: '0.6rem' }}>
          {samples.map((s) => (
            <div
              className="ctl"
              key={s.id}
              style={{ gridTemplateColumns: '1fr auto auto auto auto' }}
            >
              <span className="ctl__name" title={`${s.name} · root ${s.rootMidi}`}>
                {s.name}
              </span>
              <button
                className="btn btn--icon btn--ghost"
                disabled={locked}
                onClick={() => void preview(s.id)}
                title="preview"
              >
                ▶
              </button>
              <button
                className="btn btn--icon"
                disabled={locked}
                onClick={() => onAssign(s.id)}
                title="use as the current scene's voice"
              >
                use
              </button>
              <button
                className="btn btn--icon btn--ghost"
                disabled={locked}
                onClick={() => void runResynth(s.id)}
                title={`resynthesise (${resynthKind} ×${stretch}) → new sample`}
              >
                {rendering?.id === s.id ? `${Math.round(rendering.pct * 100)}%` : '⟳'}
              </button>
              <button
                className="btn btn--icon btn--ghost"
                disabled={locked}
                onClick={() => void remove(s.id)}
                title="remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="hint" style={{ marginTop: '0.6rem' }}>
        <b>Load library</b> fetches samples from <code>app/public/samples/</code> (add files there
        and list them in <code>manifest.json</code>). <b>Load sample</b> picks your own file.
        ⟳ resynthesises into a <em>new</em> derived sample: <b>paulstretch</b> smears to a drone,
        <b>granular</b> re-textures — "×" sets the stretch. "Use" sets
        {activeSceneName ? ` the ${activeSceneName} scene's` : " the current scene's"} voice.
      </p>
    </div>
  );
}
