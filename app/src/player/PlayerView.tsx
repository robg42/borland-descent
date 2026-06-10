import { useCallback, useEffect, useRef, useState } from 'react';
import { JsonPatchStore, audioContextState, type Patch, type Scene } from '@borland/engine';
import { useEngine } from '../engineReact/useEngine';

/**
 * The player. Opens on a still, inviting first frame; a single tap unlocks audio
 * and starts the transport (brief §7/§10). You touch the space, not controls.
 *
 * iOS sometimes does not open the audio output on the first gesture: if the context is
 * not `running` after begin, the veil stays up as a "tap for sound" prompt that shows
 * the context state and resumes on a second tap.
 */
export function PlayerView() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [patch, setPatch] = useState<Patch | null>(null);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [audioState, setAudioState] = useState('');
  const [sceneName, setSceneName] = useState('');
  const [nameVisible, setNameVisible] = useState(false);
  const nameTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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

  // Fade the scene's name in as you enter it, then back out after a couple of seconds.
  const handleSceneChange = useCallback((scene: Scene) => {
    setSceneName(scene.name);
    setNameVisible(true);
    if (nameTimer.current) clearTimeout(nameTimer.current);
    nameTimer.current = setTimeout(() => setNameVisible(false), 2000);
  }, []);
  useEffect(
    () => () => {
      if (nameTimer.current) clearTimeout(nameTimer.current);
    },
    [],
  );

  const engine = useEngine(patch, container, patch ? 1 : 0, {
    autoScene: true,
    onSceneChange: handleSceneChange,
  });

  const begin = useCallback(() => {
    if (!engine || busy) return;
    setBusy(true);
    void engine
      .start()
      .then(() => {
        setStarted(true);
        // iOS may not have opened output yet — surface the state and offer a resume.
        setAudioBlocked(!engine.audioRunning);
        setAudioState(audioContextState());
      })
      .catch((err: unknown) => console.error('[borland] could not begin', err))
      .finally(() => setBusy(false));
  }, [engine, busy]);

  const resume = useCallback(() => {
    if (!engine) return;
    void engine.resume().then((ok) => {
      setAudioState(audioContextState());
      setAudioBlocked(!ok);
    });
  }, [engine]);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainer(node);
  }, []);

  // The veil hides only once audio is actually running. Before begin it starts; if iOS
  // blocked output, it becomes a "tap for sound" prompt that resumes on a second tap.
  const veilUp = !started || audioBlocked;
  const onVeilTap = started ? resume : begin;
  const ready = Boolean(engine) && !busy;
  const label = busy
    ? 'beginning…'
    : !engine
      ? 'loading…'
      : audioBlocked
        ? `tap for sound · audio ${audioState || 'blocked'}`
        : 'tap to begin';

  return (
    <main className="player">
      <div className="player__canvas" ref={containerRef} />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: '8%',
          right: '8%',
          bottom: 'calc(15% + env(safe-area-inset-bottom, 0px))',
          textAlign: 'center',
          pointerEvents: 'none',
          color: 'rgba(238, 242, 248, 0.92)',
          fontSize: 'clamp(1.05rem, 5vw, 1.6rem)',
          fontWeight: 300,
          letterSpacing: '0.28em',
          textTransform: 'uppercase',
          lineHeight: 1.3,
          textShadow: '0 1px 30px rgba(0, 0, 0, 0.75)',
          opacity: nameVisible ? 1 : 0,
          transition: `opacity ${nameVisible ? '0.8s' : '1.2s'} ease`,
        }}
      >
        {sceneName}
      </div>
      <button
        type="button"
        className={`veil${veilUp ? '' : ' veil--hidden'}`}
        onClick={onVeilTap}
        aria-label={started ? 'Resume audio' : 'Begin'}
        aria-hidden={!veilUp}
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
