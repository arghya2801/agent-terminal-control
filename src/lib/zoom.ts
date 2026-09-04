/**
 * Application zoom levels.
 *
 * A fixed ladder rather than repeated multiplication: stepping by a factor accumulates
 * floating-point drift and lands on values like 1.2100000000000002, which then persist
 * to settings and never quite return to 1. The rungs are the familiar browser stops.
 */

export const ZOOM_LEVELS = [0.5, 0.67, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
export const DEFAULT_ZOOM = 1.0;

export const MIN_ZOOM = ZOOM_LEVELS[0];
export const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];

/** Nearest rung to `value`, so a hand-edited settings file still behaves. */
function nearestIndex(value: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < ZOOM_LEVELS.length; i++) {
    const d = Math.abs(ZOOM_LEVELS[i] - value);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

/**
 * One step up (`+1`) or down (`-1`) the ladder, clamped at both ends.
 *
 * A value between rungs snaps in the direction of travel rather than to the nearest
 * rung, so a single keypress always visibly changes the zoom.
 */
export function stepZoom(current: number, direction: 1 | -1): number {
  const safe = Number.isFinite(current) ? current : DEFAULT_ZOOM;
  const i = nearestIndex(safe);
  const onRung = Math.abs(ZOOM_LEVELS[i] - safe) < 1e-9;

  let next: number;
  if (onRung) {
    next = i + direction;
  } else if (direction === 1) {
    // Between rungs: move to the first rung strictly above.
    next = ZOOM_LEVELS[i] > safe ? i : i + 1;
  } else {
    next = ZOOM_LEVELS[i] < safe ? i : i - 1;
  }

  return ZOOM_LEVELS[Math.min(Math.max(next, 0), ZOOM_LEVELS.length - 1)];
}

/** Coerce anything that arrives from settings into a usable level. */
export function normalizeZoom(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_ZOOM;
  return Math.min(Math.max(n, MIN_ZOOM), MAX_ZOOM);
}

/** "125%" for the status readout. */
export function zoomLabel(value: number): string {
  return `${Math.round(normalizeZoom(value) * 100)}%`;
}
