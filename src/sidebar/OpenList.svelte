<script lang="ts">
  import { onMount } from 'svelte';
  import ProviderIcon from '../lib/ProviderIcon.svelte';
  import { reorderable } from '../lib/dragReorder';
  import { markTitle, relativeTime, tabMark } from '../lib/format';
  import { providerName } from '../lib/agents';
  import StatusDot from '../lib/StatusDot.svelte';
  import { appState } from '../lib/stores.svelte';
  import { activate, getActiveKey, getTab, moveTab } from '../terminal/manager';
  import type { AgentProvider, Project, TabKey, TabSummary } from '../types';

  /** The sidebar's Open view: a task box, then every tab in tab-bar order (#132). */
  let { tabs, activeKey, query, onClose, onDispatch, onBroadcast }: {
    tabs: TabSummary[];
    activeKey: TabKey | null;
    query: string;
    /** Asks first when something is still running in the tab. */
    onClose: (key: TabKey) => void;
    /** Starts an agent on a task in the background. */
    onDispatch: (p: Project, provider: AgentProvider, task: string) => void;
    /** Types a line into each tab and presses Enter. */
    onBroadcast: (keys: TabKey[], text: string) => void;
  } = $props();

  // Last-output times are read from the tabs on this tick rather than on every chunk.
  let now = $state(Date.now());
  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 15_000);
    return () => clearInterval(timer);
  });

  const projectName = (key: string | null) => (key ? appState.index.projects.find((p) => p.key === key)?.name ?? '' : '');

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return q ? tabs.filter((t) => `${t.title} ${projectName(t.projectKey)}`.toLowerCase().includes(q)) : tabs;
  });

  // --- dispatch: type a task, Enter starts an agent on it and stays where you are.
  const projects = $derived(appState.index.projects.filter((p) => p.path && p.exists));
  let task = $state('');
  let provider = $state<AgentProvider>('claude');
  let target = $state('');
  function dispatch(e: SubmitEvent) {
    e.preventDefault();
    // Default to the focused tab's project, so "do X" lands where you are working.
    const here = getTab(getActiveKey() as TabKey)?.projectKey;
    const p = projects.find((p) => p.key === (target || here)) ?? projects[0];
    if (!task.trim() || !p) return;
    onDispatch(p, provider, task.trim());
    task = '';
  }

  // --- broadcast: Ctrl+click picks tabs, the bar below types into all of them.
  let picked = $state(new Set<TabKey>());
  let line = $state('');
  const live = $derived([...picked].filter((k) => tabs.some((t) => t.key === k && !t.exited)));
  function pick(e: MouseEvent, key: TabKey) {
    if (!e.ctrlKey) {
      picked = new Set();
      activate(key);
      return;
    }
    const next = new Set(picked);
    if (!next.delete(key)) next.add(key);
    picked = next;
  }
  function broadcast(e: SubmitEvent) {
    e.preventDefault();
    if (!line.trim()) return;
    onBroadcast(live, line);
    line = '';
  }
</script>

<form class="dispatch" onsubmit={dispatch}>
  <input bind:value={task} placeholder="Give an agent a task, Enter to start" aria-label="Task" spellcheck="false" />
  <div class="where">
    <select bind:value={target} aria-label="Project">
      <option value="">This tab's project</option>
      {#each projects as p (p.key)}<option value={p.key}>{p.name}</option>{/each}
    </select>
    <select bind:value={provider} aria-label="Agent">
      <option value="claude">Claude</option>
      <option value="codex">Codex</option>
    </select>
  </div>
</form>

{#if tabs.length === 0}
  <div class="hint">No tabs open.</div>
{:else if shown.length === 0}
  <div class="hint">Nothing matches “{query.trim()}”.</div>
{/if}
{#each shown as tab (tab.key)}
  {@const s = markTitle(tabMark(tab), providerName(tab.provider ?? 'claude'))}
  <button
    class="row"
    class:active={tab.key === activeKey}
    class:picked={picked.has(tab.key)}
    class:exited={tab.exited}
    data-row
    tabindex="-1"
    use:reorderable={{ id: tab.key, group: 'open', onMove: (from, to) => moveTab(from as TabKey, to as TabKey) }}
    onclick={(e) => pick(e, tab.key)}
    onmousedown={(e) => { if (e.button === 1) e.preventDefault(); }}
    onauxclick={(e) => { if (e.button === 1) onClose(tab.key); }}
    title="{tab.title} · {s} (Ctrl+click to pick for broadcast, middle-click to close)"
  >
    <StatusDot mark={tabMark(tab)} title={s} />
    <span class="icon">{#if tab.provider}<ProviderIcon provider={tab.provider} />{:else}›_{/if}</span>
    <span class="text">{tab.title}{#if projectName(tab.projectKey)}<small>{projectName(tab.projectKey)}</small>{/if}</span>
    <time>{relativeTime(getTab(tab.key)?.lastOutputAt ?? 0, now)}</time>
  </button>
{/each}

{#if live.length > 0}
  <form class="broadcast" onsubmit={broadcast}>
    <!-- svelte-ignore a11y_autofocus -->
    <input bind:value={line} placeholder="Send to {live.length} tab{live.length === 1 ? '' : 's'}, Enter to send" aria-label="Broadcast" spellcheck="false" autofocus />
    <button type="button" onclick={() => (picked = new Set())} aria-label="Clear the picked tabs">×</button>
  </form>
{/if}

<style>
  .dispatch {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 2px 8px 8px;
    border-bottom: 1px solid var(--border);
  }
  input,
  select {
    box-sizing: border-box;
    min-width: 0;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg-bright);
    font: inherit;
    font-size: 12px;
  }
  input:focus,
  select:focus {
    border-color: var(--accent);
    outline: none;
  }
  .where {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 4px;
  }
  select {
    padding: 2px 4px;
    color: var(--fg-dim);
    font-size: 11px;
  }
  .hint {
    padding: 10px 12px;
    color: var(--fg-faint);
    font-size: 11px;
  }
  .row {
    display: grid;
    grid-template-columns: 10px 16px 1fr auto;
    gap: 6px;
    align-items: center;
    width: 100%;
    padding: 5px 10px;
    border: none;
    background: transparent;
    color: var(--fg-dim);
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .row:hover {
    background: var(--bg-hover);
    color: var(--fg);
  }
  .row.active {
    background: color-mix(in srgb, var(--accent-strong) 16%, transparent);
    color: var(--fg-bright);
  }
  .row.picked {
    box-shadow: inset 3px 0 0 var(--warn);
    background: color-mix(in srgb, var(--warn) 10%, transparent);
  }
  .row:global(.drop-target) {
    box-shadow: inset 0 2px 0 var(--accent);
  }
  .row.exited .text {
    opacity: 0.6;
    text-decoration: line-through;
  }
  .icon {
    color: var(--fg-faint);
    font-family: ui-monospace, monospace;
    font-size: 10px;
    text-align: center;
  }
  .text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  small {
    margin-left: 6px;
    color: var(--fg-faint);
    font-size: 11px;
  }
  time {
    color: var(--fg-faint);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .broadcast {
    position: sticky;
    bottom: 0;
    display: flex;
    gap: 4px;
    padding: 6px 8px;
    border-top: 1px solid var(--warn);
    background: var(--bg-chrome);
  }
  .broadcast input {
    flex: 1;
  }
  .broadcast button {
    border: none;
    background: transparent;
    color: var(--fg-faint);
    cursor: pointer;
  }
</style>
