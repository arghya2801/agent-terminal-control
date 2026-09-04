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
