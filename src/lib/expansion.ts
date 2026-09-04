/**
 * Which sidebar projects are expanded.
 *
 * Tracked as the set of *collapsed* keys rather than expanded ones, so the default is
 * open: a project that appears while the app is running (a session started in a new
 * directory) shows its sessions immediately instead of hiding them behind a twisty the
 * user has to find.
 */

export type Collapsed = Record<string, boolean>;

export function isExpandedIn(collapsed: Collapsed, key: string): boolean {
  return collapsed[key] !== true;
}

export function toggleIn(collapsed: Collapsed, key: string): void {
  if (collapsed[key]) {
    delete collapsed[key];
  } else {
    collapsed[key] = true;
  }
}

export function setCollapsedIn(collapsed: Collapsed, key: string, value: boolean): void {
  if (value) {
    collapsed[key] = true;
  } else {
    delete collapsed[key];
  }
}

/** True when at least one of `keys` is currently expanded. Drives whether the header
 *  button offers "collapse all" or "expand all". */
export function anyExpanded(collapsed: Collapsed, keys: string[]): boolean {
  return keys.some((k) => isExpandedIn(collapsed, k));
}

/** Collapse every listed key, or expand them all. */
export function setAll(collapsed: Collapsed, keys: string[], collapse: boolean): void {
  for (const k of keys) setCollapsedIn(collapsed, k, collapse);
}
