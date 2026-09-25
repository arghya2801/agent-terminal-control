<script lang="ts">
  import TaskNode from './TaskNode.svelte';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import ConfirmDialog from '../lib/ConfirmDialog.svelte';
  import {
    TASK_STATES,
    candidates,
    filterTasks,
    findSession,
    linkSession,
    updateTask,
  } from '../lib/tasks';
  import { appState, saveTasks, taskUi, tasks } from '../lib/stores.svelte';
  import { projectKey } from '../lib/paths';
  import type { Project, SessionMeta, Task, TaskState } from '../types';
  import type { SessionMark } from './SessionNode.svelte';

  let {
    query,
    sessionMarks,
    onOpenSession,
  }: {
    query: string;
    sessionMarks: Map<string, SessionMark>;
    onOpenSession: (p: Project, s: SessionMeta) => void;
  } = $props();

  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  let deleting = $state<Task | null>(null);

  const all = $derived(tasks());
  const shown = $derived(filterTasks(all, query));
  const groups = $derived(
    TASK_STATES.map((g) => ({ ...g, tasks: shown.filter((t) => t.state === g.state) })).filter(
      (g) => g.tasks.length > 0,
    ),
  );
  const manyRepos = $derived(new Set(all.map((t) => (t.repo ? projectKey(t.repo) : ''))).size > 1);

  const live = (t: Task) => t.sessions.filter((k) => sessionMarks.has(k)).length;

  function edit(id: number, change: (t: Task) => Task) {
    saveTasks(updateTask(tasks(), id, change));
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      appState.error = `could not copy: ${e}`;
    }
  }

  function taskMenu(e: MouseEvent, t: Task) {
    e.preventDefault();
    taskUi.selected = t.id;
    const projects = appState.index.projects;
    const items: MenuItem[] = [];
    if (t.sessions.length === 0) items.push({ label: 'No sessions linked yet' });
    else items.push({ label: 'Resume' });
    for (const key of t.sessions.slice(0, 6)) {
      const hit = findSession(projects, key);
      items.push(
        hit
          ? {
              label: `${sessionMarks.has(key) ? 'Show ' : ''}${hit.session.label}`,
              disabled: !(hit.session.cwd ?? hit.project.path),
              run: () => onOpenSession(hit.project, hit.session),
            }
          : { label: `${key.slice(key.indexOf(':') + 1, key.indexOf(':') + 9)} (transcript gone)`, disabled: true, run: () => {} },
      );
    }
    const found = candidates(t, tasks(), projects);
    if (found.length) {
      items.push({
        label: `Link ${found.length} session${found.length === 1 ? '' : 's'} on its branches`,
        run: () => saveTasks(found.reduce((acc, s) => linkSession(acc, t.id, s), tasks())),
      });
    }
    items.push({ label: 'Status', sep: true });
    for (const { state, label } of TASK_STATES) {
      items.push({ label, checked: t.state === state, run: () => edit(t.id, (x) => ({ ...x, state })) });
    }
    items.push(
      { label: 'Rename', sep: true, run: () => (taskUi.renaming = t.id) },
      {
        label: 'Branches and notes…',
        run: () => {
          taskUi.selected = t.id;
          taskUi.panelOpen = true;
        },
      },
    );
    if (t.branches.length) {
      items.push({
        label: t.branches.length === 1 ? 'Copy branch name' : 'Copy branch names',
        run: () => void copy(t.branches.join('\n')),
      });
    }
    items.push({ label: 'Delete task', sep: true, danger: true, run: () => (deleting = t) });
    menu = { x: e.clientX, y: e.clientY, items };
  }

  function rename(t: Task, name: string) {
    taskUi.renaming = null;
    if (name.trim()) edit(t.id, (x) => ({ ...x, title: name.trim() }));
  }

  function confirmDelete() {
    const t = deleting;
    deleting = null;
    if (!t) return;
    saveTasks(tasks().filter((x) => x.id !== t.id));
    if (taskUi.selected === t.id) taskUi.selected = null;
  }

  function select(t: Task) {
    taskUi.selected = t.id;
  }

  function groupLabel(state: TaskState): string {
    return TASK_STATES.find((s) => s.state === state)?.label ?? state;
  }
</script>

{#if all.length === 0}
  <div class="hint">
    No tasks yet. Press <strong>+</strong> above, or right-click a session and make it a task.
  </div>
{:else if shown.length === 0}
  <div class="hint">No tasks match “{query.trim()}”.</div>
{:else}
  {#each groups as group (group.state)}
    <div class="group"><span>{groupLabel(group.state)}</span><span>{group.tasks.length}</span></div>
    {#each group.tasks as task (task.id)}
      <TaskNode
        {task}
        live={live(task)}
        selected={taskUi.selected === task.id}
        renaming={taskUi.renaming === task.id}
        showRepo={manyRepos}
        onSelect={select}
        onOpen={(t) => {
          taskUi.selected = t.id;
          taskUi.panelOpen = true;
        }}
        onMenu={taskMenu}
        onRename={(name) => rename(task, name)}
        onRenameCancel={() => (taskUi.renaming = null)}
      />
    {/each}
  {/each}
{/if}

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = null)} />
{/if}

{#if deleting}
  <ConfirmDialog confirmLabel="Delete task" onConfirm={confirmDelete} onCancel={() => (deleting = null)}>
    Delete <strong>{deleting.title}</strong>? Its notes go with it; linked sessions are not touched.
  </ConfirmDialog>
{/if}

<style>
  .group {
    display: flex;
    justify-content: space-between;
    padding: 9px 10px 3px 12px;
    color: var(--fg-faint);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .hint {
    padding: 10px 12px;
    color: var(--fg-faint);
    font-size: 11px;
    line-height: 1.5;
  }
</style>
