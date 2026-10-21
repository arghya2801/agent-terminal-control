<script lang="ts" module>
  import type { IconName } from './Icon.svelte';

  export interface Command {
    id: string;
    label: string;
    /** Second line: a path, a project, or what kind of thing it is. */
    detail?: string;
    icon: IconName;
    chord?: string;
    run: () => void;
  }
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import Highlight from './Highlight.svelte';
  import { fuzzyScore } from './fuzzy';

  /** `commands` is everything; `initial` is what an empty box shows, in order. */
  let { commands, initial, onClose }: { commands: Command[]; initial: Command[]; onClose: () => void } = $props();

  const LIMIT = 60;
  let dialog: HTMLDialogElement;
  let list = $state<HTMLElement>();
  let query = $state('');
  let index = $state(0);

  const results = $derived.by(() => {
    if (!query.trim()) return initial;
    return commands
      .flatMap((c) => {
        // The label counts for more than the detail line.
        const score = Math.max(fuzzyScore(c.label, query) ?? -1, (fuzzyScore(c.detail ?? '', query) ?? -1) - 200);
        return score >= 0 ? [{ c, score }] : [];
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, LIMIT)
      .map((r) => r.c);
  });

  $effect(() => {
    void results;
    index = 0;
  });

  onMount(() => {
    dialog.showModal();
    return () => dialog.close();
  });

  /** Closed first: that hands focus back to where it was, before the command moves it. */
  function run(c: Command | undefined) {
    if (!c) return;
    dialog.close();
    onClose();
    c.run();
  }

  async function move(by: number) {
    if (!results.length) return;
    index = (index + by + results.length) % results.length;
    await tick();
    list?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  function onKey(e: KeyboardEvent) {
    // Keep app chords and the terminal from seeing what is typed here.
    e.stopPropagation();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      void move(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(results[index]);
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialog}
  aria-label="Command palette"
  oncancel={(e) => { e.preventDefault(); onClose(); }}
  onclick={(e) => { if (e.target === dialog) onClose(); }}
>
  <div class="field">
    <Icon name="search" size={14} />
    <!-- svelte-ignore a11y_autofocus -->
    <input
      autofocus
      bind:value={query}
      onkeydown={onKey}
      placeholder="Run a command, or go to a tab, project or session"
      spellcheck="false"
      role="combobox"
      aria-expanded="true"
      aria-controls="palette-list"
      aria-activedescendant={results.length ? `palette-${index}` : undefined}
    />
  </div>
  <div class="list" id="palette-list" role="listbox" bind:this={list}>
    {#each results as c, i (c.id)}
      <div
        id="palette-{i}"
        class="row"
        role="option"
        tabindex="-1"
        aria-selected={i === index}
        onmousemove={() => (index = i)}
        onclick={() => run(c)}
      >
        <span class="ic"><Icon name={c.icon} size={14} /></span>
        <span class="text">
          <span class="label"><Highlight text={c.label} {query} /></span>
          {#if c.detail}<span class="detail">{c.detail}</span>{/if}
        </span>
        {#if c.chord}<kbd>{c.chord}</kbd>{/if}
      </div>
    {:else}
      <p class="empty">Nothing matches “{query.trim()}”.</p>
    {/each}
  </div>
</dialog>

<style>
  dialog {
    width: min(560px, calc(100vw - 32px));
    max-width: none;
    margin: 10vh auto auto;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-chrome);
    color: var(--fg);
    box-shadow: var(--shadow-pop);
    animation: atc-pop var(--enter) var(--ease-out);
    transform-origin: top center;
  }
  dialog::backdrop {
    background: color-mix(in srgb, var(--bg) 45%, transparent);
    animation: atc-fade var(--enter) var(--ease-out);
  }
  .field {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
    color: var(--fg-faint);
  }
  input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: var(--fg-bright);
    font: inherit;
    font-size: 14px;
    outline: none;
  }
  .list {
    max-height: min(420px, 60vh);
    overflow-y: auto;
    padding: 6px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-radius: 6px;
    cursor: pointer;
  }
  .row[aria-selected='true'] {
    background: color-mix(in srgb, var(--accent-strong) 18%, transparent);
    color: var(--fg-bright);
  }
  .ic {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    color: var(--fg-faint);
  }
  .row[aria-selected='true'] .ic {
    color: var(--accent);
  }
  .text {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
  }
  .label,
  .detail {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .label {
    font-size: 13px;
  }
  .detail {
    color: var(--fg-faint);
    font-size: 11px;
  }
  kbd {
    flex-shrink: 0;
    padding: 0 5px;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 4px;
    background: var(--bg-surface);
    color: var(--fg-dim);
    font: inherit;
    font-size: 11px;
  }
  .empty {
    margin: 0;
    padding: 14px 10px;
    color: var(--fg-faint);
    font-size: 12px;
  }
</style>
