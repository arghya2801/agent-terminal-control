<script lang="ts">
  import { tokens } from './highlight';

  let { text, lang }: { text: string; lang: string | null | undefined } = $props();
</script>

{#each tokens(text, lang) as t}{#if t.kind}<span class="tk-{t.kind}">{t.text}</span>{:else}{t.text}{/if}{/each}

<style>
  .tk-comment {
    color: var(--fg-faint);
    font-style: italic;
  }
  .tk-string {
    color: var(--ok);
  }
  .tk-number {
    color: var(--warn);
  }
  .tk-keyword {
    color: var(--accent);
  }
</style>
