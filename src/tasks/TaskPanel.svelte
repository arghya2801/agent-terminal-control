<script lang="ts">
  import { tick } from 'svelte';
  import { sessionKey } from '../lib/agents';
  import { renderMarkdown } from '../lib/markdown';
  import { TASK_STATES, candidates, findSession, linkSession, unlinkSession, updateTask } from '../lib/tasks';
  import { appState, branchesOf, saveTasks, taskUi, tasks } from '../lib/stores.svelte';
  import { openUrl } from '../lib/ipc';
  import type { Project, SessionMeta, Task } from '../types';
  import type { SessionMark } from '../sidebar/SessionNode.svelte';

  let {
    sessionMarks,
    onOpenSession,
  }: {
    sessionMarks: Map<string, SessionMark>;
    onOpenSession: (p: Project, s: SessionMeta) => void;
  } = $props();

  const task = $derived(tasks().find((t) => t.id === taskUi.selected) ?? null);
  const projects = $derived(appState.index.projects);
  const repos = $derived(projects.filter((p) => p.path).map((p) => ({ path: p.path!, name: p.name })));

  // A primitive, so editing the task's other fields does not refetch the branch list.
  const repo = $derived(task?.repo ?? null);
  let branches = $state<string[]>([]);
  $effect(() => {
    const current = repo;
    branches = [];
    if (current) void branchesOf(current).then((b) => repo === current && (branches = b));
  });
  /** Branches on the task that the repo no longer has: kept, greyed, still removable. */
  const gone = $derived(task ? task.branches.filter((b) => !branches.includes(b)) : []);

  /** Dismissed suggestions, by task. Deliberately not persisted. */
  let dismissed = $state<Record<number, string[]>>({});
  const suggested = $derived(
    task ? candidates(task, tasks(), projects).filter((s) => !dismissed[task.id]?.includes(sessionKey(s))) : [],
  );
  const linked = $derived(task ? task.sessions.map((key) => ({ key, hit: findSession(projects, key) })) : []);

  let editingNotes = $state(false);
  let notesEl = $state<HTMLTextAreaElement>();

  function edit(change: (t: Task) => Task, debounced = false) {
    if (task) saveTasks(updateTask(tasks(), task.id, change), debounced);
  }

  function toggleBranch(b: string, on: boolean) {
    edit((t) => ({ ...t, branches: on ? [...t.branches, b] : t.branches.filter((x) => x !== b) }));
  }

  function linkAll() {
    if (task) saveTasks(suggested.reduce((acc, s) => linkSession(acc, task.id, s), tasks()));
  }

  async function startNotes(e: Event) {
    const link = (e.target as HTMLElement).closest('a');
    if (link) {
      // The webview would try to open it in-app; hand it to the default browser.
      e.preventDefault();
      void openUrl(link.href).catch((err) => (appState.error = String(err)));
      return;
    }
    editingNotes = true;
    await tick();
    notesEl?.focus();
  }
</script>

