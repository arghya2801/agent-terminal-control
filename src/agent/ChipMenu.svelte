<script lang="ts" module>
  export interface MenuItem {
    value: string;
    label: string;
    description?: string;
  }
  export interface MenuSection {
    title?: string;
    /** Draws beside the title, e.g. a provider icon. */
    icon?: import('svelte').Snippet;
    items: MenuItem[];
    /** Items behind a "More" row, shown on request. */
    more?: { label: string; items: MenuItem[] };
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  /** A chip in the composer's toolbar that opens a panel above it: sections of choices,
   *  the current one checked, and an optional footer for settings that go with them. */
  let { label, title, sections, value, onPick, footer, width = 300 }: {
    label: Snippet;
    title: string;
    sections: MenuSection[];
    value: string;
    onPick: (value: string) => void;
    footer?: Snippet;
    width?: number;
  } = $props();

  let open = $state(false);
  let showMore = $state<Record<number, boolean>>({});
  let root = $state<HTMLDivElement>();
  let panel = $state<HTMLDivElement>();

  // The section holding the current value starts with its older items shown, so the check
  // is never hidden.
  $effect(() => {
    if (!open) return;
    sections.forEach((s, i) => {
      if (s.more?.items.some((it) => it.value === value)) showMore[i] = true;
    });
    queueMicrotask(() => (panel?.querySelector('[aria-checked="true"]') as HTMLElement | null ?? panel?.querySelector('button'))?.focus());
    const away = (e: PointerEvent) => {
      if (!root?.contains(e.target as Node)) open = false;
    };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  });

  function choose(v: string) {
    onPick(v);
    open = false;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      open = false;
      (root?.querySelector('.chip') as HTMLElement | null)?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const buttons = [...(panel?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
      const at = buttons.indexOf(document.activeElement as HTMLElement);
      buttons[(at + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }
  }
</script>

<div class="wrap" bind:this={root}>
  <button class="chip" class:on={open} onclick={() => (open = !open)} aria-haspopup="menu" aria-expanded={open} {title}>
    {@render label()}
    <span class="caret" aria-hidden="true">▾</span>
  </button>
  {#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions (keys move between the items) -->
    <div class="panel" role="menu" aria-label={title} tabindex="-1" style:width="{width}px" bind:this={panel} onkeydown={onKey}>
      {#each sections as s, i (i)}
        {#if s.title}<div class="head">{@render s.icon?.()}<span>{s.title}</span></div>{/if}
        {#each [...s.items, ...(showMore[i] ? (s.more?.items ?? []) : [])] as it (it.value)}
          <button class="item" role="menuitemradio" aria-checked={it.value === value} onclick={() => choose(it.value)}>
            <span class="text"><span class="name">{it.label}</span>{#if it.description}<span class="desc">{it.description}</span>{/if}</span>
            {#if it.value === value}<span class="check" aria-hidden="true">✓</span>{/if}
          </button>
        {/each}
        {#if s.more && !showMore[i]}
          <button class="more" onclick={() => (showMore[i] = true)}>{s.more.label}</button>
        {/if}
      {/each}
      {#if footer}<div class="footer">{@render footer()}</div>{/if}
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font: inherit;
    font-size: 12px;
    color: var(--fg-dim);
    background: var(--bg-surface);
    border: 1px solid transparent;
    border-radius: 7px;
    padding: 3px 8px 3px 9px;
    cursor: pointer;
    white-space: nowrap;
  }
  .chip:hover,
  .chip.on {
    color: var(--fg-bright);
  }
  .chip.on {
    border-color: var(--border);
  }
  .chip:focus-visible {
    outline: 1px solid var(--accent);
  }
  .caret {
    font-size: 9px;
    color: var(--fg-faint);
  }
  .panel {
    position: absolute;
    left: -4px;
    bottom: calc(100% + 10px);
    z-index: 3;
    max-height: min(70vh, 520px);
    overflow-y: auto;
    padding: 6px;
    background: var(--bg-chrome);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--shadow-pop);
    animation: rise var(--enter) var(--ease-out);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
  .head {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 8px 8px 4px;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--fg-dim);
  }
  .head:not(:first-child) {
    margin-top: 4px;
    border-top: 1px solid var(--border);
    padding-top: 10px;
  }
  .item,
  .more {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 8px;
    border-radius: 7px;
    cursor: pointer;
  }
  .item:hover,
  .item:focus-visible,
  .more:hover,
  .more:focus-visible {
    background: var(--bg-hover);
    outline: none;
  }
  .item[aria-checked='true'] {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .name {
    font-size: 13px;
    color: var(--fg-bright);
  }
  .desc {
    font-size: 11.5px;
    color: var(--fg-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .check {
    color: var(--accent);
    font-size: 12px;
  }
  .more {
    font-size: 12px;
    color: var(--fg-dim);
  }
  .footer {
    margin-top: 6px;
    padding: 10px 8px 4px;
    border-top: 1px solid var(--border);
  }
</style>
