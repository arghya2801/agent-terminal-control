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

/** Match counter for the find bar: "3/17", or a word when there is nothing to count. */
export function formatMatches(index: number, count: number, query: string): string {
  if (!query) return '';
  if (count <= 0) return 'no results';
  // The addon reports -1 while a search is still settling, or past its highlight limit.
  if (index < 0) return `${count}`;
  return `${index + 1}/${count}`;
}

/**
 * A title set by the program in a tab, or null when it says nothing useful. ConPTY sets
 * the title to the shell's executable path at startup, which is noise.
 */
export function usableTitle(title: string): string | null {
  const t = title.trim();
  if (!t || /\.exe$/i.test(t)) return null;
  return t;
}

export type Activity = 'working' | 'idle';

/**
 * What Claude Code's terminal title says about the session. It prefixes the title with
 * `✳` when idle and alternates `◐`/`◑` while working; older builds spun braille dots.
 * Returns the state and the bare session name, or null for a title Claude did not set.
 */
export function claudeTitle(title: string): { activity: Activity; name: string } | null {
  const m = /^\s*([\u2733\u25D0\u25D1\u2800-\u28FF])\s+(.*)$/u.exec(title);
  if (!m) return null;
  return { activity: m[1] === '\u2733' ? 'idle' : 'working', name: m[2].trim() };
}
