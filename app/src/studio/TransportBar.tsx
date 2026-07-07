import { useState } from 'react';
import type { Engine } from '@borland/engine';

interface Props {
  engine: Engine | null;
  started: boolean;
  busy: boolean;
  playing: boolean;
  arc: number;
  onBegin: () => void;
  onToggle: () => void;
  onArc: (v: number) => void;
}

export function TransportBar({ engine, started, busy, playing, arc, onBegin, onToggle, onArc }: Props) {
  // Monitor mute is ephemeral engine state (never saved with the patch); mirror
  // it locally so the button re-renders — it survives rebuilds on Tone's side.
  const [muted, setMuted] = useState(() => engine?.monitorMuted ?? false);
  const toggleMute = (): void => {
    if (!engine) return;
    engine.setMonitorMuted(!muted);
    setMuted(!muted);
  };
  return (
    <div className="transport">
      {!started ? (
        <button className="btn btn--accent" onClick={onBegin} disabled={!engine || busy}>
          {busy ? 'beginning…' : 'begin'}
        </button>
      ) : (
        <button className="btn" onClick={onToggle}>
          {playing ? 'pause' : 'play'}
        </button>
      )}
      <button
        className="btn"
        onClick={toggleMute}
        disabled={!engine}
        title="monitor mute — silences the output without touching the patch"
        aria-pressed={muted}
      >
        {muted ? 'unmute' : 'mute'}
      </button>
      <div className="transport__arc">
        <span className="ctl__name">
          <b>arc</b>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={arc}
          onChange={(e) => onArc(parseFloat(e.target.value))}
        />
        <span className="ctl__val">{arc.toFixed(2)}</span>
      </div>
    </div>
  );
}
