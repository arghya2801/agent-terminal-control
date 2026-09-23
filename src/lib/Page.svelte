<script lang="ts">
  import { onMount, type Snippet } from 'svelte';

  /** Full-pane overlay above the terminals, which stay mounted underneath. */
  let { title, onClose, children }: { title: string; onClose: () => void; children: Snippet } =
    $props();

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<div class="page">
  <header>
    <h1>{title}</h1>
    <button class="close" onclick={onClose} aria-label="Close" title="Close (Esc)">×</button>
  </header>
  <div class="body">
    {@render children()}
  </div>
</div>

<style>
  .page {
    position: absolute;
    inset: 34px 0 0 0;
    z-index: 20;
    overflow-y: auto;
    background: var(--bg);
    scrollbar-color: var(--border) transparent;
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
    border: none;
    background: transparent;
    color: var(--fg-dim);
    font-size: 20px;
    cursor: pointer;
  }
  .close:hover {
    color: var(--fg-bright);
  }
  .body {
    max-width: 880px;
    padding: 4px 24px 40px;
  }
  .body :global(h2) {
    margin: 22px 0 10px;
    color: var(--fg-dim);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .body :global(.muted) {
    color: var(--fg-faint);
    font-size: 12px;
  }
  .body :global(.err) {
    color: var(--danger);
    font-size: 12px;
  }
  .body :global(button.btn) {
    padding: 5px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-surface);
    color: var(--fg);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .body :global(button.btn:hover:not(:disabled)) {
    border-color: var(--accent);
  }
  .body :global(button.btn:disabled) {
    opacity: 0.6;
    cursor: default;
  }
  .body :global(button.btn.primary) {
    border-color: var(--accent-strong);
    background: var(--accent-strong);
    color: var(--on-accent);
  }
  .body :global(input),
  .body :global(select) {
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg-bright);
    font: inherit;
    font-size: 12px;
  }
  .body :global(input:focus),
  .body :global(select:focus) {
    border-color: var(--accent);
    outline: none;
  }
  .body :global(select) {
    cursor: pointer;
  }
</style>
