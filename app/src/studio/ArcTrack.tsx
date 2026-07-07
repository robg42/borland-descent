export interface ArcZone {
  id: string;
  name: string;
  range: [number, number];
}

interface Props {
  value: number;
  /** Scene zones in arc order (from patch.scenes[i].arcRange — never equal divisions). */
  zones: ArcZone[];
  /** Index of the scene being edited — its span gets the teal band tint. */
  editingIndex?: number;
  onChange: (v: number) => void;
}

/**
 * The depth-gauge scrubber: the arc slider with scene-boundary tick marks and an
 * "editing here" band, all positioned from real patch data. The decorations live
 * in an aria-hidden calibration layer inset by half the thumb width, so tick
 * percentages share the thumb-centre's travel space; the native range input
 * remains the only control, so keyboard and assistive behaviour are untouched —
 * it just also announces where in the descent (and which zone) the position lands.
 */
export function ArcTrack({ value, zones, editingIndex, onChange }: Props) {
  const editing = editingIndex !== undefined ? zones[editingIndex] : undefined;
  const zone = zones.find((z) => value >= z.range[0] && value <= z.range[1]);
  const pct = Math.round(value * 100);
  return (
    <div className="arc">
      <span aria-hidden className="arc__cal">
        {editing && (
          <span
            className="arc__band"
            style={{
              left: `${editing.range[0] * 100}%`,
              width: `${(editing.range[1] - editing.range[0]) * 100}%`,
            }}
          />
        )}
        {zones.slice(1).map((z) => (
          <span key={z.id} className="arc__tick" style={{ left: `${z.range[0] * 100}%` }} />
        ))}
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.005}
        value={value}
        aria-label="arc position"
        aria-valuetext={zone ? `${pct}%, ${zone.name}` : `${pct}%`}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}
