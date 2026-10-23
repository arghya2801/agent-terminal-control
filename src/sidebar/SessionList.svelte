<script lang="ts">
  import { sessionKey } from '../lib/agents';
  import { agentCommand, openInExplorer, searchTranscripts, suggestSessionName } from '../lib/ipc';
  import ConfirmDialog from '../lib/ConfirmDialog.svelte';
  import SessionPreview from './SessionPreview.svelte';
  import { formatUsd, sessionStats } from '../lib/costs';
  import { loadCosts, planState } from '../lib/limits.svelte';
  import { relativeTime } from '../lib/format';
  import ProjectNode from './ProjectNode.svelte';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import Icon from '../lib/Icon.svelte';
  import { chordFor } from '../lib/keymap';
  import { filterProjects } from '../lib/filter';
  import { groupSubfolders } from '../lib/group';
  import { isPinned, togglePinned } from '../lib/pinned';
  import { appState, refresh, saveSettings } from '../lib/stores.svelte';
  import type { AgentProvider, Project, SessionMeta, TabKey } from '../types';
  import type { SessionMark } from '../lib/format';

  /** The sidebar's Sessions view: projects, their sessions, and both context menus. */
  let {
    query,
    scratch = false,
    activeKey,
    activeSessionId,
    openProjectKeys,
    sessionMarks,
    onOpenProject,
    onOpenSession,
    onNewShell,
    onNewAgent,
    onOpenFolder,
    onAsk,
  }: {
    query: string;
    /** For the first-run card; the Scratch view has its own empty text. */
    onOpenFolder?: () => void;
    onAsk?: (provider: AgentProvider) => void;
    /** The Scratch view: only the scratch and chats directories, as fixed sections (#135). */
    scratch?: boolean;
    activeKey: TabKey | null;
    activeSessionId: string | null;
    openProjectKeys: Set<string>;
    /** Sessions with a live tab, by id. */
    sessionMarks: Map<string, SessionMark>;
    onOpenProject: (p: Project) => void;
    onOpenSession: (p: Project, s: SessionMeta) => void;
    onNewShell: (p: Project) => void;
    onNewAgent: (p: Project, provider: AgentProvider) => void;
  } = $props();

  /** `p:<project key>` or `s:<session id>` while its name is being edited. */
  let renaming = $state<string | null>(null);
  /** A name the model suggested, which the rename box starts with (#195). */
  let renameValue = $state<string | undefined>();
  /** A failed suggestion or search, shown above the list until clicked. */
  let notice = $state<string | null>(null);
  let naming = $state<string | null>(null);

  async function suggestName(s: SessionMeta) {
    const key = sessionKey(s);
    naming = key;
    notice = null;
    try {
      renameValue = await suggestSessionName(s.file);
      renaming = `s:${key}`;
    } catch (e) {
      notice = `Could not suggest a name: ${e instanceof Error ? e.message : e}`;
    } finally {
      naming = null;
    }
  }

  // --- archive (#163): hidden from the list, kept on disk.
  const archived = $derived(new Set(appState.settings?.projects.archived ?? []));
  let showArchived = $state(false);
  async function setArchived(keys: string[], archive: boolean) {
    if (!appState.settings) return;
    const next = new Set(appState.settings.projects.archived ?? []);
    for (const k of keys) {
      if (archive) next.add(k);
      else next.delete(k);
    }
    await saveSettings({ ...appState.settings, projects: { ...appState.settings.projects, archived: [...next] } });
  }
  /** "Archive old sessions…": older than `days`, and with a cost cap, cheaper than it. */
  let bulk = $state<{ project: Project; days: number; maxCost: number | null } | null>(null);
  const bulkKeys = $derived.by(() => {
    if (!bulk) return [];
    const before = Date.now() - bulk.days * 86_400_000;
    const cap = bulk.maxCost;
    return bulk.project.sessions
      .filter((s) => s.mtimeMs < before && !archived.has(sessionKey(s)))
      .filter((s) => cap === null || (sessionStats(planState.costRows, sessionKey(s))?.cost ?? 0) <= cap)
      .map(sessionKey);
  });

  // --- preview (#160)
  let preview = $state<{ project: Project; session: SessionMeta; top: number; left: number } | null>(null);
  function showPreview(project: Project, session: SessionMeta, row: Element) {
    const r = row.getBoundingClientRect();
    preview = { project, session, top: r.top, left: r.right + 8 };
  }

  // --- transcript search (#159): runs beside the name filter once it has 3 characters.
  let hits = $state<{ session: string; role: string; snippet: string; time: string }[]>([]);
  let searchingText = $state(false);
  let searchSeq = 0;
  $effect(() => {
    const q = query.trim();
    const seq = ++searchSeq;
    if (scratch || q.length < 3) {
      hits = [];
      searchingText = false;
      return;
    }
    searchingText = true;
    const timer = setTimeout(() => {
      searchTranscripts(q).then(
        (h) => {
          if (seq !== searchSeq) return;
          hits = h;
          searchingText = false;
        },
        (e) => {
          if (seq !== searchSeq) return;
          notice = String(e);
          searchingText = false;
        },
      );
    }, 300);
    return () => clearTimeout(timer);
  });
  /** Each hit with its session from the index; hits the index does not list are dropped. */
  const found = $derived(
    hits.flatMap((h) => {
      for (const p of appState.index.projects) {
        const s = p.sessions.find((x) => sessionKey(x) === h.session);
        if (s) return [{ ...h, project: p, meta: s }];
      }
      return [];
    }),
  );

  /** Store `name` under `id` in one of the rename maps; empty removes the entry. */
  async function saveName(field: 'names' | 'sessionNames', id: string, name: string) {
    renaming = null;
    renameValue = undefined;
    if (!appState.settings) return;
    const map = { ...appState.settings.projects[field] };
    if (name) map[id] = name;
    else delete map[id];
    await saveSettings({
      ...appState.settings,
      projects: { ...appState.settings.projects, [field]: map },
    });
    await refresh();
  }

  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      appState.error = `could not copy: ${e}`;
    }
  }

  async function setPinned(path: string, name: string) {
    if (!appState.settings) return;
    const pinned = togglePinned(appState.settings.projects.pinned, path, name);
    await saveSettings({
      ...appState.settings,
      projects: { ...appState.settings.projects, pinned },
    });
  }

  function projectMenu(e: MouseEvent, p: Project) {
    e.preventDefault();
    const path = p.path;
    const pinnedNow = !!path && isPinned(appState.settings?.projects.pinned ?? [], path);
    menu = {
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Open in Claude', icon: 'agent', disabled: !path || !p.exists, run: () => onNewAgent(p, 'claude') },
        { label: 'Open in Codex', icon: 'agent', disabled: !path || !p.exists, run: () => onNewAgent(p, 'codex') },
        { label: 'Open terminal here', icon: 'terminal', disabled: !path || !p.exists, run: () => onNewShell(p) },
        { label: 'Rename…', icon: 'pencil', sep: true, disabled: !path, run: () => (renaming = `p:${p.key}`) },
        {
          label: pinnedNow ? 'Unpin project' : 'Pin project',
          icon: 'pin',
          disabled: !path,
          run: () => path && void setPinned(path, p.name),
        },
        {
          label: 'Open in Explorer',
          icon: 'folder',
          sep: true,
          disabled: !path || !p.exists,
          run: () => path && void openInExplorer(path),
        },
        { label: 'Copy path', icon: 'copy', disabled: !path, run: () => path && void copy(path) },
        {
          label: 'Archive old sessions…',
          icon: 'collapse',
          sep: true,
          disabled: p.sessions.length === 0,
          run: () => {
            bulk = { project: p, days: 30, maxCost: null };
            void loadCosts();
          },
        },
      ],
    };
  }

  function sessionMenu(e: MouseEvent, p: Project, s: SessionMeta) {
    e.preventDefault();
    const dir = s.cwd ?? p.path;
    const key = sessionKey(s);
    const row = (e.currentTarget as Element | null) ?? (e.target as Element);
    menu = {
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Preview', icon: 'search', run: () => showPreview(p, s, row) },
        { label: 'Rename…', icon: 'pencil', sep: true, run: () => (renaming = `s:${key}`) },
        {
          label: naming === key ? 'Naming…' : `Rename with ${appState.settings?.ui.renameModel === 'luna' ? 'Luna' : 'Haiku'}`,
          icon: 'agent',
          disabled: naming !== null,
          run: () => void suggestName(s),
        },
        archived.has(key)
          ? { label: 'Unarchive', icon: 'expand', run: () => void setArchived([key], false) }
          : { label: 'Archive', icon: 'collapse', run: () => void setArchived([key], true) },
        { label: 'Copy session id', icon: 'copy', sep: true, run: () => void copy(s.id) },
        {
          label: 'Copy resume command',
          icon: 'copy',
          run: () => void agentCommand(s.provider, s.id).then(copy).catch(e => appState.error = String(e)),
        },
        {
          label: 'Open in Explorer',
          icon: 'folder',
          disabled: !dir,
          run: () => dir && void openInExplorer(dir),
        },
      ],
    };
  }

  const searching = $derived(query.trim() !== '');
  // Grouped before filtering, so a query matching a parent's name keeps the sessions it
  // has adopted.
  const all = $derived(appState.index.projects.filter((p) => !!p.kind === scratch));
  const archivedCount = $derived(all.reduce((n, p) => n + p.sessions.filter((s) => archived.has(sessionKey(s))).length, 0));
  const mine = $derived(
    showArchived ? all : all.map((p) => ({ ...p, sessions: p.sessions.filter((s) => !archived.has(sessionKey(s))) })),
  );
  const grouped = $derived(
    !scratch && appState.settings?.ui.groupSubfolders ? groupSubfolders(mine) : mine,
  );
  const shown = $derived(filterProjects(grouped, query));
  const SECTIONS = [
    { kind: 'chats', empty: 'No chats yet. Press + to start one.' },
    { kind: 'scratch', empty: 'Nothing here yet. Ctrl+Shift+A asks an agent in the scratch directory.' },
  ] as const;
  // While searching every match is shown: a hit hidden behind "show more" is no hit.
  const limit = $derived(searching ? Infinity : (appState.settings?.ui.sessionsPerProject ?? 15));
