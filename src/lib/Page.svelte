<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { focusActiveTerminal } from '../terminal/manager';
  import Icon from './Icon.svelte';

  /**
   * Full-pane overlay above the terminals, which stay mounted underneath. `modal` makes
   * it a popup over the whole dimmed app instead, closed by Esc or a click outside; the
   * app marks everything behind it inert.
   */
  let {
    title,
    modal = false,
    wide = false,
    actions,
    onClose,
    children,
  }: {
    title: string;
    modal?: boolean;
    wide?: boolean;
    /** Buttons in the header, beside Close, so they stay in view while the page scrolls. */
    actions?: Snippet;
    onClose: () => void;
    children: Snippet;
  } = $props();

  let root: HTMLDivElement;

  onMount(() => {
    // Take focus from the terminal: xterm stops Escape from propagating, so with focus
    // left there the listener below never saw it (#105).
    root.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Next task: behind a popup the terminal is still inert during this one.
      setTimeout(focusActiveTerminal);
    };
  });
</script>

{#snippet sheet()}
  <div
    class="page"
    class:modal
    tabindex="-1"
    bind:this={root}
    role={modal ? 'dialog' : undefined}
    aria-modal={modal || undefined}
    aria-label={title}
  >
    <header>
      <h1>{title}</h1>
      <div class="head-actions">
        {@render actions?.()}
        <button class="close" onclick={onClose} aria-label="Close" title="Close (Esc)"><Icon name="close" /></button>
      </div>
    </header>
    <div class="body" class:wide>
      {@render children()}
    </div>
  </div>
{/snippet}

{#if modal}
  <div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
    {@render sheet()}
  </div>
{:else}
  {@render sheet()}
{/if}

<style>
  .page {
    position: absolute;
    inset: 34px 0 0 0;
    z-index: 20;
    overflow-y: auto;
    background: var(--bg);
    outline: none;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    animation: atc-fade var(--enter) var(--ease-out);
  }
  .page.modal {
    position: relative;
    inset: auto;
    width: min(920px, calc(100vw - 48px));
    height: min(680px, calc(100vh - 48px));
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--shadow-pop);
    animation: atc-pop var(--enter) var(--ease-out);
  }
  /* The sheet already pops in; its content rising too would be two motions at once. */
  .modal .body {
    animation: none;
  }
  header {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 24px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }
  h1 {
    margin: 0;
    color: var(--fg-bright);
    font-size: 15px;
    font-weight: 600;
  }
  .close {
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--fg-dim);
    cursor: pointer;
  }
  .close:hover {
    background: var(--bg-hover);
    color: var(--fg-bright);
  }
  .body {
    animation: atc-rise var(--enter) var(--ease-out);
    max-width: 880px;
    padding: 4px 24px 40px;
  }
  /* Room for a section list beside content that wants the full 880px. */
  .body.wide {
    max-width: 1100px;
  }
  .body :global(h2) {
    margin: 24px 0 10px;
    color: var(--fg-bright);
    font-size: 13px;
    font-weight: 600;
  }
  .page :global(.muted) {
    color: var(--fg-faint);
    font-size: 12px;
  }
  .body :global(.err) {
    color: var(--danger);
    font-size: 12px;
  }
  .page :global(button.btn) {
    padding: 5px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-surface);
    color: var(--fg);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .page :global(button.btn:hover:not(:disabled)) {
    border-color: var(--accent);
  }
  .page :global(button.btn:disabled) {
    opacity: 0.6;
    cursor: default;
  }
  .head-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .page :global(button.btn.primary) {
    border-color: var(--accent-strong);
    background: var(--accent-strong);
    color: var(--on-accent);
  }
  .body :global(input),
  .body :global(select),
  .body :global(textarea) {
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg-bright);
    font: inherit;
    font-size: 12px;
  }
  .body :global(input:focus),
  .body :global(select:focus),
  .body :global(textarea:focus) {
    border-color: var(--accent);
    outline: none;
  }
  .body :global(select) {
    cursor: pointer;
  }
</style>
