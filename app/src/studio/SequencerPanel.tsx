import { memo, useCallback, useState } from 'react';
import type { InputPortInfo } from '@borland/engine';
import type { Sequence, SequenceStep } from '@borland/engine';

interface Props {
  sequences: Sequence[];
  inputs: InputPortInfo[];
  onChange: (next: Sequence[]) => void;
}

const DEFAULT_STEP: SequenceStep = {
  on: false,
  velocity: 0.8,
  probability: 1,
  lengthSteps: 1,
  ratchet: 1,
  octave: 0,
};

function getStep(steps: SequenceStep[], si: number): SequenceStep {
  return steps[si] ?? { ...DEFAULT_STEP };
}

function putStep(steps: SequenceStep[], si: number, next: SequenceStep): SequenceStep[] {
  const len = Math.max(steps.length, si + 1);
  const out = Array.from({ length: len }, (_, i) => steps[i] ?? { ...DEFAULT_STEP });
  out[si] = next;
  return out;
}

function makeSeq(existing: Sequence[]): Sequence {
  return {
    id: `seq_${(existing.length + 1).toString().padStart(2, '0')}_${Math.random().toString(36).slice(2, 6)}`,
    name: `seq ${existing.length + 1}`,
    enabled: true,
    division: 4,
    length: 16,
    swing: 0,
    humanizeMs: 0,
    gate: 0.8,
    target: { kind: 'notes', nodeId: 'voices' },
    steps: [],
  };
}

