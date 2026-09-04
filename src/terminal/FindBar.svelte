<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
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
    ↑
  </button>
  <button onclick={() => search(1)} title="Next (Enter)" aria-label="Next match">↓</button>
  <button onclick={close} title="Close (Esc)" aria-label="Close find">×</button>
</div>

<style>
  .find {
    position: absolute;
    top: 8px;
    right: 18px;
    z-index: 12;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 6px 5px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: rgba(22, 27, 34, 0.97);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
  }
  input {
    width: 200px;
    border: none;
    background: transparent;
    color: #e6edf3;
    font: inherit;
    font-size: 12px;
    outline: none;
  }
  .count {
    min-width: 48px;
    color: #6e7681;
    font-size: 11px;
    text-align: right;
  }
  .count.none {
    color: #e5534b;
  }
  button {
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: #8b949e;
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
  }
  button:hover {
    background: #30363d;
    color: #e6edf3;
  }
</style>
