<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { activate, focusActiveTerminal, moveTab, renameTab } from '../terminal/manager';
  import { reorderable } from '../lib/dragReorder';
  import InlineRename from '../lib/InlineRename.svelte';
  import Icon from '../lib/Icon.svelte';
  import ProviderIcon from '../lib/ProviderIcon.svelte';
  import StatusDot from '../lib/StatusDot.svelte';
  import { providerName } from '../lib/agents';
  import { markTitle, tabMark } from '../lib/format';
  import { revealPosition, tabWheelDelta } from './scroll';
  import type { TabKey, TabSummary } from '../types';

  let { tabs, activeKey, onNew, onClose, renaming = $bindable(null) }: {
    tabs: TabSummary[];
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
    <button class="scroll" disabled={!canScrollLeft} onclick={() => scrollTabs(-1)} aria-label="Scroll tabs left" title="Scroll tabs left"><Icon name="back" size={14} /></button>
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
    {@const mark = tabMark(tab)}
    <button
      class="tab"
      class:active={tab.key === activeKey}
      class:exited={tab.exited}
      class:working={mark === 'working'}
      data-tab-key={tab.key}
      use:reorderable={{ id: tab.key, group: 'tab', onMove: (from, to) => moveTab(from as TabKey, to as TabKey) }}
      onclick={() => activate(tab.key)}
      ondblclick={() => (renaming = tab.key)}
      onmousedown={(e) => { if (e.button === 1) e.preventDefault(); }}
      onauxclick={(e) => { if (e.button === 1) close(e, tab.key); }}
      title="{tab.title} (double-click or Ctrl+Shift+R to rename)"
    >
      {#if mark !== 'open' && mark !== 'exited'}<StatusDot {mark} title={markTitle(mark, providerName(tab.provider ?? 'claude'))} />{/if}
      {#if tab.provider}<ProviderIcon provider={tab.provider} />{/if}
      <span class="label">{tab.title}</span>
      <span class="close" role="button" tabindex="-1"
        onclick={(e) => close(e, tab.key)}
        onkeydown={() => {}}><Icon name="close" size={12} /></span>
    </button>
    {/if}
  {/each}
  </div>
  </div>
  {#if hasOverflow}
    <button class="scroll" disabled={!canScrollRight} onclick={() => scrollTabs(1)} aria-label="Scroll tabs right" title="Scroll tabs right"><Icon name="chevron" size={14} /></button>
  {/if}
  <button class="new" onclick={onNew} title="New tab (Ctrl+Shift+T)" aria-label="New tab"><Icon name="plus" /></button>
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
    position: relative;
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 7px;
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
    animation: atc-fade var(--enter) var(--ease-out);
  }
  .tab:hover { background: var(--bg-hover); color: var(--fg); }
  .tab.active { background: var(--bg); color: var(--fg-bright); }
  /* The top edge carries state: accent on the focused tab, a sweep while an agent works. */
  .tab::before {
    position: absolute;
    top: 0;
    right: 8px;
    left: 8px;
    height: 2px;
    border-radius: 0 0 2px 2px;
    content: '';
    transform: scaleX(0);
    transition: transform var(--enter) var(--ease-out);
  }
  .tab.active::before { background: var(--accent); }
  .tab.active::before,
  .tab.working::before { transform: scaleX(1); }
  /* Three times the line's width, so the highlight starts and ends fully off it and the
     loop has no visible jump. */
  .tab.working::before {
    background: linear-gradient(90deg, transparent 40%, var(--warn) 50%, transparent 60%) 0 0 / 300% 100%;
    animation: sweep 1.6s ease-in-out infinite;
  }
  @keyframes sweep {
    from { background-position: 100% 0; }
    to { background-position: 0 0; }
  }
  :global([data-still]) .tab.working::before { background: var(--warn); animation: none; }
  /* Drop target while dragging a tab (#74). */
  .tab:global(.drop-target) { box-shadow: inset 2px 0 0 var(--accent); }
  .tab.exited .label { text-decoration: line-through; opacity: 0.6; }
  .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  /* Only where it is about to be used, so a row of tabs is not a row of crosses. */
  .close {
    display: grid;
    width: 18px;
    height: 18px;
    place-items: center;
    border-radius: 4px;
    opacity: 0;
    transition: opacity var(--fast), background-color var(--fast);
  }
  .tab:hover .close,
  .tab:focus-visible .close,
  .tab.active .close { opacity: 0.6; }
  .tab .close:hover { background: var(--border); opacity: 1; }
  .new {
    display: grid;
    flex: 0 0 auto;
    align-self: center;
    width: 28px;
    height: 26px;
    place-items: center;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--fg-dim);
    cursor: pointer;
  }
  .new:hover { background: var(--bg-hover); color: var(--fg-bright); }
  .new:active { transform: scale(0.92); }
  .scroll {
    display: grid;
    flex: 0 0 24px;
    place-items: center;
    border: none;
    background: transparent;
    color: var(--fg-dim);
    cursor: pointer;
  }
  .scroll:hover:not(:disabled) { color: var(--fg-bright); background: var(--bg-hover); }
  .scroll:disabled { color: var(--fg-faint); cursor: default; }
</style>
