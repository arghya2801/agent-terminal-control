/**
 * Drag to reorder, shared by tabs (#74) and tasks (#104). Pointer events rather than HTML5
 * drag and drop: Tauri's window-level file drop handling swallows HTML5 drags in WebView2,
 * and turning it off would let a dropped file navigate the window. Items only drop onto
 * items of the same group, so a tab cannot land in the task list.
 */

/** `list` with the item at `from` moved to where `to` is. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export interface ReorderOptions {
  id: string;
  group: string;
  onMove: (fromId: string, toId: string) => void;
}

/** Pixels the pointer must travel before a press becomes a drag, so clicks stay clicks. */
const THRESHOLD = 5;

/** Svelte action: `use:reorderable={{ id, group, onMove }}`. */
export function reorderable(node: HTMLElement, options: ReorderOptions) {
  let opts = options;
  node.dataset.reorderGroup = opts.group;
  node.dataset.reorderId = opts.id;

  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let dragging = false;
    let target: HTMLElement | null = null;

    const move = (m: PointerEvent) => {
      if (!dragging && Math.hypot(m.clientX - x0, m.clientY - y0) < THRESHOLD) return;
      dragging = true;
      node.classList.add('dragging');
      const hit = document
        .elementFromPoint(m.clientX, m.clientY)
        ?.closest<HTMLElement>(`[data-reorder-group="${opts.group}"]`);
      const next = hit && hit !== node ? hit : null;
      if (next !== target) {
        target?.classList.remove('drop-target');
        next?.classList.add('drop-target');
        target = next;
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      node.classList.remove('dragging');
      target?.classList.remove('drop-target');
      if (!dragging) return;
      // The release may also fire a click; a drag is not a click. Only this release's
      // click: the listener goes on the next tick whether or not one came.
      const eat = (c: MouseEvent) => c.stopPropagation();
      window.addEventListener('click', eat, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', eat, { capture: true }));
      if (target?.dataset.reorderId) opts.onMove(opts.id, target.dataset.reorderId);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  node.addEventListener('pointerdown', down);
  return {
    update(next: ReorderOptions) {
      opts = next;
      node.dataset.reorderGroup = opts.group;
      node.dataset.reorderId = opts.id;
    },
    destroy() {
      node.removeEventListener('pointerdown', down);
    },
  };
}
