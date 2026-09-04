/**
 * Detects a key pressed twice in quick succession.
 *
 * Used for the Escape-Escape that hands the keyboard from the terminal back to the app.
 * The window is deliberately short: a single Escape must still reach the shell promptly,
 * and two Escapes seconds apart are two separate intentions.
 */
export function createDoubleTap(windowMs: number) {
  // -Infinity rather than 0: zero is a legitimate timestamp, and using it as the
  // "nothing yet" sentinel makes the very first tap indistinguishable from no tap.
  const NEVER = Number.NEGATIVE_INFINITY;
  let last = NEVER;
  return {
    /** True when this tap lands within `windowMs` of the previous one. */
    hit(now: number): boolean {
      if (now - last < windowMs) {
        last = NEVER; // consumed; a third tap starts a fresh sequence
        return true;
      }
      last = now;
      return false;
    },
    /** Any other key breaks the sequence. */
    reset(): void {
      last = NEVER;
    },
  };
}
