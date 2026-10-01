<script lang="ts">
  import { onMount } from 'svelte';
  import ProviderIcon from '../lib/ProviderIcon.svelte';
  import { reorderable } from '../lib/dragReorder';
  import { relativeTime } from '../lib/format';
  import { appState } from '../lib/stores.svelte';
  import { activate, getTab, moveTab } from '../terminal/manager';
  import type { TabKey, TabSummary } from '../types';

  /** The sidebar's Open view: every tab in tab-bar order (#132). */
  let { tabs, activeKey, query, onClose }: {
    tabs: TabSummary[];
    activeKey: TabKey | null;
    query: string;
    /** Asks first when something is still running in the tab. */
    onClose: (key: TabKey) => void;
  } = $props();

  // Last-output times are read from the tabs on this tick rather than on every chunk.
  let now = $state(Date.now());
  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 15_000);
    return () => clearInterval(timer);
  });

  const projectName = (key: string | null) => (key ? appState.index.projects.find((p) => p.key === key)?.name ?? '' : '');
  const status = (t: TabSummary) =>
    t.exited ? 'exited' : t.activity === 'working' ? 'working' : t.attention ? 'attention' : 'idle';
  const LABEL = { working: 'Working', attention: 'Needs you', idle: 'Idle', exited: 'Exited' };

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return q ? tabs.filter((t) => `${t.title} ${projectName(t.projectKey)}`.toLowerCase().includes(q)) : tabs;
  });
</script>

{#if tabs.length === 0}
  <div class="hint">No tabs open.</div>
{:else if shown.length === 0}
  <div class="hint">Nothing matches “{query.trim()}”.</div>
{/if}
{#each shown as tab (tab.key)}
  {@const s = status(tab)}
  <button
    class="row"
    class:active={tab.key === activeKey}
    class:exited={tab.exited}
    data-row
    tabindex="-1"
    use:reorderable={{ id: tab.key, group: 'open', onMove: (from, to) => moveTab(from as TabKey, to as TabKey) }}
    onclick={() => activate(tab.key)}
    onmousedown={(e) => { if (e.button === 1) e.preventDefault(); }}
    onauxclick={(e) => { if (e.button === 1) onClose(tab.key); }}
    title="{tab.title} · {LABEL[s]} (middle-click to close)"
  >
    <span class="dot {s}" aria-label={LABEL[s]}></span>
    <span class="icon">{#if tab.provider}<ProviderIcon provider={tab.provider} />{:else}›_{/if}</span>
    <span class="text">{tab.title}{#if projectName(tab.projectKey)}<small>{projectName(tab.projectKey)}</small>{/if}</span>
    <time>{relativeTime(getTab(tab.key)?.lastOutputAt ?? 0, now)}</time>
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
  .row:global(.drop-target) {
    box-shadow: inset 0 2px 0 var(--accent);
  }
  .row.exited .text {
    opacity: 0.6;
    text-decoration: line-through;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }
  .dot.working {
    background: var(--warn);
    animation: pulse 1.2s ease-in-out infinite;
  }
  .dot.attention {
    background: var(--accent);
  }
  .dot.idle {
    box-sizing: border-box;
    border: 1px solid var(--fg-faint);
  }
  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dot.working {
      animation: none;
    }
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
</style>
