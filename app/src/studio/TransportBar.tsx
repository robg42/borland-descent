import type { Engine } from '@borland/engine';
import { ArcTrack, type ArcZone } from './ArcTrack';

interface Props {
  engine: Engine | null;
  started: boolean;
  busy: boolean;
  playing: boolean;
  /** Monitor mute — owned by StudioView so the rail and the mobile console strip agree. */
  muted: boolean;
  arc: number;
  zones: ArcZone[];
  editingIndex: number;
  onBegin: () => void;
  onToggle: () => void;
  onMute: () => void;
  onArc: (v: number) => void;
}

export function TransportBar({
  engine,
  started,
  busy,
  playing,
  muted,
  arc,
  zones,
  editingIndex,
  onBegin,
  onToggle,
  onMute,
  onArc,
}: Props) {
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
      {/* constant name + aria-pressed (APG toggle pattern); .btn--held carries the visual */}
      <button
        className={`btn${muted ? ' btn--held' : ''}`}
        onClick={onMute}
        disabled={!engine}
        title="monitor mute: silences the output without touching the patch"
        aria-pressed={muted}
      >
        mute
      </button>
      <div className="transport__arc">
        <span className="ctl__name">
          <b>arc</b>
        </span>
        <ArcTrack value={arc} zones={zones} editingIndex={editingIndex} onChange={onArc} />
        <span className="ctl__val">{arc.toFixed(2)}</span>
      </div>
    </div>
  );
}
