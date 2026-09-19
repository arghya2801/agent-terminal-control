/**
 * Pinned-project list manipulation.
 *
 * This writes straight into the user's `settings.json`, so a mistake here loses pins
 * they set by hand. Everything returns a new array rather than mutating, and paths are
 * compared case-insensitively with separators normalised — the same directory can be
 * spelled differently by the sidebar and by a hand-edited file.
 */

import { samePath } from './paths';

export interface PinnedProject {
  path: string;
  displayName: string | null;
  order: number;
}

export function isPinned(list: PinnedProject[], path: string): boolean {
  return list.some((p) => samePath(p.path, path));
}

/**
 * Pin `path` if it is not pinned, otherwise unpin it.
 *
 * `order` is renumbered contiguously from 0 so the list cannot accumulate gaps or
 * duplicate positions after repeated pinning and unpinning.
 */
export function togglePinned(
  list: PinnedProject[],
  path: string,
  displayName?: string | null,
): PinnedProject[] {
  const without = list.filter((p) => !samePath(p.path, path));
  const wasPinned = without.length !== list.length;

  const next = wasPinned
    ? without
    : [...without, { path, displayName: displayName ?? null, order: 0 }];

  return next.map((p, i) => ({ ...p, order: i }));
}
