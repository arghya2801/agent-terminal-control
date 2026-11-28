<script lang="ts" module>
  import type { IconName } from './Icon.svelte';

  export interface Command {
    id: string;
    label: string;
    /** Second line: a path, a project, or what kind of thing it is. */
    detail?: string;
    icon: IconName;
    chord?: string;
    /** Swatches shown at the right, as the theme picker does. */
    colours?: string[];
    /** A heading the row sits under; rows keep the order their groups first appear in. */
    group?: string;
    /** Buttons at the right of the row; Left and Right pick one, Enter runs it. */
    actions?: CommandAction[];
    run: () => void;
  }

  export interface CommandAction {
    label: string;
    /** A character, or an icon when there is none. */
    glyph?: string;
    icon?: IconName;
    colour: string;
    run: () => void;
  }
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import Highlight from './Highlight.svelte';
  import { fuzzyScore } from './fuzzy';

  /**
   * `commands` is everything; `initial` is what an empty box shows, in order, with `start`
   * selected. `onHighlight` hears every row selected, for a live preview, and `onCancel`
   * hears Esc or a click outside, so a preview can be undone.
   */
  let {
    commands,
    initial,
    onClose,
    start = 0,
    placeholder = 'Run a command, or go to a tab, project or session',
    label = 'Command palette',
    onHighlight,
    onCancel,
  }: {
    commands: Command[];
    initial: Command[];
    onClose: () => void;
    start?: number;
    placeholder?: string;
    label?: string;
    onHighlight?: (c: Command) => void;
    onCancel?: () => void;
  } = $props();

  const LIMIT = 60;
  let dialog: HTMLDialogElement;
  let list = $state<HTMLElement>();
  let query = $state('');
  let index = $state(0);
  /** The selected row's chosen action. */
  let act = $state(0);

  const results = $derived.by(() => {
    if (!query.trim()) return initial;
    return commands
      .flatMap((c) => {
        // The label counts for more than the detail line.
        const score = Math.max(fuzzyScore(c.label, query) ?? -1, (fuzzyScore(c.detail ?? '', query) ?? -1) - 200);
        return score >= 0 ? [{ c, score }] : [];
      })
      .sort((a, b) => groupOrder(a.c) - groupOrder(b.c) || b.score - a.score)
      .slice(0, LIMIT)
      .map((r) => r.c);
  });
  const groups = $derived([...new Set(commands.map((c) => c.group))]);
  const groupOrder = (c: Command) => groups.indexOf(c.group);

  $effect(() => {
    index = query.trim() || !results.length ? 0 : Math.min(start, results.length - 1);
    act = 0;
    void tick().then(() => list?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
  });

  $effect(() => {
    const c = results[index];
    if (c && onHighlight) onHighlight(c);
  });

  function cancel() {
    onCancel?.();
    onClose();
  }

  onMount(() => {
    dialog.showModal();
    return () => dialog.close();
  });

  /** Closed first: that hands focus back to where it was, before the command moves it. */
  function run(c: Command | undefined, a = c?.actions?.[act]) {
    if (!c) return;
    dialog.close();
    onClose();
    (a ?? c).run();
  }

  async function move(by: number) {
    if (!results.length) return;
    index = (index + by + results.length) % results.length;
    act = 0;
    await tick();
    list?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  function onKey(e: KeyboardEvent) {
    // Keep app chords and the terminal from seeing what is typed here.
    e.stopPropagation();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      void move(e.key === 'ArrowDown' ? 1 : -1);
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && results[index]?.actions) {
      e.preventDefault();
      const n = results[index].actions!.length;
      act = (act + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(results[index]);
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialog}
  aria-label={label}
  class:preview={!!onHighlight}
  oncancel={(e) => { e.preventDefault(); cancel(); }}
  onclick={(e) => { if (e.target === dialog) cancel(); }}
>
  <div class="field">
    <Icon name="search" size={14} />
    <!-- svelte-ignore a11y_autofocus -->
    <input
      autofocus
      bind:value={query}
      onkeydown={onKey}
      {placeholder}
      spellcheck="false"
      role="combobox"
      aria-expanded="true"
      aria-controls="palette-list"
      aria-activedescendant={results.length ? `palette-${index}` : undefined}
    />
  </div>
  <div class="list" id="palette-list" role="listbox" bind:this={list}>
    {#each results as c, i (c.id)}
      {#if c.group && c.group !== results[i - 1]?.group}<div class="group" role="presentation">{c.group}</div>{/if}
      <div
        id="palette-{i}"
        class="row"
        role="option"
        tabindex="-1"
        aria-selected={i === index}
        onmousemove={() => index !== i && ((index = i), (act = 0))}
        onclick={() => run(c)}
      >
        <span class="ic"><Icon name={c.icon} size={14} /></span>
        <span class="text">
          <span class="label"><Highlight text={c.label} {query} /></span>
          {#if c.detail}<span class="detail">{c.detail}</span>{/if}
        </span>
        {#if c.colours}<span class="swatches" aria-hidden="true">{#each c.colours as colour, j (j)}<span style:background={colour}></span>{/each}</span>{/if}
        {#if c.chord}<kbd>{c.chord}</kbd>{/if}
        {#each c.actions ?? [] as a, j (a.label)}
          <button
            class="act"
            class:on={i === index && j === act}
            style:--c={a.colour}
            tabindex="-1"
            title={a.label}
            aria-label="{a.label} in {c.label}"
            onclick={(e) => { e.stopPropagation(); run(c, a); }}
          >{#if a.glyph}{a.glyph}{:else if a.icon}<Icon name={a.icon} size={13} />{/if}</button>
        {/each}
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
    border-radius: calc(10px * var(--radius-scale, 1));
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
  /* Nothing dims a live preview. */
  dialog.preview::backdrop {
    background: transparent;
  }
  .swatches {
    display: flex;
    flex-shrink: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: calc(4px * var(--radius-scale, 1));
  }
  .swatches span {
    width: 12px;
    height: 12px;
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
    font-size: calc(14px * var(--ui-scale, 1));
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
    border-radius: calc(6px * var(--radius-scale, 1));
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
    font-size: calc(13px * var(--ui-scale, 1));
  }
  .detail {
    color: var(--fg-faint);
    font-size: calc(11px * var(--ui-scale, 1));
  }
  kbd {
    flex-shrink: 0;
    padding: 0 5px;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: calc(4px * var(--radius-scale, 1));
    background: var(--bg-surface);
    color: var(--fg-dim);
    font: inherit;
    font-size: calc(11px * var(--ui-scale, 1));
  }
  .act {
    display: grid;
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    place-items: center;
    padding: 0;
    border: 1px solid transparent;
    border-radius: calc(5px * var(--radius-scale, 1));
    background: transparent;
    color: var(--c);
    font: inherit;
    font-size: calc(14px * var(--ui-scale, 1));
    cursor: pointer;
  }
  .act:hover,
  .act.on {
    border-color: color-mix(in srgb, var(--c) 60%, transparent);
    background: color-mix(in srgb, var(--c) 18%, transparent);
  }
  .group {
    padding: 8px 10px 4px;
    color: var(--fg-faint);
    font-size: calc(11px * var(--ui-scale, 1));
  }
  .empty {
    margin: 0;
    padding: 14px 10px;
    color: var(--fg-faint);
    font-size: calc(12px * var(--ui-scale, 1));
  }
</style>
