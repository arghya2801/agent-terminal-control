<script lang="ts">
  import { onMount, type Snippet } from 'svelte';

  /** Modal yes/no over the whole window. Enter confirms, Esc cancels. */
  let {
    confirmLabel,
    onConfirm,
    onCancel,
    children,
  }: {
    confirmLabel: string;
    onConfirm: () => void;
    onCancel: () => void;
    children: Snippet;
  } = $props();

  let confirmButton: HTMLButtonElement;

  onMount(() => {
    // Take focus from the terminal, or Enter would go to the shell.
    confirmButton.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      // Handled here rather than by the focused button's native Enter, so one press is
      // one action, and a page underneath does not also close on Esc.
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Enter') onConfirm();
      else onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
</script>

<div class="backdrop" role="presentation" onclick={onCancel}>
  <div
    class="dialog"
    role="alertdialog"
    aria-modal="true"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={() => {}}
  >
    <div class="message">{@render children()}</div>
    <div class="actions">
      <button class="cancel" onclick={onCancel}>Cancel <kbd>Esc</kbd></button>
      <button class="confirm" bind:this={confirmButton} onclick={onConfirm}>
        {confirmLabel} <kbd>Enter</kbd>
      </button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    background: rgba(1, 4, 9, 0.6);
  }
  .dialog {
    width: min(420px, calc(100vw - 32px));
    padding: 18px 20px 16px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-chrome);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  }
  .message {
    color: var(--fg);
    font-size: 13px;
    line-height: 1.5;
  }
  .message :global(strong) {
    color: var(--fg-bright);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
  button {
    padding: 5px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-surface);
    color: var(--fg);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  button:hover {
    border-color: var(--accent);
  }
  .confirm {
    border-color: var(--danger-strong);
    background: var(--danger-strong);
    color: var(--on-accent);
  }
  .confirm:hover,
  .confirm:focus-visible {
    border-color: var(--danger);
    background: var(--danger);
    outline: none;
  }
  kbd {
    margin-left: 4px;
    opacity: 0.6;
    font: inherit;
    font-size: 10px;
  }
</style>
