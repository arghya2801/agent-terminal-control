<script lang="ts">
  import { onMount } from 'svelte';
  import type { AgentProvider } from '../types';
  import { providerName } from './agents';

  let {
    title,
    detail = null,
    onPick,
    onCancel,
  }: {
    /** What starts and where, e.g. "New agent in game_tracker_app". */
    title: string;
    /** The directory it starts in, shown under the title. */
    detail?: string | null;
    onPick: (provider: AgentProvider) => void;
    onCancel: () => void;
  } = $props();

  const PROVIDERS: AgentProvider[] = ['claude', 'codex'];
  let dialog: HTMLDialogElement;
  onMount(() => {
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('.choice')?.focus();
    return () => dialog.close();
  });
  function cancel() { dialog.close(); onCancel(); }
  function choose(provider: AgentProvider) { dialog.close(); onPick(provider); }

  function onKey(e: KeyboardEvent) {
    const n = Number(e.key);
    if (n >= 1 && n <= PROVIDERS.length) { e.preventDefault(); choose(PROVIDERS[n - 1]); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const rows = [...dialog.querySelectorAll<HTMLButtonElement>('.choice')];
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    rows[(i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]?.focus();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialog}
  aria-labelledby="picker-title"
  oncancel={(e) => { e.preventDefault(); cancel(); }}
  onkeydown={onKey}
  onclick={(e) => { if (e.target === dialog) cancel(); }}
>
  <div class="sheet">
    <header>
      <div class="where">
        <h2 id="picker-title">{title}</h2>
        {#if detail}<p title={detail}>{detail}</p>{/if}
      </div>
      <button class="esc" tabindex="-1" onclick={cancel} aria-label="Cancel" title="Cancel">Esc</button>
    </header>
    {#each PROVIDERS as provider, i (provider)}
      <button class="choice" onclick={() => choose(provider)}>
        <span class="glyph" aria-hidden="true">{provider === 'claude' ? '✳' : '⬡'}</span>
        <span class="name">{providerName(provider)}</span>
        <kbd>{i + 1}</kbd>
      </button>
    {/each}
  </div>
</dialog>

<style>
  dialog {
    width: min(360px, calc(100vw - 32px));
    max-width: none;
    margin: 12vh auto auto;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-chrome);
    color: var(--fg);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
  }
  dialog::backdrop {
    background: color-mix(in srgb, var(--bg) 55%, transparent);
  }
  .sheet {
    padding: 6px;
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 10px 10px 12px;
  }
  .where {
    flex: 1;
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--fg-bright);
  }
  p {
    margin: 3px 0 0;
    overflow: hidden;
    color: var(--fg-faint);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .esc,
  kbd {
    padding: 1px 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--fg-faint);
    font-family: inherit;
    font-size: 11px;
    line-height: 16px;
  }
  .esc {
    cursor: pointer;
  }
  .esc:hover,
  .esc:focus-visible {
    color: var(--fg);
    outline: none;
    border-color: var(--fg-faint);
  }
  .choice {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--fg);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }
  .choice:hover {
    background: var(--bg-hover);
  }
  .choice:focus {
    outline: none;
    background: color-mix(in srgb, var(--accent-strong) 16%, transparent);
    box-shadow: inset 2px 0 0 var(--accent);
    color: var(--fg-bright);
  }
  .glyph {
    width: 20px;
    color: var(--fg-dim);
    font-size: 18px;
    line-height: 1;
    text-align: center;
  }
  .choice:focus .glyph {
    color: var(--accent);
  }
  .name {
    flex: 1;
  }
</style>
