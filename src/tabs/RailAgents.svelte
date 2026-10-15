<script lang="ts">
  import ProviderIcon from '../lib/ProviderIcon.svelte';
  import StatusDot from '../lib/StatusDot.svelte';
  import { markTitle, relativeTime, tabMark } from '../lib/format';
  import { providerName } from '../lib/agents';
  import { peekLine, stateWord } from '../lib/triage';
  import { activate, screenLines } from '../terminal/manager';
  import type { TabKey, TabSummary } from '../types';

  /** Every open tab as one rail button, in tab-bar order, so the sidebar can stay shut. */
  let { tabs, activeKey, quiet, onClose }: {
    tabs: TabSummary[];
    activeKey: TabKey | null;
    /** Focus mode: finished agents look idle until it ends. */
    quiet: boolean;
    onClose: (key: TabKey) => void;
  } = $props();

  /** The tooltip is built on hover, so screen text is only read when someone looks. */
  function describe(e: PointerEvent, tab: TabSummary) {
    const mark = tabMark(tab);
    const peek = peekLine(screenLines(tab.key));
    const state = `${markTitle(mark, providerName(tab.provider ?? 'claude'))} ${stateWord(mark) ? `· ${relativeTime(tab.since)}` : ''}`;
    (e.currentTarget as HTMLElement).title = [tab.title, state, peek].filter(Boolean).join('\n');
  }
</script>

<div class="agents" role="group" aria-label="Open tabs">
  {#each tabs as tab (tab.key)}
    {@const mark = tabMark(tab)}
    <button
      class="agent"
      class:active={tab.key === activeKey}
      class:exited={tab.exited}
      onclick={() => activate(tab.key)}
      onpointerenter={(e) => describe(e, tab)}
      onmousedown={(e) => { if (e.button === 1) e.preventDefault(); }}
      onauxclick={(e) => { if (e.button === 1) onClose(tab.key); }}
      aria-label={tab.title}
    >
      {#if tab.provider}<ProviderIcon provider={tab.provider} />{:else}<span class="shell">›_</span>{/if}
      <span class="badge"><StatusDot mark={quiet && mark === 'attention' ? 'idle' : mark} title="" /></span>
    </button>
  {/each}
</div>

<style>
  .agents {
    display: flex;
    flex: 1;
    min-height: 0;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 100%;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
    overflow-y: auto;
    scrollbar-width: none;
  }
  .agent {
    position: relative;
    display: grid;
    flex: none;
    place-items: center;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--fg-dim);
    cursor: pointer;
  }
  .agent:hover {
    background: var(--bg-hover);
    color: var(--fg);
  }
  .agent.active {
    background: color-mix(in srgb, var(--accent-strong) 22%, transparent);
    color: var(--fg-bright);
  }
  .agent.active::before {
    position: absolute;
    left: -7px;
    width: 3px;
    height: 16px;
    border-radius: 0 2px 2px 0;
    background: var(--accent);
    content: '';
  }
  .agent.exited {
    opacity: 0.4;
  }
  .shell {
    font-family: ui-monospace, monospace;
    font-size: 10px;
  }
  .badge {
    position: absolute;
    right: 3px;
    bottom: 3px;
    display: flex;
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--bg-chrome);
  }
</style>
