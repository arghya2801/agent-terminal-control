/** Small display helpers, kept pure so they can be unit tested. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Compact "how long ago", for session rows. Deliberately coarse: the sidebar is for
 * recognising a session, not for timing it.
 */
export function relativeTime(ms: number, now: number = Date.now()): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const delta = now - ms;
  if (delta < 0) return 'now';
  if (delta < MINUTE) return 'now';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`;
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d`;
  if (delta < 365 * DAY) return `${Math.floor(delta / (7 * DAY))}w`;
  return `${Math.floor(delta / (365 * DAY))}y`;
}

/** Middle-elide a path so both the drive and the leaf stay readable in a tooltip. */
export function shortenPath(path: string, max = 44): string {
  if (path.length <= max) return path;
  const head = path.slice(0, Math.ceil((max - 1) / 2));
  const tail = path.slice(-Math.floor((max - 1) / 2));
  return `${head}…${tail}`;
}
