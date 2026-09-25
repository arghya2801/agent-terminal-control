<script lang="ts">
  import InlineRename from '../lib/InlineRename.svelte';
  import { reorderable } from '../lib/dragReorder';
  import type { Task } from '../types';

  let {
    task,
    live,
    selected = false,
    renaming = false,
    showRepo = false,
    onSelect,
    onOpen,
    onMenu,
    onRename,
    onRenameCancel,
    onMove,
  }: {
    task: Task;
    /** Linked sessions that have a tab open. */
    live: number;
    selected?: boolean;
    renaming?: boolean;
    /** Name the repo, for when tasks from several repos share the list. */
    showRepo?: boolean;
    onSelect: (task: Task) => void;
    /** Double-click: show it in the task panel. */
    onOpen: (task: Task) => void;
    onMenu: (e: MouseEvent, task: Task) => void;
    onRename: (name: string) => void;
    onRenameCancel: () => void;
    /** Put task `from` where task `to` is; within one status group (#104). */
    onMove: (from: number, to: number) => void;
  } = $props();

  function onKey(e: KeyboardEvent) {
    // Alt+Up/Down moves the task one place within its group.
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    e.stopPropagation();
    const rows = [...(e.currentTarget as HTMLElement).parentElement!.querySelectorAll<HTMLElement>(`[data-state="${task.state}"]`)];
    const i = rows.indexOf(e.currentTarget as HTMLElement);
    const other = rows[i + (e.key === 'ArrowUp' ? -1 : 1)];
    if (other) onMove(task.id, Number(other.dataset.id));
  }

  const repoName = $derived(task.repo?.split(/[\\/]/).filter(Boolean).pop() ?? null);
</script>

{#if renaming}
  <div class="task {task.state}">
    <InlineRename value={task.title} onDone={onRename} onCancel={onRenameCancel} />
  </div>
{:else}
  <button
    class="task {task.state}"
    data-row
    data-id={task.id}
    data-state={task.state}
    tabindex="-1"
    use:reorderable={{ id: String(task.id), group: `task-${task.state}`, onMove: (a, b) => onMove(Number(a), Number(b)) }}
    onkeydown={onKey}
    class:selected
    onclick={() => onSelect(task)}
    ondblclick={() => onOpen(task)}
    oncontextmenu={(e) => onMenu(e, task)}
    title="{task.title} (double-click for branches and notes)"
  >
    <span class="title">{task.title}</span>
    {#if (showRepo && repoName) || task.branches.length || task.sessions.length}
    <span class="meta">
      {#if showRepo && repoName}<span class="repo">{repoName}</span>{/if}
      {#if task.branches.length}
        <span class="branch">{task.branches[0]}</span>
        {#if task.branches.length > 1}<span>+{task.branches.length - 1}</span>{/if}
      {/if}
      {#if live}
        <span class="live">{live} open</span>
      {:else if task.sessions.length}
        <span>{task.sessions.length} session{task.sessions.length === 1 ? '' : 's'}</span>
      {/if}
    </span>
    {/if}
  </button>
{/if}

<style>
  .task {
    display: block;
    box-sizing: border-box;
    width: 100%;
    padding: 5px 10px 6px 12px;
    border: none;
    border-left: 2px solid transparent;
    background: transparent;
    color: var(--fg);
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .task:hover {
    background: var(--bg-hover);
  }
  .task.doing {
    border-left-color: var(--warn);
  }
  .task.done {
    border-left-color: var(--ok);
  }
  .task.selected {
    background: color-mix(in srgb, var(--accent-strong) 16%, transparent);
    border-left-color: var(--accent);
  }
  .task:global(.drop-target) {
    box-shadow: inset 0 2px 0 var(--accent);
  }
  .title {
    display: block;
    overflow: hidden;
    color: var(--fg-bright);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .done .title {
    color: var(--fg-dim);
    text-decoration: line-through;
  }
  .meta {
    display: flex;
    gap: 6px;
    overflow: hidden;
    color: var(--fg-faint);
    font-size: 10px;
    white-space: nowrap;
  }
  .branch {
    overflow: hidden;
    color: var(--info);
    font-family: ui-monospace, monospace;
    text-overflow: ellipsis;
  }
  .repo {
    flex-shrink: 0;
  }
  .live {
    color: var(--ok);
  }
</style>
