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

/**
 * One step up (`+1`) or down (`-1`) the ladder, clamped at both ends.
 *
 * A value between rungs moves to the next rung in the direction of travel, so a
 * keypress always changes something even if settings were hand-edited off-ladder.
 */
export function stepZoom(current: number, direction: 1 | -1): number {
  const z = normalizeZoom(current);
  const next =
    direction === 1 ? ZOOM_LEVELS.find((l) => l > z) : ZOOM_LEVELS.findLast((l) => l < z);
  return next ?? z;
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
