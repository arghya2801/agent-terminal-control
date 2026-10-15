<script lang="ts">
  import ProviderIcon from '../lib/ProviderIcon.svelte';
  import StatusDot from '../lib/StatusDot.svelte';
  import { relativeTime, tabMark } from '../lib/format';
  import { appState } from '../lib/stores.svelte';
  import { peekLine, stateWord } from '../lib/triage';
  import { screenLines } from '../terminal/manager';
  import type { TabKey, TabSummary } from '../types';

  /** The waiting agents while Ctrl+Shift+J is held. The selected one is already on screen. */
  let { tabs, selected }: { tabs: TabSummary[]; selected: TabKey } = $props();

  const projectName = (key: string | null) => (key ? appState.index.projects.find((p) => p.key === key)?.name ?? '' : '');
</script>

<div class="switcher" role="listbox" aria-label="Waiting agents">
  {#each tabs as tab (tab.key)}
    {@const mark = tabMark(tab)}
    <div class="item" class:on={tab.key === selected} role="option" aria-selected={tab.key === selected}>
      <StatusDot {mark} title="" />
      {#if tab.provider}<ProviderIcon provider={tab.provider} />{/if}
      <span class="title">{tab.title}<small>{projectName(tab.projectKey)}</small></span>
      <time>{stateWord(mark)} {relativeTime(tab.since)}</time>
      <span class="peek">{peekLine(screenLines(tab.key)) ?? ''}</span>
    </div>
  {/each}
  <p>Release Ctrl+Shift to stay. J again for the next.</p>
</div>

<style>
  .switcher {
    position: absolute;
    top: 48px;
    left: 50%;
    z-index: 30;
    width: min(520px, calc(100% - 32px));
    padding: 6px;
    transform: translateX(-50%);
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-chrome);
    box-shadow: 0 12px 32px rgb(0 0 0 / 0.45);
  }
  .item {
    display: grid;
    grid-template-columns: 10px 16px 1fr auto;
    column-gap: 8px;
    align-items: center;
    padding: 6px 8px;
    border-radius: 6px;
    color: var(--fg-dim);
    font-size: 12px;
  }
  .item.on {
    background: color-mix(in srgb, var(--accent-strong) 22%, transparent);
    color: var(--fg-bright);
  }
  .title {
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
  }
  .peek {
    grid-column: 3 / 5;
    overflow: hidden;
    color: var(--fg-faint);
    font-family: ui-monospace, monospace;
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  p {
    margin: 6px 8px 2px;
    color: var(--fg-faint);
    font-size: 10px;
  }
</style>
