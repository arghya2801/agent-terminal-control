/**
 * Keyboard navigation for the sidebar lists (#103). The list is one tab stop: rows carry
 * `data-row` and `tabindex="-1"`, the list itself is focusable and hands focus on to a
 * row. Up/Down/Home/End move, Right/Left expand or collapse a project (a row with
 * `aria-expanded`) or go up to it from a session, Shift+F10 or the Menu key opens the
 * row's context menu, Esc leaves. Enter is the button's own click.
 */

export function moveIndex(key: string, i: number, n: number): number | null {
  if (n === 0) return null;
  if (key === 'ArrowDown') return Math.min(n - 1, i + 1);
  if (key === 'ArrowUp') return Math.max(0, i - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return null;
}

export function rows(list: HTMLElement): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>('[data-row]')].filter((r) => !(r as HTMLButtonElement).disabled);
}

/** The list took focus from outside: pass it to the last row used, or the first. */
export function enterList(e: FocusEvent, list: HTMLElement, last: HTMLElement | null) {
  if (e.target !== list || list.contains(e.relatedTarget as Node | null)) return;
  (last && list.contains(last) ? last : rows(list)[0])?.focus();
}

export function listKeys(e: KeyboardEvent, list: HTMLElement, leave: { up: () => void; escape: () => void }) {
  // Keys typed into an inline rename belong to the input.
  if ((e.target as HTMLElement).closest?.('input, textarea')) return;
  const all = rows(list);
  const current = (e.target as HTMLElement).closest?.<HTMLElement>('[data-row]') ?? null;
  const i = current ? all.indexOf(current) : -1;
  if (e.key === 'ArrowUp' && i === 0) {
    e.preventDefault();
    leave.up();
    return;
  }
  const next = moveIndex(e.key, i, all.length);
  if (next !== null) {
    e.preventDefault();
    all[next].focus();
    all[next].scrollIntoView?.({ block: 'nearest' });
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    leave.escape();
    return;
  }
  if (!current) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    const expanded = current.getAttribute('aria-expanded');
    if (expanded !== null) {
      if ((expanded === 'true') !== (e.key === 'ArrowRight')) current.click();
    } else if (e.key === 'ArrowLeft') {
      current.closest('[data-group]')?.querySelector<HTMLElement>('[data-row]')?.focus();
    }
  } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
    e.preventDefault();
    const r = current.getBoundingClientRect();
    current.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 16, clientY: r.bottom }),
    );
  }
}
