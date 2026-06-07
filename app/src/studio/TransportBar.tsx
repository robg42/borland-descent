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