export const SequencerPanel = memo(function SequencerPanel({ sequences, inputs, onChange }: Props) {
  const [selSeq, setSelSeq] = useState(0);
  const [selStep, setSelStep] = useState<number | null>(null);

  const seq = sequences[selSeq] ?? null;

  const updateSeq = useCallback(
    (update: Partial<Sequence>) => {
      onChange(sequences.map((s, i) => (i === selSeq ? { ...s, ...update } : s)));
    },
    [selSeq, sequences, onChange],
  );

  const updateStep = useCallback(
    (si: number, update: Partial<SequenceStep>) => {
      if (!seq) return;
      const next = { ...getStep(seq.steps, si), ...update };
      updateSeq({ steps: putStep(seq.steps, si, next) });
    },
    [seq, updateSeq],
  );

  const addSeq = useCallback(() => {
    const next = [...sequences, makeSeq(sequences)];
    onChange(next);
    setSelSeq(next.length - 1);
    setSelStep(null);
  }, [sequences, onChange]);

  const deleteSeq = useCallback(() => {
    const next = sequences.filter((_, i) => i !== selSeq);
    onChange(next);
    setSelSeq(Math.min(selSeq, Math.max(0, next.length - 1)));
    setSelStep(null);
  }, [selSeq, sequences, onChange]);

  const toggleStep = useCallback(
    (si: number) => {
      if (!seq) return;
      const s = getStep(seq.steps, si);
      updateStep(si, { on: !s.on });
      setSelStep(si);
    },
    [seq, updateStep],
  );

  return (
    <div className="seq">
      {/* Sequence tabs */}
      <div className="seq__tabs">
        {sequences.map((s, i) => (
          <button
            key={s.id}
            className={`seq__tab${i === selSeq ? ' seq__tab--sel' : ''}`}
            onClick={() => {
              setSelSeq(i);
              setSelStep(null);
            }}
          >
            {s.name || `seq ${i + 1}`}
          </button>
        ))}
        <button className="btn btn--icon" onClick={addSeq} title="Add sequence" aria-label="add sequence">
          +
        </button>
      </div>

      {seq ? (
        <>
          {/* Header: name, enabled, delete */}
          <div className="seq__head">
            <input
              className="field seq__name"
              value={seq.name}
              onChange={(e) => updateSeq({ name: e.target.value })}
              placeholder="name"
            />
            <label className="seq__toggle">
              <input
                type="checkbox"
                checked={seq.enabled}
                onChange={(e) => updateSeq({ enabled: e.target.checked })}
              />
              on
            </label>
            <button
              className="btn btn--ghost btn--icon btn--del"
              onClick={deleteSeq}
              title="Delete sequence"
              aria-label="delete sequence"
            >
              ×
            </button>
          </div>

          {/* Settings row */}
          <div className="seq__settings">
            <label className="seq__fg">
              <span className="seq__fl">div</span>
              <select
                className="field"
                value={seq.division}
                onChange={(e) => updateSeq({ division: Number(e.target.value) })}
              >
                {[1, 2, 4, 8, 16].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="seq__fg">
              <span className="seq__fl">len</span>
              <input
                type="number"
                className="field"
                min={1}
                max={64}
                value={seq.length}
                onChange={(e) => updateSeq({ length: Math.max(1, Math.min(64, Number(e.target.value))) })}
              />
            </label>
            <label className="seq__fg seq__fg--wide">
              <span className="seq__fl">swing</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={seq.swing}
                onChange={(e) => updateSeq({ swing: Number(e.target.value) })}
              />
            </label>
            <label className="seq__fg seq__fg--wide">
              <span className="seq__fl">gate</span>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.01}
                value={seq.gate}
                onChange={(e) => updateSeq({ gate: Number(e.target.value) })}
              />
            </label>
          </div>

          {/* Target */}
          <div className="seq__settings">
            <label className="seq__fg">
              <span className="seq__fl">type</span>
              <select
                className="field"
                value={seq.target.kind}
                onChange={(e) => {
                  const kind = e.target.value as 'notes' | 'port';
                  updateSeq({
                    target:
                      kind === 'notes'
                        ? { kind: 'notes', nodeId: 'voices' }
                        : { kind: 'port', port: inputs[0]?.ref ?? 'master.gain' },
                  });
                }}
              >
                <option value="notes">notes</option>
                <option value="port">port</option>
              </select>
            </label>
            {seq.target.kind === 'notes' ? (
              <label className="seq__fg">
                <span className="seq__fl">voice</span>
                <select
                  className="field"
                  value={seq.target.nodeId}
                  onChange={(e) => updateSeq({ target: { kind: 'notes', nodeId: e.target.value } })}
                >
                  <option value="voices">voices</option>
                  <option value="bass">bass</option>
                </select>
              </label>
            ) : (
              <label className="seq__fg seq__fg--wide">
                <span className="seq__fl">port</span>
                <select
                  className="field"
                  value={seq.target.kind === 'port' ? seq.target.port : ''}
                  onChange={(e) => updateSeq({ target: { kind: 'port', port: e.target.value } })}
                >
                  {inputs.map((p) => (
                    <option key={p.ref} value={p.ref}>
                      {p.ref}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {/* Step grid */}
          <div className="seq__grid-wrap">
            <div className="seq__grid">
              {Array.from({ length: seq.length }, (_, si) => {
                const step = getStep(seq.steps, si);
                return (
                  <button
                    key={si}
                    className={[
                      'seq__cell',
                      step.on ? 'seq__cell--on' : '',
                      selStep === si ? 'seq__cell--sel' : '',
                      si % 4 === 0 ? 'seq__cell--beat' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => toggleStep(si)}
                    title={`Step ${si + 1}`}
                    aria-label={`step ${si + 1}`}
                    aria-pressed={step.on}
                    style={step.on ? ({ '--vel': step.velocity } as React.CSSProperties) : undefined}
                  />
                );
              })}
            </div>
          </div>

          {/* Per-step detail */}
          {selStep !== null && selStep < seq.length && (
            <StepDetail
              step={getStep(seq.steps, selStep)}
              stepIndex={selStep}
              isNotes={seq.target.kind === 'notes'}
              onChange={(update) => updateStep(selStep, update)}
            />
          )}
        </>
      ) : (
        <p className="hint" style={{ padding: '0.8rem 0' }}>
          No sequences — click + to add one.
        </p>
      )}
    </div>
  );
});

interface StepDetailProps {
  step: SequenceStep;
  stepIndex: number;
  isNotes: boolean;
  onChange: (update: Partial<SequenceStep>) => void;
}

function StepDetail({ step, stepIndex, isNotes, onChange }: StepDetailProps) {
  return (
    <div className="seq__step-detail">
      <span className="seq__step-label">step {stepIndex + 1}</span>

      <div className="ctl">
        <span className="ctl__name">velocity</span>
        <span className="ctl__val">{step.velocity.toFixed(2)}</span>
        <div className="ctl__range">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={step.velocity}
            onChange={(e) => onChange({ velocity: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="ctl">
        <span className="ctl__name">probability</span>
        <span className="ctl__val">{step.probability.toFixed(2)}</span>
        <div className="ctl__range">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={step.probability}
            onChange={(e) => onChange({ probability: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="ctl">
        <span className="ctl__name">ratchet</span>
        <span className="ctl__val">{step.ratchet}×</span>
        <div className="ctl__range row">
          {[1, 2, 3, 4].map((r) => (
            <button
              key={r}
              className={`btn btn--icon${step.ratchet === r ? ' btn--accent' : ''}`}
              onClick={() => onChange({ ratchet: r })}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {isNotes && (
        <>
          <div className="ctl">
            <span className="ctl__name">degree</span>
            <span className="ctl__val">{step.degree ?? 0}</span>
            <div className="ctl__range seq__degree-row">
              {[-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7].map((d) => (
                <button
                  key={d}
                  className={`btn btn--icon seq__degree-btn${(step.degree ?? 0) === d ? ' btn--accent' : ''}`}
                  onClick={() => onChange({ degree: d })}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="ctl">
            <span className="ctl__name">octave</span>
            <span className="ctl__val">
              {step.octave > 0 ? '+' : ''}
              {step.octave}
            </span>
            <div className="ctl__range row">
              {[-2, -1, 0, 1, 2].map((o) => (
                <button
                  key={o}
                  className={`btn btn--icon${step.octave === o ? ' btn--accent' : ''}`}
                  onClick={() => onChange({ octave: o })}
                >
                  {o > 0 ? `+${o}` : o}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {!isNotes && (
        <div className="ctl">
          <span className="ctl__name">value</span>
          <span className="ctl__val">{(step.value ?? 0).toFixed(2)}</span>
          <div className="ctl__range">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={step.value ?? 0}
              onChange={(e) => onChange({ value: Number(e.target.value) })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
