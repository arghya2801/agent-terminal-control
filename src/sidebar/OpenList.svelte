<script lang="ts">
  import { onMount } from 'svelte';
  import ProviderIcon from '../lib/ProviderIcon.svelte';
  import Highlight from '../lib/Highlight.svelte';
  import Icon from '../lib/Icon.svelte';
  import { reorderable } from '../lib/dragReorder';
  import { markTitle, relativeTime, tabMark } from '../lib/format';
  import { providerName } from '../lib/agents';
  import StatusDot from '../lib/StatusDot.svelte';
  import { appState } from '../lib/stores.svelte';
  import { peekLine, stateWord, triageOrder } from '../lib/triage';
  import { activate, moveTab, outputHistory, screenLines } from '../terminal/manager';
  import type { TabKey, TabSummary } from '../types';

  /** The sidebar's Open view: every tab, most urgent first, or in tab-bar order (#132). */
  let { tabs, activeKey, query, triage, onClose }: {
    tabs: TabSummary[];
    activeKey: TabKey | null;
    query: string;
    /** Needs-you first. Off, the tab bar's order, which dragging changes. */
    triage: boolean;
    /** Asks first when something is still running in the tab. */
    onClose: (key: TabKey) => void;
  } = $props();

  // Screen text and output history are read on this tick rather than on every chunk.
  let now = $state(Date.now());
  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 5_000);
    return () => clearInterval(timer);
  });

  const projectName = (key: string | null) => (key ? appState.index.projects.find((p) => p.key === key)?.name ?? '' : '');

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const hits = q ? tabs.filter((t) => `${t.title} ${projectName(t.projectKey)}`.toLowerCase().includes(q)) : tabs;
    return triage ? triageOrder(hits.map((t) => ({ ...t, mark: tabMark(t) }))) : hits;
  });

  /** A 30-bar sparkline path, one bar per 10 s, scaled so a trickle stays short. */
  function spark(key: TabKey, _tick: number): string {
    const h = outputHistory(key);
    const top = Math.max(4096, ...h);
    return h.map((v, i) => (v ? `M${i * 2 + 0.5} 10V${10 - Math.max(1, (v / top) * 10)}` : '')).join('');
  }
</script>

{#if tabs.length === 0}
  <div class="hint">No tabs open.</div>
{:else if shown.length === 0}
  <div class="hint">Nothing matches “{query.trim()}”.</div>
{/if}
{#each shown as tab (tab.key)}
  {@const mark = tabMark(tab)}
  {@const s = markTitle(mark, providerName(tab.provider ?? 'claude'))}
  {@const peek = peekLine((void now, screenLines(tab.key)))}
  <button
    class="row {mark}"
    class:active={tab.key === activeKey}
    class:exited={tab.exited}
    data-row
    data-tab-key={tab.key}
    tabindex="-1"
    use:reorderable={{ id: tab.key, group: 'open', onMove: (from, to) => !triage && moveTab(from as TabKey, to as TabKey) }}
    onclick={() => activate(tab.key)}
    onmousedown={(e) => { if (e.button === 1) e.preventDefault(); }}
    onauxclick={(e) => { if (e.button === 1) onClose(tab.key); }}
    title="{tab.title} · {s} (middle-click to close)"
  >
    <StatusDot {mark} title={s} />
    <span class="icon">{#if tab.provider}<ProviderIcon provider={tab.provider} />{:else}<Icon name="terminal" size={12} />{/if}</span>
    <span class="text"><Highlight text={tab.title} {query} />{#if projectName(tab.projectKey)}<small><Highlight text={projectName(tab.projectKey)} {query} /></small>{/if}</span>
    <time>{stateWord(mark)} {relativeTime(tab.since, now)}</time>
    {#if peek}<span class="peek">{peek}</span>{/if}
    <svg class="spark" viewBox="0 0 60 10" preserveAspectRatio="none" aria-hidden="true"><path d={spark(tab.key, now)} /></svg>
  </button>
{/each}

<style>
  .hint {
    padding: 10px 12px;
    color: var(--fg-faint);
    font-size: 11px;
  }
  .row {
    display: grid;
    grid-template-columns: 10px 16px 1fr auto;
    column-gap: 6px;
    row-gap: 1px;
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
  .row:global(.drop-target) {
    box-shadow: inset 0 2px 0 var(--accent);
  }
  .row.exited .text {
    opacity: 0.6;
    text-decoration: line-through;
  }
  .icon {
    display: grid;
    place-items: center;
    color: var(--fg-faint);
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
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
  .attention time {
    color: var(--accent);
  }
  .peek {
    grid-column: 3 / 4;
    min-width: 0;
    overflow: hidden;
    color: var(--fg-faint);
    font-family: ui-monospace, monospace;
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .attention .peek {
    color: var(--fg);
  }
  .spark {
    grid-column: 4;
    grid-row: 2;
    justify-self: end;
    width: 60px;
    height: 10px;
    stroke: var(--fg-faint);
    stroke-width: 1.5;
  }
  .working .spark {
    stroke: var(--warn);
  }
</style>
