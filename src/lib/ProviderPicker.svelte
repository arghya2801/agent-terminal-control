<script lang="ts">
  import { onMount } from 'svelte';
  import type { AgentProvider } from '../types';
  import ProviderIcon from './ProviderIcon.svelte';
  let { onPick, onCancel }: { onPick: (provider: AgentProvider) => void; onCancel: () => void } = $props();
  let dialog: HTMLDialogElement;
  onMount(() => {
    dialog.showModal();
    return () => dialog.close();
  });
  function cancel() { dialog.close(); onCancel(); }
  function choose(provider: AgentProvider) { dialog.close(); onPick(provider); }
</script>

<dialog bind:this={dialog} oncancel={(e) => { e.preventDefault(); cancel(); }} aria-labelledby="provider-title">
  <h2 id="provider-title">Choose an agent</h2>
  <div class="choices">
    <button onclick={() => choose('claude')}><ProviderIcon provider="claude" /> Claude</button>
    <button onclick={() => choose('codex')}><ProviderIcon provider="codex" /> Codex</button>
  </div>
  <button class="cancel" onclick={cancel}>Cancel</button>
</dialog>

<style>
  dialog { color: var(--fg); background: var(--bg-chrome); border: 1px solid var(--border); border-radius: 10px; padding: 20px; }
  dialog::backdrop { background: #0008; }
  h2 { margin: 0 0 16px; font-size: 16px; }
  .choices { display: flex; gap: 12px; }
  button { padding: 10px 20px; color: var(--fg); background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--accent); }
  .cancel { margin-top: 16px; }
</style>
