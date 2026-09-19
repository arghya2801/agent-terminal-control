<script lang="ts">
  import { onMount } from 'svelte';

  export interface MenuItem {
    label: string;
    run: () => void;
    disabled?: boolean;
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
    if (item.disabled) return;
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
  {#each items as item (item.label)}
    <button
      class="item"
      class:disabled={item.disabled}
      disabled={item.disabled}
      onclick={() => choose(item)}
      role="menuitem"
    >
      {item.label}
    </button>
  {/each}
</div>

<style>
  .menu {
    position: fixed;
    z-index: 50;
    min-width: 168px;
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
  }
  .item:hover:not(.disabled) {
    background: color-mix(in srgb, var(--accent-strong) 20%, transparent);
    color: var(--fg-bright);
  }
  .item.disabled {
    color: var(--fg-faint);
    cursor: default;
  }
</style>
