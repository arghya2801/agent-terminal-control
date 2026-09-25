/**
 * Drag to reorder, shared by tabs (#74) and tasks (#104). Native HTML5 drag and drop: the
 * item carries its id under a group-specific type, so a tab cannot land in the task list
 * or a task in another status group.
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
  /** Items only drop onto items of the same group. */
  group: string;
  onMove: (fromId: string, toId: string) => void;
}

/** Svelte action: `use:reorderable={{ id, group, onMove }}`. */
export function reorderable(node: HTMLElement, options: ReorderOptions) {
  let opts = options;
  const type = () => `application/x-atc-${opts.group}`;
  node.draggable = true;

  const start = (e: DragEvent) => {
    e.dataTransfer?.setData(type(), opts.id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  };
  const over = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes(type())) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    node.classList.add('drop-target');
  };
  const leave = () => node.classList.remove('drop-target');
  const drop = (e: DragEvent) => {
    leave();
    const from = e.dataTransfer?.getData(type());
    if (!from) return;
    e.preventDefault();
    if (from !== opts.id) opts.onMove(from, opts.id);
  };

  node.addEventListener('dragstart', start);
  node.addEventListener('dragover', over);
  node.addEventListener('dragleave', leave);
  node.addEventListener('drop', drop);
  return {
    update(next: ReorderOptions) {
      opts = next;
    },
    destroy() {
      node.removeEventListener('dragstart', start);
      node.removeEventListener('dragover', over);
      node.removeEventListener('dragleave', leave);
      node.removeEventListener('drop', drop);
    },
  };
}