<aside class="panel" aria-label="Task details">
  <header>
    <span>Task{task ? ` ${task.id}` : ''}</span>
    <button class="icon" onclick={() => (taskUi.panelOpen = false)} title="Hide panel (Ctrl+Shift+E)" aria-label="Hide panel">×</button>
  </header>

  {#if !task}
    <p class="muted">Pick a task in the sidebar, or press + in its Tasks view to write one.</p>
  {:else}
    {#key task.id}
      <input
        class="title"
        value={task.title}
        aria-label="Task title"
        spellcheck="false"
        onchange={(e) => {
          const title = e.currentTarget.value.trim();
          if (title) edit((t) => ({ ...t, title }));
        }}
        onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    {/key}

    <div class="row">
      <span class="label">Status</span>
      <div class="seg">
        {#each TASK_STATES as s (s.state)}
          <button aria-pressed={task.state === s.state} onclick={() => edit((t) => ({ ...t, state: s.state }))}>{s.label}</button>
        {/each}
      </div>
    </div>

    <div class="row">
      <label class="label" for="task-repo">Repo</label>
      <select
        id="task-repo"
        class="field"
        value={task.repo ?? ''}
        onchange={(e) => {
          const repo = e.currentTarget.value || null;
          edit((t) => ({ ...t, repo, branches: repo === t.repo ? t.branches : [] }));
        }}
      >
        <option value="">No repo</option>
        {#if task.repo && !repos.some((r) => r.path === task.repo)}
          <option value={task.repo}>{task.repo}</option>
        {/if}
        {#each repos as r (r.path)}<option value={r.path}>{r.name}</option>{/each}
      </select>
    </div>

    {#if task.repo}
      <div class="row">
        <span class="label">Branches</span>
        <details class="picker" open={task.branches.length === 0}>
          <summary>
            {#if task.branches.length}<span class="chips">{task.branches.join(', ')}</span>
            {:else}<span class="none">Pick one or more</span>{/if}
            <span class="caret">▾</span>
          </summary>
          <div class="pop">
            {#if branches.length === 0 && gone.length === 0}<div class="muted">No branches found. Is this a git repo?</div>{/if}
            {#each branches as b (b)}
              <label><input type="checkbox" checked={task.branches.includes(b)} onchange={(e) => toggleBranch(b, e.currentTarget.checked)} />{b}</label>
            {/each}
            {#each gone as b (b)}
              <label class="gone" title="No longer in the repo"><input type="checkbox" checked onchange={() => toggleBranch(b, false)} />{b}</label>
            {/each}
          </div>
        </details>
      </div>
    {/if}

    {#if suggested.length}
      <div class="suggest">
        <p>{suggested.length} session{suggested.length === 1 ? '' : 's'} ran on <span class="mono">{task.branches.join(', ')}</span>:</p>
        {#each suggested as s (sessionKey(s))}<div class="sess"><span>{s.label}</span></div>{/each}
        <div class="acts">
          <button class="btn primary" onclick={linkAll}>Link {suggested.length === 1 ? 'it' : 'them'}</button>
          <button class="btn" onclick={() => (dismissed[task.id] = [...(dismissed[task.id] ?? []), ...suggested.map(sessionKey)])}>Not these</button>
        </div>
      </div>
    {/if}

    <h3>Sessions</h3>
    {#each linked as { key, hit } (key)}
      <div class="sess" class:gone={!hit}>
        <span title={key}>{hit ? hit.session.label : `${key} (transcript gone)`}</span>
        {#if hit}
          <button class="btn" disabled={!(hit.session.cwd ?? hit.project.path)} onclick={() => onOpenSession(hit.project, hit.session)}>
            {sessionMarks.has(key) ? 'Show' : 'Resume'}
          </button>
        {/if}
        <button class="icon" title="Unlink" aria-label="Unlink" onclick={() => saveTasks(unlinkSession(tasks(), task.id, key))}>×</button>
      </div>
    {:else}
      <p class="muted">None yet. {task.repo ? 'Tick a branch above to find sessions that ran on it, or' : ''} right-click a session to link it.</p>
    {/each}

    <h3>Notes</h3>
    {#if editingNotes}
      <textarea
        bind:this={notesEl}
        class="notes"
        spellcheck="false"
        placeholder="Markdown works here."
        value={task.notes}
        oninput={(e) => edit((t) => ({ ...t, notes: e.currentTarget.value }), true)}
        onblur={() => (editingNotes = false)}
        onkeydown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
      ></textarea>
    {:else}
      <div
        class="md"
        role="button"
        tabindex="0"
        title="Click to edit"
        onclick={startNotes}
        onkeydown={(e) => e.key === 'Enter' && void startNotes(e)}
      >
        {#if task.notes.trim()}
          <!-- Safe: renderMarkdown escapes the source before adding its own tags. -->
          {@html renderMarkdown(task.notes)}
        {:else}
          <p class="muted">No notes. Click to write some; Markdown works.</p>
        {/if}
      </div>
    {/if}
  {/if}
</aside>

<style>
  .panel {
    box-sizing: border-box;
    height: 100%;
    overflow-y: auto;
    padding: 0 14px 24px;
    border-left: 1px solid var(--border);
    background: var(--bg-chrome);
    color: var(--fg);
    font-size: 12px;
    scrollbar-width: thin;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 0 8px;
    color: var(--fg-faint);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .icon {
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--fg-faint);
    font-size: 14px;
    cursor: pointer;
  }
  .icon:hover {
    background: var(--bg-surface);
    color: var(--fg);
  }
  .title {
    box-sizing: border-box;
    width: 100%;
    margin-bottom: 12px;
    padding: 3px 4px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: var(--fg-bright);
    font: inherit;
    font-size: 15px;
    font-weight: 600;
  }
  .title:hover {
    border-color: var(--border);
  }
  .title:focus {
    border-color: var(--accent);
    outline: none;
  }
  .row {
    margin-bottom: 12px;
  }
  .label {
    display: block;
    margin-bottom: 4px;
    color: var(--fg-dim);
    font-size: 11px;
  }
  .field,
  summary {
    box-sizing: border-box;
    width: 100%;
    padding: 4px 7px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
  }
  .seg {
    display: flex;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .seg button {
    flex: 1;
    padding: 4px 6px;
    border: none;
    border-right: 1px solid var(--border);
    background: var(--bg);
    color: var(--fg-dim);
    font: inherit;
    cursor: pointer;
  }
  .seg button:last-child {
    border-right: none;
  }
  .seg button:hover {
    background: var(--bg-hover);
  }
  .seg button[aria-pressed='true'] {
    background: var(--bg-surface);
    color: var(--fg-bright);
  }
  .picker {
    position: relative;
  }
  summary {
    display: flex;
    align-items: center;
    gap: 6px;
    list-style: none;
    cursor: pointer;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .picker[open] summary {
    border-color: var(--accent);
  }
  .chips {
    flex: 1;
    overflow: hidden;
    color: var(--info);
    font-family: ui-monospace, monospace;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .none {
    flex: 1;
    color: var(--fg-faint);
  }
  .caret {
    color: var(--fg-faint);
    font-size: 10px;
  }
  .pop {
    max-height: 210px;
    margin-top: 3px;
    overflow-y: auto;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-surface);
  }
  .pop label {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 3px 6px;
    border-radius: 3px;
    font-family: ui-monospace, monospace;
    cursor: pointer;
  }
  .pop label:hover {
    background: var(--bg-hover);
  }
  .pop input {
    margin: 0;
    accent-color: var(--accent);
  }
  .gone {
    color: var(--fg-faint);
    text-decoration: line-through;
  }
  .suggest {
    margin: 4px 0 12px;
    padding: 9px 10px;
    border: 1px solid var(--info);
    border-radius: 5px;
    background: color-mix(in srgb, var(--info) 8%, transparent);
  }
  .suggest p {
    margin: 0 0 6px;
  }
  .mono {
    color: var(--info);
    font-family: ui-monospace, monospace;
  }
  .acts {
    display: flex;
    gap: 7px;
    margin-top: 9px;
  }
  .btn {
    padding: 3px 9px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-surface);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }
  .btn:hover:not(:disabled) {
    border-color: var(--fg-faint);
  }
  .btn.primary {
    border-color: var(--accent-strong);
    background: var(--accent-strong);
    color: #fff;
  }
  h3 {
    margin: 16px 0 4px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
    color: var(--fg-dim);
    font-size: 11px;
    font-weight: 600;
  }
  .sess {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 4px 0;
  }
  .sess span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .muted {
    color: var(--fg-faint);
  }
  .md,
  .notes {
    box-sizing: border-box;
    width: 100%;
    min-height: 190px;
    padding: 6px 8px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: var(--bg);
    line-height: 1.5;
  }
  .md {
    cursor: text;
  }
  .md:hover {
    border-color: var(--border);
  }
  .notes {
    border-color: var(--accent);
    color: var(--fg);
    font-family: ui-monospace, monospace;
    font-size: 12px;
    resize: vertical;
    outline: none;
  }
  .md :global(:first-child) {
    margin-top: 0;
  }
  .md :global(p),
  .md :global(ul),
  .md :global(ol),
  .md :global(pre),
  .md :global(blockquote) {
    margin: 0 0 8px;
  }
  .md :global(h1),
  .md :global(h2),
  .md :global(h3) {
    margin: 12px 0 4px;
    color: var(--fg-bright);
    font-size: 13px;
  }
  .md :global(ul),
  .md :global(ol) {
    padding-left: 19px;
  }
  .md :global(li.check) {
    list-style: none;
    margin-left: -19px;
  }
  .md :global(code) {
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--bg-surface);
    font-family: ui-monospace, monospace;
  }
  .md :global(pre) {
    overflow-x: auto;
    padding: 7px 9px;
    border-radius: 4px;
    background: var(--bg-surface);
  }
  .md :global(pre code) {
    padding: 0;
    background: none;
  }
  .md :global(a) {
    color: var(--accent);
  }
  .md :global(blockquote) {
    padding-left: 9px;
    border-left: 2px solid var(--border);
    color: var(--fg-dim);
  }
</style>
