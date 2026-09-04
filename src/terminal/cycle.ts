/** Wrap-around index arithmetic for cycling tabs, kept pure so it can be tested. */

/**
 * The index `delta` steps from `current`, wrapping in both directions.
 *
 * JavaScript's `%` keeps the sign of the dividend, so `-1 % 3` is `-1` rather than `2`.
 * Cycling backward off the start therefore needs the extra `+ len` before the second
 * modulo, or Ctrl+Shift+Tab on the first tab would select nothing.
 */
export function cycleIndex(current: number, len: number, delta: number): number {
  if (len <= 0) return 0;
  return (((current + delta) % len) + len) % len;
}
