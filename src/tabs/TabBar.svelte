<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { activate, focusActiveTerminal, renameTab } from '../terminal/manager';
  import InlineRename from '../lib/InlineRename.svelte';
  import ProviderIcon from '../lib/ProviderIcon.svelte';
  import { revealPosition, tabWheelDelta } from './scroll';
  import type { AgentProvider, TabKey } from '../types';

  let { tabs, activeKey, onNew, onClose, renaming = $bindable(null) }: {
    tabs: { key: TabKey; provider: AgentProvider | null; title: string; exited: boolean; attention: boolean }[];
    activeKey: TabKey | null;
    onNew: () => void;
    /** Asks first when something is still running in the tab. */
    onClose: (key: TabKey) => void;
    /** The tab whose name is being edited; the app sets it from the rename chord. */
    renaming?: TabKey | null;
  } = $props();

  let scroller: HTMLDivElement;
  let track: HTMLDivElement;
  let hasOverflow = $state(false);
  let canScrollLeft = $state(false);
  let canScrollRight = $state(false);

  function updateScroll() {
    if (!scroller) return;
    hasOverflow = scroller.scrollWidth - scroller.clientWidth > 1;
    canScrollLeft = hasOverflow && scroller.scrollLeft > 1;
    canScrollRight = hasOverflow && scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1;
  }

  function revealActive(key: TabKey | null) {
    if (!key || !scroller || !track) return;
    const tab = [...track.querySelectorAll<HTMLElement>('[data-tab-key]')]
      .find((node) => node.dataset.tabKey === key);
    if (!tab) return;
    const left = revealPosition(scroller.scrollLeft, scroller.clientWidth, tab.offsetLeft, tab.offsetWidth);
    if (left !== scroller.scrollLeft) scroller.scrollTo({ left });
    updateScroll();
  }

  $effect(() => {
    const key = activeKey;
    void tabs.length;
    void tick().then(() => revealActive(key));
  });

  onMount(() => {
    const observer = new ResizeObserver(updateScroll);
    observer.observe(scroller);
    observer.observe(track);
    const wheel = (event: WheelEvent) => {
      if (scroller.scrollWidth <= scroller.clientWidth) return;
      const delta = tabWheelDelta(event.deltaX, event.deltaY);
      if (!delta) return;
      event.preventDefault();
      scroller.scrollLeft += delta;
    };
    scroller.addEventListener('wheel', wheel, { passive: false });
    updateScroll();
    return () => {
      observer.disconnect();
      scroller.removeEventListener('wheel', wheel);
    };
  });

  function scrollTabs(direction: -1 | 1) {
    scroller.scrollBy({ left: direction * Math.max(160, scroller.clientWidth * 0.75), behavior: 'smooth' });
  }

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
  {#if hasOverflow}
    <button class="scroll" disabled={!canScrollLeft} onclick={() => scrollTabs(-1)} aria-label="Scroll tabs left" title="Scroll tabs left">‹</button>
  {/if}
  <div class="tabs" bind:this={scroller} onscroll={updateScroll}>
  <div class="track" bind:this={track}>
  {#each tabs as tab (tab.key)}
    {#if renaming === tab.key}
      <div class="tab" class:active={tab.key === activeKey} data-tab-key={tab.key}>
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
      data-tab-key={tab.key}
      onclick={() => activate(tab.key)}
      ondblclick={() => (renaming = tab.key)}
      onmousedown={(e) => { if (e.button === 1) e.preventDefault(); }}
      onauxclick={(e) => { if (e.button === 1) close(e, tab.key); }}
      title="{tab.title} (double-click or Ctrl+Shift+R to rename)"
    >
      {#if tab.attention}<span class="attention" title="Needs your attention"></span>{/if}
      {#if tab.provider}<ProviderIcon provider={tab.provider} />{/if}
      <span class="label">{tab.title}</span>
      <span class="close" role="button" tabindex="-1"
        onclick={(e) => close(e, tab.key)}
        onkeydown={() => {}}>×</span>
    </button>
    {/if}
  {/each}
  </div>
  </div>
  {#if hasOverflow}
    <button class="scroll" disabled={!canScrollRight} onclick={() => scrollTabs(1)} aria-label="Scroll tabs right" title="Scroll tabs right">›</button>
  {/if}
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
  }
  .tabs {
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar { display: none; }
  .track {
    position: relative;
    display: flex;
    align-items: stretch;
    gap: 2px;
    width: max-content;
    min-width: 100%;
    height: 100%;
  }
  .tab {
    display: flex;
    flex: 0 0 auto;
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
  .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
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
    flex: 0 0 auto;
    padding: 0 10px;
    border: none;
    background: transparent;
    color: var(--fg-dim);
    font-size: 16px;
    cursor: pointer;
  }
  .new:hover { color: var(--fg-bright); }
  .scroll {
    flex: 0 0 24px;
    border: none;
    background: transparent;
    color: var(--fg-dim);
    font: inherit;
    font-size: 20px;
    cursor: pointer;
  }
  .scroll:hover:not(:disabled) { color: var(--fg-bright); background: var(--bg-hover); }
  .scroll:disabled { color: var(--fg-faint); cursor: default; }
</style>
