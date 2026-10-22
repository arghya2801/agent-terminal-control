<script lang="ts">
  import { onMount } from 'svelte';
  import { moveIndex } from '../lib/roving';
  import { pageZoom } from '../lib/desktop';
  import Icon, { type IconName } from '../lib/Icon.svelte';

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
    icon?: IconName;
    /** The chord that does the same, shown on the right. Only where it really does. */
    hint?: string;
  }

  let {
    x,
    y,
    items,
    dropdown = false,
    onClose,
  }: {
    x: number;
    y: number;
    items: MenuItem[];
    /** Dropped from a button: `x` is the button's right edge, and the menu hugs its labels. */
    dropdown?: boolean;
    onClose: () => void;
  } = $props();

  let el: HTMLDivElement;
  /** Everything here is in on-screen pixels; the style divides by the page zoom. */
  const zoom = pageZoom();
  /** Set once measured; until then the menu renders at the cursor. Keeping it separate
   *  from the props avoids rendering at 0,0 for a frame. */
  let clamped = $state<{ left: number; top: number } | null>(null);
  // Nudged back inside the window when opened near an edge.
  const pos = $derived(clamped ?? { left: x, top: y });
  // Grows out of the corner nearest the cursor, which is not the top-left once nudged.
  const origin = $derived(`${pos.top < y ? 'bottom' : 'top'} ${dropdown || pos.left < x ? 'right' : 'left'}`);

  function choose(item: MenuItem) {
    if (item.disabled || !item.run) return;
    item.run();
    onClose();
  }

  onMount(() => {
    // On the body, so no transformed or clipped ancestor (the sliding sidebar) can move
    // or cut off a fixed-position menu.
    document.body.append(el);
    // Measured without the entrance animation, which starts the menu at 94% of its size.
    el.style.animation = 'none';
    const rect = el.getBoundingClientRect();
    el.style.animation = '';
    clamped = {
      left: Math.max(8, Math.min(dropdown ? x - rect.width : x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    };

    // Capture phase, so a click anywhere dismisses before it activates something else.
    const onDown = (e: MouseEvent) => {
      if (!el.contains(e.target as Node)) onClose();
    };
    // Keyboard use (#103): focus starts on the first item, arrows move, Esc returns focus
    // to where the menu was opened from.
    const opener = document.activeElement as HTMLElement | null;
    const items = () => [...el.querySelectorAll<HTMLButtonElement>('button.item:not(:disabled)')];
    items()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        opener?.focus();
        return;
      }
      const all = items();
      const next = moveIndex(e.key, all.indexOf(document.activeElement as HTMLButtonElement), all.length);
      if (next === null) return;
      e.preventDefault();
      e.stopPropagation();
      all[next].focus();
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      el.remove();
    };
  });
</script>

<div
  class="menu"
  class:dropdown
  bind:this={el}
  style="left: {pos.left / zoom}px; top: {pos.top / zoom}px; transform-origin: {origin}"
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
        {#if item.checked !== undefined}<span class="tick">{item.checked ? '✓' : ''}</span>
        {:else}<span class="ic">{#if item.icon}<Icon name={item.icon} size={14} />{/if}</span>{/if}
        <span class="label">{item.label}</span>
        {#if item.hint}<kbd>{item.hint}</kbd>{/if}
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
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-chrome);
    box-shadow: var(--shadow-pop);
    animation: atc-pop var(--enter) var(--ease-out);
  }
  .menu.dropdown {
    min-width: 0;
  }
  .dropdown .item {
    padding: 5px 12px 5px 8px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
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
    white-space: nowrap;
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ic {
    display: grid;
    width: 14px;
    flex-shrink: 0;
    place-items: center;
    color: var(--fg-faint);
  }
  .item:hover:not(.disabled) .ic,
  .item:focus-visible .ic {
    color: inherit;
  }
  kbd {
    margin-left: 16px;
    color: var(--fg-faint);
    font: inherit;
    font-size: 11px;
  }
  .item:hover:not(.disabled),
  .item:focus-visible {
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
    padding: 4px 10px 2px 32px;
    color: var(--fg-faint);
    font-size: 11px;
  }
</style>
