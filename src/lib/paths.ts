/**
 * Path normalisation, mirroring the canonical key rule in `src-tauri/src/paths.rs`.
 *
 * A project is identified by this key everywhere: the sidebar, the project a tab belongs
 * to, the pinned list. Two spellings of the same directory must produce one key, or the
 * same project shows up twice.
 */

/** Canonical comparison key for a directory: lowercase, backslashes, no trailing one. */
export function projectKey(path: string): string {
  const s = path.replace(/\//g, '\\');
  const trimmed = s.replace(/\\+$/, '');
  // A path that is nothing but separators has no stem to keep, so it keeps them.
  return (trimmed === '' ? s : trimmed).toLowerCase();
}

export function samePath(a: string, b: string): boolean {
  return projectKey(a) === projectKey(b);
}
