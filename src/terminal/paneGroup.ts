/**
 * Geometry for a stack of terminal panes.
 *
 * Every tab's terminal is absolutely positioned in one wrapper. Unsplit, every tab fills
 * it at identical size, so dimensions are measured **once** and applied to all of them.
 * Split (#21), the wrapper holds two panes side by side, each showing one tab and each
 * measured on its own.
 *
 * Inactive panes use `visibility: hidden`, never `display: none`. A `display: none`
 * element measures zero, and FitAddon would then push garbage dimensions into ConPTY.
 */

import type { Dims } from '../types';

/** True when the terminal actually needs resizing. Every ConPTY resize triggers a full
 *  repaint in the child, so a no-op resize is not free. */
export function dimsChanged(prev: Dims | null, next: Dims): boolean {
  if (!prev) return true;
  return prev.cols !== next.cols || prev.rows !== next.rows;
}

/**
 * Which panes still need resizing to reach `target`.
 *
 * Tracked per pane, not against one shared "last applied" value: a new tab starts at
 * xterm's 80x24 default while its PTY was spawned at the pane's real size, and a shared
 * check skips it because the pane geometry never changed.
 */
export function panesNeedingResize<T extends { dims: Dims | null }>(
  panes: T[],
  target: Dims,
): T[] {
  return panes.filter((p) => dimsChanged(p.dims, target));
}

/** Reject nonsense measurements rather than forwarding them to ConPTY. A hidden or
 *  not-yet-laid-out container yields zero or NaN. */
export function isUsableDims(d: Dims | null | undefined): d is Dims {
  return (
    !!d &&
    Number.isFinite(d.cols) &&
    Number.isFinite(d.rows) &&
    d.cols > 0 &&
    d.rows > 0
  );
}

/**
 * Trailing-edge debounce. A window drag fires ResizeObserver ~60x/sec; without this
 * that becomes 60 ConPTY resizes and 60 IPC calls per second.
 */
export function debounce<T extends unknown[]>(
  fn: (...args: T) => void,
  ms: number,
): ((...args: T) => void) & { cancel(): void } {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: T) => {
    if (handle !== undefined) clearTimeout(handle);
    handle = setTimeout(() => {
      handle = undefined;
      fn(...args);
    }, ms);
  };
  wrapped.cancel = () => {
    if (handle !== undefined) clearTimeout(handle);
    handle = undefined;
  };
  return wrapped;
}

/** The tab shown in the left and right pane; the right is null when not split. */
export type Panes<K> = [K | null, K | null];

/** Where a tab sits: which pane, or null when hidden. */
export function slotOf<K>(panes: Panes<K>, key: K): 0 | 1 | null {
  return panes[0] === key ? 0 : panes[1] === key ? 1 : null;
}

/** Show `key` in the focused pane, or just focus the other pane if it is already there. */
export function showIn<K>(panes: Panes<K>, focused: 0 | 1, key: K): { panes: Panes<K>; focused: 0 | 1 } {
  const slot = slotOf(panes, key);
  if (slot !== null) return { panes, focused: slot };
  const next: Panes<K> = [...panes];
  next[focused] = key;
  return { panes: next, focused };
}

/** After `key` closed: refill its pane from `others` (tabs not on screen), or unsplit. */
export function withoutTab<K>(panes: Panes<K>, focused: 0 | 1, key: K, others: K[]): { panes: Panes<K>; focused: 0 | 1 } {
  const slot = slotOf(panes, key);
  if (slot === null) return { panes, focused };
  const spare = others.find((k) => k !== key && slotOf(panes, k) === null) ?? null;
  if (spare !== null) {
    const next: Panes<K> = [...panes];
    next[slot] = spare;
    return { panes: next, focused };
  }
  const left = slot === 0 ? panes[1] : panes[0];
  return { panes: [left, null], focused: 0 };
}

/** Styles for a tab's container: which pane it fills, or hidden. Kept here so the
 *  display/visibility rule lives in exactly one place. */
export function paneStyle(slot: 0 | 1 | null, split = false, focused = false): Partial<CSSStyleDeclaration> {
  const half = split && slot !== null;
  return {
    position: 'absolute',
    inset: !half ? '0' : slot === 0 ? '0 50% 0 0' : '0 0 0 50%',
    borderLeft: half && slot === 1 ? '1px solid var(--border)' : '',
    // The focused pane of a split is marked, so it is clear where typing goes. A border,
    // not a shadow: the terminal's canvas paints over an inset shadow. Both halves carry
    // one, so they measure the same.
    borderTop: half ? `2px solid ${focused ? 'var(--accent)' : 'transparent'}` : '',
    boxSizing: 'border-box',
    // NOT `display: none` — see the module comment.
    visibility: slot !== null ? 'visible' : 'hidden',
    zIndex: slot !== null ? '1' : '0',
  };
}