</script>

{#snippet node(project: Project, forceOpen: boolean)}
  <ProjectNode
    {project}
    {query}
    {limit}
    {forceOpen}
    groupByBranch={appState.settings?.ui.groupByBranch ?? false}
    {sessionMarks}
    {activeKey}
    {activeSessionId}
    open={openProjectKeys.has(project.key)}
    {renaming}
    {renameValue}
    {archived}
    onPreview={(p, s, row) => showPreview(p, s, row)}
    onRenameProject={(p, name) => p.path && void saveName('names', p.path, name)}
    onRenameSession={(s, name) => void saveName('sessionNames', sessionKey(s), name)}
    onRenameCancel={() => {
      renaming = null;
      renameValue = undefined;
    }}
    {onOpenProject}
    {onOpenSession}
    onProjectMenu={projectMenu}
    onSessionMenu={sessionMenu}
  />
{/snippet}

{#if notice}
  <button class="hint err notice" onclick={() => (notice = null)} title="Dismiss">{notice}</button>
{/if}
{#if appState.loading}
  <!-- Shaped like the rows that replace it: a project, then a few sessions. -->
  <div class="skeleton" aria-busy="true" aria-label="Scanning sessions">
    {#each [9, 13] as width, p (p)}
      <div class="sk-project"><span class="ghost" style="width: {width}ch"></span></div>
      {#each [16, 12, 18] as w, s (s)}
        <div class="sk-session"><span class="ghost" style="width: {w}ch"></span></div>
      {/each}
    {/each}
  </div>
{:else if appState.error}
  <div class="hint err">{appState.error}</div>
{:else if scratch}
  {#each SECTIONS as section (section.kind)}
    {@const project = shown.find((p) => p.kind === section.kind)}
    {#if project}
      {@render node(project, true)}
    {:else}
      <div class="hint section">
        <strong>{section.kind === 'chats' ? 'Chats' : 'Scratch'}</strong>
        {searching && mine.some((p) => p.kind === section.kind) ? `Nothing matches “${query.trim()}”.` : section.empty}
      </div>
    {/if}
  {/each}
{:else if mine.length === 0}
  <div class="first-run">
    <h3>No sessions yet</h3>
    <p>Start Claude or Codex in a folder and its sessions show up here.</p>
    <div class="starts">
      {#if onOpenFolder}<button class="start primary" onclick={onOpenFolder}><Icon name="folder" size={14} />Open a folder</button>{/if}
      {#if onAsk}
        <button class="start" onclick={() => onAsk('claude')}><Icon name="agent" size={14} />Ask Claude</button>
        <button class="start" onclick={() => onAsk('codex')}><Icon name="agent" size={14} />Ask Codex</button>
      {/if}
    </div>
    <dl>
      <dt>Ask an agent</dt><dd><kbd>{chordFor('askAgent')}</kbd></dd>
      <dt>New shell</dt><dd><kbd>{chordFor('newTab')}</kbd></dd>
      <dt>Command palette</dt><dd><kbd>{chordFor('palette')}</kbd></dd>
    </dl>
  </div>
{:else if shown.length === 0}
  <div class="hint">Nothing matches “{query.trim()}”.</div>
{:else}
  {#each shown as project (project.key)}{@render node(project, searching)}{/each}
{/if}

{#if !scratch && query.trim().length >= 3}
  <div class="found">
    <div class="found-head">In transcripts <span>{searchingText ? 'searching…' : found.length}</span></div>
    {#each found as h (h.session)}
      <button class="hit" data-row tabindex="-1" onclick={() => onOpenSession(h.project, h.meta)} title="Resume {h.meta.label}">
        <span class="hit-head"><b>{h.meta.label}</b><small>{h.project.name}, {relativeTime(h.meta.mtimeMs)}</small></span>
        <span class="snippet">{h.role === 'user' ? 'You: ' : ''}{h.snippet}</span>
      </button>
    {:else}
      {#if !searchingText}<div class="hint">No prompt or reply mentions “{query.trim()}”.</div>{/if}
    {/each}
  </div>
{/if}

{#if !scratch && archivedCount > 0}
  <button class="toggle-archived" onclick={() => (showArchived = !showArchived)}>
    {showArchived ? 'Hide archived sessions' : `Show ${archivedCount} archived session${archivedCount === 1 ? '' : 's'}`}
  </button>
{/if}

{#if preview}
  <SessionPreview
    session={preview.session}
    top={preview.top}
    left={preview.left}
    onClose={() => (preview = null)}
    onOpen={() => {
      const p = preview!;
      preview = null;
      onOpenSession(p.project, p.session);
    }}
  />
{/if}

{#if bulk}
  <ConfirmDialog
    confirmLabel={`Archive ${bulkKeys.length} session${bulkKeys.length === 1 ? '' : 's'}`}
    onConfirm={() => {
      const keys = bulkKeys;
      bulk = null;
      if (keys.length) void setArchived(keys, true);
    }}
    onCancel={() => (bulk = null)}
  >
    <h3 class="bulk-title">Archive old sessions in {bulk.project.name}</h3>
    <p class="bulk-text">Archived sessions leave the sidebar but stay on disk. "Show archived sessions" at the bottom of the list brings them back.</p>
    <label class="bulk-field">Not touched for <input type="number" min="1" bind:value={bulk.days} /> days</label>
    <label class="bulk-field">
      <input type="checkbox" checked={bulk.maxCost !== null} onchange={(e) => (bulk!.maxCost = e.currentTarget.checked ? 1 : null)} />
      Only those that cost under $
      <input type="number" min="0" step="0.5" disabled={bulk.maxCost === null} bind:value={bulk.maxCost} />
      {#if bulk.maxCost !== null}<small>at API prices</small>{/if}
    </label>
  </ConfirmDialog>
{/if}

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = null)} />
{/if}

<style>
  .first-run {
    margin: 10px;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--fg-dim);
    font-size: 12px;
    line-height: 1.5;
  }
  h3 {
    margin: 0 0 4px;
    color: var(--fg-bright);
    font-size: 13px;
    font-weight: 600;
  }
  .first-run p {
    margin: 0 0 12px;
  }
  .starts {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .start {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-surface);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }
  .start:hover {
    border-color: var(--accent);
  }
  .start.primary {
    border-color: var(--accent-strong);
    background: var(--accent-strong);
    color: var(--on-accent);
  }
  dl {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 6px 8px;
    margin: 14px 0 0;
    font-size: 11px;
  }
  dd {
    margin: 0;
  }
  kbd {
    padding: 0 5px;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 4px;
    background: var(--bg-surface);
    font: inherit;
  }
  /* Paddings match ProjectNode's row and SessionNode's indent. */
  .sk-project {
    padding: 7px 8px 7px 26px;
    font-size: 12px;
  }
  .sk-session {
    padding: 4px 10px 4px 62px;
    font-size: 12px;
  }
  .hint {
    padding: 10px 12px;
    color: var(--fg-faint);
    font-size: 11px;
    line-height: 1.5;
  }
  /* Lines up with a project row's name. */
  .hint.section {
    padding-left: 34px;
  }
  .hint strong {
    display: block;
    color: var(--fg);
    font-size: 12px;
    font-weight: 500;
  }
  .hint.err {
    color: var(--danger);
  }
  .notice {
    display: block;
    width: 100%;
    border: none;
    background: transparent;
    font: inherit;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }
  .found {
    margin-top: 6px;
    border-top: 1px solid var(--border);
  }
  .found-head {
    padding: 10px 10px 4px;
    color: var(--fg-faint);
    font-size: 11px;
  }
  .found-head span {
    margin-left: 2px;
    font-variant-numeric: tabular-nums;
  }
  .hit {
    display: flex;
    width: 100%;
    flex-direction: column;
    gap: 2px;
    padding: 5px 10px 5px 26px;
    border: none;
    background: transparent;
    color: var(--fg-dim);
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .hit:hover {
    background: var(--bg-hover);
    color: var(--fg);
  }
  .hit-head {
    display: flex;
    gap: 6px;
    align-items: baseline;
    min-width: 0;
  }
  .hit-head b {
    overflow: hidden;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hit-head small {
    flex: none;
    color: var(--fg-faint);
    font-size: 11px;
  }
  .snippet {
    display: -webkit-box;
    overflow: hidden;
    color: var(--fg-faint);
    font-size: 11px;
    line-height: 1.4;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
  .toggle-archived {
    margin: 8px 10px;
    padding: 0;
    border: none;
    background: none;
    color: var(--fg-faint);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  .toggle-archived:hover {
    color: var(--fg);
    text-decoration: underline;
  }
  .bulk-title {
    margin: 0 0 6px;
  }
  .bulk-text {
    margin: 0 0 12px;
    color: var(--fg-dim);
    font-size: 12px;
  }
  .bulk-field {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 8px;
    color: var(--fg);
    font-size: 12px;
  }
  .bulk-field input[type='number'] {
    width: 5em;
  }
</style>
