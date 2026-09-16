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
    scrollbar-color: #30363d transparent;
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
    color: #e6edf3;
    font-size: 15px;
    font-weight: 600;
  }
  .close {
    border: none;
    background: transparent;
    color: #8b949e;
    font-size: 20px;
    cursor: pointer;
  }
  .close:hover {
    color: #e6edf3;
  }
  .body {
    max-width: 880px;
    padding: 4px 24px 40px;
  }
  .body :global(h2) {
    margin: 22px 0 10px;
    color: #8b949e;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .body :global(.muted) {
    color: #6e7681;
    font-size: 12px;
  }
  .body :global(.err) {
    color: #f47067;
    font-size: 12px;
  }
  .body :global(button.btn) {
    padding: 5px 12px;
    border: 1px solid #30363d;
    border-radius: 6px;
    background: #21262d;
    color: #c9d1d9;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .body :global(button.btn:hover:not(:disabled)) {
    border-color: #539bf5;
  }
  .body :global(button.btn:disabled) {
    opacity: 0.6;
    cursor: default;
  }
  .body :global(button.btn.primary) {
    border-color: #1f6feb;
    background: #1f6feb;
    color: #fff;
  }
  .body :global(input) {
    padding: 5px 8px;
    border: 1px solid #30363d;
    border-radius: 6px;
    background: #0d1117;
    color: #e6edf3;
    font: inherit;
    font-size: 12px;
    color-scheme: dark;
  }
  .body :global(input:focus) {
    border-color: #539bf5;
    outline: none;
  }
</style>
