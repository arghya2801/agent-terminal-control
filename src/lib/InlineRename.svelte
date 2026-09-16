<script lang="ts">
  import { onMount } from 'svelte';

  /** Enter or blur saves, Escape cancels. An empty value is passed through as ''. */
  let {
    value,
    onDone,
    onCancel,
  }: { value: string; onDone: (name: string) => void; onCancel: () => void } = $props();

  let el: HTMLInputElement;
  let settled = false;

  function finish(save: boolean) {
    if (settled) return;
    settled = true;
    if (save) onDone(el.value.trim());
    else onCancel();
  }

  onMount(() => {
    el.focus();
    el.select();
  });
</script>

<input
  bind:this={el}
  {value}
  class="rename"
  spellcheck="false"
  onclick={(e) => e.stopPropagation()}
  ondblclick={(e) => e.stopPropagation()}
  onkeydown={(e) => {
    // Keep app chords and the terminal from seeing keys typed into the box.
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  }}
  onblur={() => finish(true)}
/>

<style>
  .rename {
    min-width: 0;
    flex: 1;
    padding: 1px 4px;
    border: 1px solid #539bf5;
    border-radius: 4px;
    outline: none;
    background: #0d1117;
    color: #e6edf3;
    font: inherit;
    font-size: 12px;
  }
</style>
