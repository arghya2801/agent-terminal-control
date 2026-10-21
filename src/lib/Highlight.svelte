<script lang="ts">
  import { splitMatches } from './filter';

  /** `text` with each match of the sidebar filter marked. */
  let { text, query }: { text: string; query: string } = $props();
  const parts = $derived(splitMatches(text, query));
</script>

{#each parts as part, i (i)}{#if i % 2}<mark>{part}</mark>{:else}{part}{/if}{/each}

<style>
  mark {
    border-radius: 2px;
    background: color-mix(in srgb, var(--accent) 30%, transparent);
    color: inherit;
  }
</style>
