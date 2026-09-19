<script lang="ts">
  import { activate, focusActiveTerminal, renameTab } from '../terminal/manager';
  import InlineRename from '../lib/InlineRename.svelte';
  import type { TabKey } from '../types';

  let { tabs, activeKey, onNew, onClose, renaming = $bindable(null) }: {
    tabs: { key: TabKey; title: string; exited: boolean; attention: boolean }[];
    activeKey: TabKey | null;
    onNew: () => void;
    /** Asks first when something is still running in the tab. */
    onClose: (key: TabKey) => void;
    /** The tab whose name is being edited; the app sets it from the rename chord. */
    renaming?: TabKey | null;
  } = $props();

  function finishRename(key: TabKey, name?: string) {
    if (name !== undefined) renameTab(key, name);
    renaming = null;
    focusActiveTerminal();
  }

  function close(e: MouseEvent, key: TabKey) {
    e.stopPropagation();
    onClose(key);
  }
</script>

<div class="bar">
  {#each tabs as tab (tab.key)}
    {#if renaming === tab.key}
      <div class="tab" class:active={tab.key === activeKey}>
        <InlineRename
          value={tab.title}
          onDone={(name) => finishRename(tab.key, name)}
          onCancel={() => finishRename(tab.key)}
        />
      </div>
    {:else}
    <button
      class="tab"
      class:active={tab.key === activeKey}
      class:exited={tab.exited}
      onclick={() => activate(tab.key)}
      ondblclick={() => (renaming = tab.key)}
      title="{tab.title} (double-click or Ctrl+Shift+R to rename)"
    >
      {#if tab.attention}<span class="attention" title="Needs your attention"></span>{/if}
      <span class="label">{tab.title}</span>
      <span class="close" role="button" tabindex="-1"
        onclick={(e) => close(e, tab.key)}
        onkeydown={() => {}}>×</span>
    </button>
    {/if}
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
    color: var(--fg-dim);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .tab:hover { background: var(--bg-hover); color: var(--fg); }
  .tab.active { background: var(--bg); color: var(--fg-bright); }
  .tab.exited .label { text-decoration: line-through; opacity: 0.6; }
  .label { overflow: hidden; text-overflow: ellipsis; }
  .attention {
    flex-shrink: 0;
    width: 7px;
    height: 7px;
    margin-right: -2px;
    border-radius: 50%;
    background: var(--accent);
  }
  .close {
    padding: 0 4px;
    border-radius: 4px;
    opacity: 0.5;
    font-size: 14px;
    line-height: 1;
  }
  .close:hover { background: var(--border); opacity: 1; }
  .new {
    padding: 0 10px;
    border: none;
    background: transparent;
    color: var(--fg-dim);
    font-size: 16px;
    cursor: pointer;
  }
  .new:hover { color: var(--fg-bright); }
</style>
