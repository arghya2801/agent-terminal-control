<script lang="ts" module>
  export interface MenuItem {
    value: string;
    label: string;
    description?: string;
    /** Faint text at the row's end, such as a version. */
    badge?: string;
    /** Alternatives behind the row's arrow, such as a family's older versions. */
    sub?: MenuItem[];
  }
  export interface MenuSection {
    title?: string;
    /** Draws beside the title, e.g. a provider icon. */
    icon?: import('svelte').Snippet;
    items: MenuItem[];
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  /** A chip in the composer's toolbar that opens a panel above it: sections of choices,
   *  the current one checked, rows that open a flyout of alternatives, and an optional
   *  footer for settings that go with them. */
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
  /** The row whose flyout is open. */
  let flyout = $state<string | null>(null);
  let root = $state<HTMLDivElement>();
  let panel = $state<HTMLDivElement>();

  $effect(() => {
    if (!open) return;
    flyout = null;
    queueMicrotask(() => ((panel?.querySelector('[aria-checked="true"]') as HTMLElement | null) ?? panel?.querySelector('button'))?.focus());
    const away = (e: PointerEvent) => {
      if (!root?.contains(e.target as Node)) open = false;
    };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  });

  const holds = (it: MenuItem) => it.value === value || !!it.sub?.some((s) => s.value === value);
  /** Which older version is in use, shown on its family's row. */
  const inUse = (it: MenuItem) => it.sub?.find((s) => s.value === value)?.badge;

  function choose(v: string) {
    onPick(v);
    open = false;
  }
  /** The flyout opens to the left when the right has no room for it. */
  let leftward = $state(false);
  function toggle(it: MenuItem) {
    flyout = flyout === it.value ? null : it.value;
    const box = panel?.getBoundingClientRect();
    leftward = !!box && box.right + 280 > document.documentElement.clientWidth;
    if (flyout) queueMicrotask(() => (panel?.querySelector('.flyout button') as HTMLElement | null)?.focus());
  }
  function onKey(e: KeyboardEvent) {
    const row = (document.activeElement as HTMLElement | null)?.closest('.row');
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (flyout) {
        flyout = null;
        (row?.querySelector('.arrow') as HTMLElement | null)?.focus();
      } else {
        open = false;
        (root?.querySelector('.chip') as HTMLElement | null)?.focus();
      }
    } else if (e.key === 'ArrowRight' && row?.querySelector('.arrow') && !flyout) {
      e.preventDefault();
      (row.querySelector('.arrow') as HTMLElement).click();
    } else if (e.key === 'ArrowLeft' && flyout) {
      e.preventDefault();
      flyout = null;
      (row?.querySelector('.arrow') as HTMLElement | null)?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const scope = flyout ? panel?.querySelector('.flyout') : panel;
      const buttons = [...(scope?.querySelectorAll<HTMLElement>(flyout ? 'button' : '.item, .seg button') ?? [])];
      const at = buttons.indexOf(document.activeElement as HTMLElement);
      buttons[(at + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }
  }
</script>

{#snippet entry(it: MenuItem, badge?: string)}
  <span class="text"><span class="name">{it.label}</span>{#if it.description}<span class="desc">{it.description}</span>{/if}</span>
  {#if badge}<span class="badge">{badge}</span>{/if}
  <span class="check" class:on={holds(it)} aria-hidden="true">✓</span>
{/snippet}

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
        {#each s.items as it (it.value)}
          <div class="row" class:open={flyout === it.value}>
            <button class="item" role="menuitemradio" aria-checked={holds(it)} onclick={() => choose(it.value)} onmouseenter={() => flyout && flyout !== it.value && (flyout = null)}>
              {@render entry(it, inUse(it) ?? it.badge)}
            </button>
            {#if it.sub?.length}
              <button class="arrow" aria-label="Older {it.label} versions" aria-expanded={flyout === it.value} title="Older versions" onclick={() => toggle(it)}>›</button>
            {:else if s.items.some((x) => x.sub?.length)}
              <span class="arrow-space"></span>
            {/if}
            {#if flyout === it.value && it.sub}
              <div class="flyout" class:leftward role="menu" aria-label="Older {it.label} versions">
                <div class="head"><span>Older {it.label}</span></div>
                {#each it.sub as x (x.value)}
                  <button class="item" role="menuitemradio" aria-checked={x.value === value} onclick={() => choose(x.value)}>{@render entry(x)}</button>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
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
  .panel,
  .flyout {
    padding: 4px;
    background: var(--bg-chrome);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--shadow-pop);
  }
  .panel {
    position: absolute;
    left: -4px;
    bottom: calc(100% + 8px);
    z-index: 3;
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
    gap: 6px;
    padding: 5px 8px 3px;
    font-size: 11px;
    font-weight: 600;
    color: var(--fg-faint);
  }
  .head:not(:first-child) {
    margin-top: 3px;
    border-top: 1px solid var(--border);
    padding-top: 7px;
  }
  .row {
    position: relative;
    display: flex;
    align-items: stretch;
    gap: 2px;
  }
  .item {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    padding: 4px 8px;
    border-radius: 6px;
    cursor: pointer;
  }
  .flyout .item {
    width: 100%;
  }
  .item:hover,
  .item:focus-visible,
  .arrow:hover,
  .arrow:focus-visible,
  .row.open .arrow {
    background: var(--bg-hover);
    outline: none;
  }
  .item[aria-checked='true'] {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .arrow {
    all: unset;
    display: grid;
    place-items: center;
    width: 22px;
    flex: none;
    border-radius: 6px;
    font-size: 14px;
    color: var(--fg-faint);
    cursor: pointer;
  }
  .arrow:hover,
  .row.open .arrow {
    color: var(--fg-bright);
  }
  /* Keeps versions lined up on rows with nothing older. */
  .arrow-space {
    width: 22px;
    flex: none;
  }
  .flyout {
    position: absolute;
    left: calc(100% + 8px);
    top: -4px;
    width: 280px;
    z-index: 4;
    animation: slide var(--enter) var(--ease-out);
  }
  .flyout.leftward {
    left: auto;
    right: calc(100% + 32px);
  }
  @keyframes slide {
    from {
      opacity: 0;
      transform: translateX(-4px);
    }
  }
  /* One line per choice: the name, then what it is for, cut to fit. */
  .text {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }
  .name {
    flex: none;
    font-size: 12.5px;
    color: var(--fg-bright);
  }
  .desc {
    min-width: 0;
    font-size: 11.5px;
    color: var(--fg-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    font-size: 11px;
    color: var(--fg-faint);
    font-variant-numeric: tabular-nums;
  }
  .check {
    color: var(--accent);
    font-size: 12px;
    visibility: hidden;
  }
  .check.on {
    visibility: visible;
  }
  .footer {
    margin-top: 4px;
    padding: 7px 8px 3px;
    border-top: 1px solid var(--border);
  }
</style>
