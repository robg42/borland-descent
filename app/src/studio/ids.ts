/**
 * A stable route id, with a fallback for non-secure contexts — `crypto.randomUUID`
 * is undefined on a plain-http LAN address (e.g. testing on iOS Safari over the
 * local network), where calling it would throw and silently break "add route".
 * Shared by the matrix table and the params panel's one-click automate, so every
 * route id in the document comes from one scheme.
 */
export function routeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The studio's authoring default for route smoothing (ms). The schema's parse
 *  default for hand-written JSON is 50; UI-authored routes have always used 80. */
export const DEFAULT_SMOOTHING_MS = 80;
