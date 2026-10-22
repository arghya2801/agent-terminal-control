<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { splitChord } from './tooltip';
  import { pageZoom } from './desktop';

  /**
   * One tooltip for the whole app, in place of the browser's slow native one. Any element
   * with a `title` gets it: the title moves to `data-tip` on first hover, so the native
   * tooltip never appears. Mounted once, in App.
   */
  const DELAY = 300;
  /** Within this long of one closing, the next opens at once, so sweeping along a row is quick. */
  const WARM = 500;

  let tip = $state<{ text: string; chord: string | null; left: number; top: number } | null>(null);
  let el = $state<HTMLDivElement>();
  let target: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closedAt = 0;
  /** Pressed: no tooltip until the pointer leaves it, or it would sit over the menu it opened. */
  let pressed: HTMLElement | null = null;

  function claim(node: HTMLElement): string | null {
    const title = node.getAttribute('title');
    if (title) {
      // The title may be the element's only accessible name.
      if (!node.hasAttribute('aria-label') && !node.textContent?.trim()) node.setAttribute('aria-label', title);
      node.dataset.tip = title;
      node.removeAttribute('title');
    }
    return node.dataset.tip || null;
  }

  function hide() {
    clearTimeout(timer);
    if (tip) closedAt = Date.now();
    tip = null;
    target = null;
  }

  async function show(node: HTMLElement) {
    const text = claim(node);
    if (!text || !node.isConnected) return;
    const r = node.getBoundingClientRect();
    // Measured at the left edge, where it has room for its full width; placed below.
    // Everything is in on-screen pixels until the style divides by the page zoom.
    tip = { ...splitChord(text), left: 0, top: r.bottom };
    await tick();
    if (!el || target !== node) return;
    const { width: w, height: h } = el.getBoundingClientRect();
    const side = node.closest<HTMLElement>('[data-tip-side]')?.dataset.tipSide;
    let left: number;
    let top: number;
    if (side === 'right') {
      left = r.right + 8;
      top = r.top + r.height / 2 - h / 2;
    } else {
      left = r.left + r.width / 2 - w / 2;
      top = r.bottom + 6 + h > innerHeight - 8 ? r.top - 6 - h : r.bottom + 6;
    }
    tip = { ...tip!, left: Math.max(8, Math.min(left, innerWidth - w - 8)), top: Math.max(8, top) };
  }

  function arm(node: HTMLElement) {
    if (node === target) return;
    hide();
    target = node;
    claim(node);
    timer = setTimeout(() => void show(node), Date.now() - closedAt < WARM ? 0 : DELAY);
  }

  onMount(() => {
    const over = (e: Event) => {
      const node = (e.target as Element).closest<HTMLElement>('[title], [data-tip]');
      if (node !== pressed) pressed = null;
      if (node && node !== pressed) arm(node);
      else if (target) hide();
    };
    const focus = (e: FocusEvent) => {
      const node = e.target as HTMLElement;
      if (node.matches?.(':focus-visible') && (node.title || node.dataset.tip)) arm(node);
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('focusin', focus);
    const down = (e: Event) => {
      pressed = (e.target as Element).closest<HTMLElement>('[title], [data-tip]');
      hide();
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', hide, true);
    document.addEventListener('focusout', hide);
    window.addEventListener('blur', hide);
    document.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('pointerover', over);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', hide, true);
      document.removeEventListener('focusout', hide);
      window.removeEventListener('blur', hide);
      document.removeEventListener('scroll', hide, true);
    };
  });
</script>

{#if tip}
  <div class="tip" role="tooltip" bind:this={el} style="left: {tip.left / pageZoom()}px; top: {tip.top / pageZoom()}px">
    <span>{tip.text}</span>{#if tip.chord}<kbd>{tip.chord}</kbd>{/if}
  </div>
{/if}

<style>
  .tip {
    position: fixed;
    z-index: 100;
    display: flex;
    max-width: 320px;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-chrome);
    box-shadow: var(--shadow-pop);
    color: var(--fg);
    font-size: 12px;
    line-height: 1.4;
    white-space: pre-line;
    pointer-events: none;
    animation: atc-fade var(--fast) var(--ease-out);
  }
  kbd {
    flex-shrink: 0;
    padding: 0 5px;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 4px;
    background: var(--bg-surface);
    color: var(--fg-dim);
    font: inherit;
    font-size: 11px;
    white-space: nowrap;
  }
</style>
