<script lang="ts">
  import { activate, closeTab, isBusy } from '../terminal/manager';
  import type { TabKey } from '../types';

  let { tabs, activeKey, onNew }: {
    tabs: { key: TabKey; title: string; exited: boolean }[];
    activeKey: TabKey | null;
    onNew: () => void;
  } = $props();

  async function close(e: MouseEvent, key: TabKey) {
    e.stopPropagation();
    // Closing a tab sitting at a bare prompt is free; killing a live claude session
    // is not, so only that case asks.
    if (isBusy(key) && !confirm('A process is still running in this tab. Close it?')) return;
    await closeTab(key);
  }
</script>

<div class="bar">
  {#each tabs as tab (tab.key)}
    <button
      class="tab"
      class:active={tab.key === activeKey}
      class:exited={tab.exited}
      onclick={() => activate(tab.key)}
      title={tab.title}
    >
      <span class="label">{tab.title}</span>
      <span class="close" role="button" tabindex="-1"
        onclick={(e) => close(e, tab.key)}
        onkeydown={() => {}}>×</span>
    </button>
  {/each}
  <button class="new" onclick={onNew} title="New tab (Ctrl+Shift+T)">+</button>
</div>

<style>
  .bar {
    display: flex;
    align-items: stretch;
    gap: 2px;
    height: 34px;
    padding: 4px 6px 0;
    background: var(--bg-chrome);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 220px;
    padding: 0 6px 0 12px;
    border: none;
    border-radius: 6px 6px 0 0;
    background: transparent;
    color: #8b949e;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .tab:hover { background: #1c2027; color: #c9d1d9; }
  .tab.active { background: var(--bg); color: #e6edf3; }
  .tab.exited .label { text-decoration: line-through; opacity: 0.6; }
  .label { overflow: hidden; text-overflow: ellipsis; }
  .close {
    padding: 0 4px;
    border-radius: 4px;
    opacity: 0.5;
    font-size: 14px;
    line-height: 1;
  }
  .close:hover { background: #30363d; opacity: 1; }
  .new {
    padding: 0 10px;
    border: none;
    background: transparent;
    color: #8b949e;
    font-size: 16px;
    cursor: pointer;
  }
  .new:hover { color: #e6edf3; }
</style>
