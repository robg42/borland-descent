import { useRef, useState } from 'react';
import { validatePatch, type Patch } from '@borland/engine';

interface Props {
  getPatch: () => Patch | null;
  onImport: (patch: Patch) => void;
}

/**
 * Patch round-trip. Export downloads the live working patch (with all studio edits)
 * as JSON to commit to patches/borland.json; import validates a JSON file and
 * reloads the engine against it.
 */
export function PatchIO({ getPatch, onImport }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const exportPatch = (): void => {
    const patch = getPatch();
    if (!patch) return;
    const doc: Patch = { ...patch, meta: { ...patch.meta, updatedAt: new Date().toISOString() } };
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'borland.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importPatch = async (file: File): Promise<void> => {
    setError(null);
    try {
      const json: unknown = JSON.parse(await file.text());
      onImport(validatePatch(json));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that patch.');
    }
  };

  return (
    <div>
      <div className="row row--between">
        <button className="btn" onClick={exportPatch}>
          export patch
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          import patch
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importPatch(file);
            e.target.value = '';
          }}
        />
      </div>
      {error && (
        <p className="hint" style={{ color: 'var(--accent-warm)', marginTop: '0.6rem' }}>
          {error}
        </p>
      )}
    </div>
  );
}
