<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { enterMs } from './stores.svelte';

  /**
   * A long page with a list of its sections beside it: a click jumps to one, and the
   * list follows the scroll. Each section starts with an element carrying its `id`.
   */
  let { sections, children }: { sections: { id: string; label: string }[]; children: Snippet } = $props();

  /** Where a heading counts as reached, below the page's sticky header. */
  const LINE = 90;
  let nav: HTMLElement;
  let content: HTMLElement;
  let active = $state('');
  /** Room after the last section, so even a short one can scroll up to the line. */
  let tail = $state(0);
  /** Set while a click's scroll runs, so the list does not flick through what it passes. */
  let jumping = false;

  function go(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    active = id;
    jumping = true;
    el.scrollIntoView({ behavior: enterMs() ? 'smooth' : 'auto', block: 'start' });
  }

  onMount(() => {
    const scroller = nav.closest<HTMLElement>('.page');
    if (!scroller) return;
    const update = () => {
      if (jumping) return;
      const line = scroller.getBoundingClientRect().top + LINE;
      let current = sections[0]?.id ?? '';
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= line + 1) current = s.id;
      }
      active = current;
    };
    const measure = () => {
      const last = document.getElementById(sections[sections.length - 1]?.id ?? '');
      if (!last) return;
      const below = content.getBoundingClientRect().bottom - tail - last.getBoundingClientRect().top;
      tail = Math.max(0, scroller.clientHeight - LINE - below);
    };
    const settle = () => {
      jumping = false;
      update();
    };
    const resize = new ResizeObserver(() => {
      measure();
      update();
    });
    resize.observe(content);
    resize.observe(scroller);
    scroller.addEventListener('scroll', update, { passive: true });
    scroller.addEventListener('scrollend', settle);
    // A jump to where the page already is never scrolls, so never ends.
    scroller.addEventListener('pointerdown', settle);
    scroller.addEventListener('wheel', settle, { passive: true });
    scroller.addEventListener('keydown', settle);
    return () => {
      resize.disconnect();
      scroller.removeEventListener('scroll', update);
      scroller.removeEventListener('scrollend', settle);
      scroller.removeEventListener('pointerdown', settle);
      scroller.removeEventListener('wheel', settle);
      scroller.removeEventListener('keydown', settle);
    };
  });
</script>

<div class="layout">
  <nav bind:this={nav} aria-label="Sections">
    {#each sections as s (s.id)}
      <button class:on={active === s.id} aria-current={active === s.id ? 'location' : undefined} onclick={() => go(s.id)}>
        {s.label}
      </button>
    {/each}
  </nav>
  <div class="content" bind:this={content} style="padding-bottom: {tail}px">
    {@render children()}
  </div>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr);
    gap: 32px;
  }
  /* Below the page's sticky header. */
  nav {
    position: sticky;
    top: 70px;
    display: flex;
    flex-direction: column;
    align-self: start;
    gap: 2px;
    margin-top: 18px;
  }
  button {
    padding: 6px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--fg-dim);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }
  button:hover {
    background: var(--bg-hover);
    color: var(--fg);
  }
  button.on {
    background: color-mix(in srgb, var(--accent-strong) 16%, transparent);
    box-shadow: inset 2px 0 0 var(--accent);
    color: var(--fg-bright);
  }
  /* Lands on the same line the list reads from. */
  .content :global([id]) {
    scroll-margin-top: 80px;
  }
</style>
