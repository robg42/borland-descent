/**
 * Patch document migrations (REVIEW M8). Runs BEFORE zod validation: each step
 * lifts a document from version N to N+1 structurally; the schema then validates
 * the final shape. Steps must be additive and idempotent — old saved patches keep
 * loading forever, and re-running a migration is harmless.
 */

export const CURRENT_PATCH_VERSION = 2;

type Step = (doc: Record<string, unknown>) => void;

/** version N -> the mutation that lifts a document to N+1. */
const STEPS: Record<number, Step> = {
  // v1 -> v2: sequences enter the Patch (Workstream A).
  1: (doc) => {
    doc.sequences ??= [];
  },
};

/**
 * Migrate an unknown document to CURRENT_PATCH_VERSION. Non-objects and
 * documents without a numeric meta.version pass through untouched — the zod
 * schema rejects (or defaults) them downstream; migration never throws.
 */
export function migratePatch(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return input;
  const doc = structuredClone(input) as Record<string, unknown>;
  const meta = doc.meta;
  if (typeof meta !== 'object' || meta === null) return input;
  const versioned = meta as Record<string, unknown>;
  let version = typeof versioned.version === 'number' ? versioned.version : NaN;
  if (!Number.isInteger(version) || version < 1) return input;
  while (version < CURRENT_PATCH_VERSION) {
    STEPS[version]?.(doc);
    version += 1;
  }
  versioned.version = CURRENT_PATCH_VERSION;
  return doc;
}
