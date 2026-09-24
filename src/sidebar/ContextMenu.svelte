<script lang="ts">
  import { onMount } from 'svelte';

  export interface MenuItem {
    label: string;
    /** Omitted for a heading. */
    run?: () => void;
    disabled?: boolean;
    /** A rule above this item. */
    sep?: boolean;
    /** Shows a tick column; true ticks it. */
    checked?: boolean;
    danger?: boolean;
  }

  let {
    x,
    y,
    items,
    onClose,
  }: { x: number; y: number; items: MenuItem[]; onClose: () => void } = $props();

  let el: HTMLDivElement;
  /** Set once measured; until then the menu renders at the cursor. Keeping it separate
   *  from the props avoids rendering at 0,0 for a frame. */
  let clamped = $state<{ left: number; top: number } | null>(null);
  // Nudged back inside the window when opened near an edge.
  const pos = $derived(clamped ?? { left: x, top: y });

  function choose(item: MenuItem) {
    if (item.disabled || !item.run) return;
    item.run();
    onClose();
  }

  onMount(() => {
    const rect = el.getBoundingClientRect();
    clamped = {
      left: Math.min(x, window.innerWidth - rect.width - 8),
      top: Math.min(y, window.innerHeight - rect.height - 8),
    };

    // Capture phase, so a click anywhere dismisses before it activates something else.
    const onDown = (e: MouseEvent) => {
      if (!el.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  });
</script>

<div
  class="menu"
  bind:this={el}
  style="left: {pos.left}px; top: {pos.top}px"
  role="menu"
  tabindex="-1"
>
  <!-- Keyed by position: labels repeat, e.g. two sessions with the same name. -->
  {#each items as item, i (i)}
    {#if item.sep}<div class="sep" role="separator"></div>{/if}
    {#if item.run}
      <button
        class="item"
        class:disabled={item.disabled}
        class:danger={item.danger}
        disabled={item.disabled}
        onclick={() => choose(item)}
        role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
        aria-checked={item.checked}
      >
        {#if item.checked !== undefined}<span class="tick">{item.checked ? '✓' : ''}</span>{/if}
        {item.label}
      </button>
    {:else}
      <div class="heading">{item.label}</div>
    {/if}
  {/each}
</div>

<style>
  .menu {
    position: fixed;
    z-index: 50;
    min-width: 168px;
    /* Session names can be long; they truncate rather than widen the menu. */
    max-width: 320px;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-chrome);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
  }
  .item {
    display: block;
    width: 100%;
    padding: 6px 10px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--fg);
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .item:hover:not(.disabled) {
    background: color-mix(in srgb, var(--accent-strong) 20%, transparent);
    color: var(--fg-bright);
  }
  .item.disabled {
    color: var(--fg-faint);
    cursor: default;
  }
  .item.danger {
    color: var(--danger);
  }
  .item.danger:hover:not(.disabled) {
    background: color-mix(in srgb, var(--danger) 20%, transparent);
    color: var(--danger);
  }
  .tick {
    display: inline-block;
    width: 14px;
    color: var(--ok);
  }
  .sep {
    height: 1px;
    margin: 4px 2px;
    background: var(--border);
  }
  .heading {
    padding: 4px 10px 2px;
    color: var(--fg-faint);
    font-size: 11px;
  }
</style>
