<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import Icon from '../lib/Icon.svelte';
  import { formatMatches } from '../lib/format';
  import {
    clearFind,
    findInActiveTab,
    focusActiveTerminal,
    onFindResults,
  } from './manager';

  let { onClose }: { onClose: () => void } = $props();

  let input: HTMLInputElement;
  let query = $state('');
  let index = $state(-1);
  let count = $state(0);

  const label = $derived(formatMatches(index, count, query));

  function search(direction: 1 | -1) {
    findInActiveTab(query, direction);
  }

  function close() {
    clearFind();
    onClose();
    // Hand the keyboard straight back to the shell rather than leaving focus adrift.
    focusActiveTerminal();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      search(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    // Everything else stays in the input; the terminal must not see it.
    e.stopPropagation();
  }

  onMount(() => {
    const off = onFindResults((r) => {
      index = r.index;
      count = r.count;
    });
    void tick().then(() => input?.focus());
    return off;
  });

  onDestroy(clearFind);
</script>

<div class="find">
  <input
    bind:this={input}
    bind:value={query}
    oninput={() => search(1)}
    onkeydown={onKey}
    placeholder="Find in terminal"
    spellcheck="false"
    aria-label="Find in terminal"
  />
  <span class="count" class:none={!!query && count === 0}>{label}</span>
  <button onclick={() => search(-1)} title="Previous (Shift+Enter)" aria-label="Previous match">
    <Icon name="up" size={14} />
  </button>
  <button onclick={() => search(1)} title="Next (Enter)" aria-label="Next match"><Icon name="down" size={14} /></button>
  <button onclick={close} title="Close (Esc)" aria-label="Close find"><Icon name="close" size={14} /></button>
</div>

<style>
  .find {
    position: absolute;
    top: 8px;
    right: 18px;
    z-index: 12;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 6px 5px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-chrome);
    box-shadow: var(--shadow-pop);
    animation: atc-rise var(--enter) var(--ease-out);
  }
  .find:focus-within {
    border-color: color-mix(in srgb, var(--accent) 60%, var(--border));
  }
  input {
    width: 200px;
    border: none;
    background: transparent;
    color: var(--fg-bright);
    font: inherit;
    font-size: 12px;
    outline: none;
  }
  .count {
    min-width: 48px;
    margin-right: 2px;
    color: var(--fg-faint);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .count.none {
    color: var(--danger-strong);
  }
  button {
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--fg-dim);
    cursor: pointer;
  }
  button:hover {
    background: var(--bg-hover);
    color: var(--fg-bright);
  }
</style>
