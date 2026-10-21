<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { enterMs } from './stores.svelte';

  /**
   * A long page with a list of its sections beside it: a click jumps to one, and the
   * list follows the scroll. Each section starts with an element carrying its `id`.
   */
  let { sections, children }: { sections: { id: string; label: string }[]; children: Snippet } = $props();

  let nav: HTMLElement;
  let active = $state('');

  function go(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: enterMs() ? 'smooth' : 'auto', block: 'start' });
  }

  onMount(() => {
    const scroller = nav.closest('.page');
    if (!scroller) return;
    const update = () => {
      const top = scroller.getBoundingClientRect().top + 90;
      const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      let current = sections[0]?.id ?? '';
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el && (el.getBoundingClientRect().top <= top || atEnd)) current = s.id;
      }
      active = current;
    };
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    return () => scroller.removeEventListener('scroll', update);
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
  <div class="content">
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
  /* Clear of the sticky header when jumped to. */
  .content :global([id]) {
    scroll-margin-top: 64px;
  }
</style>
