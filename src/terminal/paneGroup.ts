/**
 * Geometry for a stack of terminal panes.
 *
 * Every tab's terminal is absolutely positioned in one wrapper at identical size, so
 * dimensions are measured **once** against the wrapper and applied to all of them. That
 * is only correct because this app has no splits — every tab fills the same pane.
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
 * Deduping against a single shared "last applied" value is wrong, and was a real bug: a
 * newly opened tab starts at xterm's 80x24 default while its PTY was spawned at the
 * pane's true size. Because the *pane* geometry had not changed, a shared check skipped
 * the resize entirely, so the terminal rendered at 80 columns while the shell wrote at
 * 150. A fresh prompt hides that; a resumed session wraps into garbage until the window
 * is nudged. Tracking dimensions per pane is what makes a new tab correct on arrival.
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

/** Styles for a pane, active or not. Kept here so the display/visibility rule lives in
 *  exactly one place. */
export function paneStyle(active: boolean): Partial<CSSStyleDeclaration> {
  return {
    position: 'absolute',
    inset: '0',
    // NOT `display: none` — see the module comment.
    visibility: active ? 'visible' : 'hidden',
    zIndex: active ? '1' : '0',
  };
}
