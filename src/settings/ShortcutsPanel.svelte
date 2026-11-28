<script lang="ts">
  import { onMount } from 'svelte';
  import Page from '../lib/Page.svelte';
  import Highlight from '../lib/Highlight.svelte';
  import { FIXED_SHORTCUTS, shortcutGroups } from '../lib/keymap';

  let { onClose }: { onClose: () => void } = $props();

  // Read once: the bindings are a module constant, not something that changes while the
  // page is open.
  const groups = shortcutGroups();
  let query = $state('');
  let input: HTMLInputElement;

  /** Matches the action's name or any of its chords, so "split" and "ctrl+shift+b" both work. */
  function filter<G extends { rows: { label: string; chords: string[] }[] }>(list: G[]): G[] {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.flatMap((g) => {
      const rows = g.rows.filter((r) => r.label.toLowerCase().includes(q) || r.chords.some((c) => c.toLowerCase().includes(q)));
      return rows.length ? [{ ...g, rows }] : [];
    });
  }
  const shown = $derived(filter(groups));
  const fixed = $derived(filter(FIXED_SHORTCUTS));

  // After Page has taken focus from the terminal.
  onMount(() => setTimeout(() => input.focus()));
</script>

<Page title="Keyboard shortcuts" modal {onClose}>
  <p class="muted">
    These are claimed by ATC, so the shell and Claude Code never see them. Everything else
    goes straight to whatever is running in the terminal.
  </p>
  <input
    class="filter"
    type="search"
    placeholder="Filter by action or key"
    aria-label="Filter shortcuts"
    spellcheck="false"
    bind:this={input}
    bind:value={query}
  />

  {#each shown as g (g.group)}
    <h2>{g.group}</h2>
    <table>
      <tbody>
        {#each g.rows as row (row.action)}
          <tr>
            <th scope="row"><Highlight text={row.label} {query} /></th>
            <td>
              {#each row.chords as chord, i (chord)}
                {#if i > 0}<span class="or">or</span>{/if}<kbd>{chord}</kbd>
              {/each}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/each}

  {#if fixed.length}
    <p class="muted">These work inside the chat box, sidebar and terminal, and can't be rebound.</p>
  {/if}
  {#each fixed as g (g.group)}
    <h2>{g.group}</h2>
    <table>
      <tbody>
        {#each g.rows as row (row.label)}
          <tr>
            <th scope="row"><Highlight text={row.label} {query} /></th>
            <td>
              {#each row.chords as chord, i (chord)}
                {#if i > 0}<span class="or">or</span>{/if}<kbd>{chord}</kbd>
              {/each}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/each}

  {#if !shown.length && !fixed.length}
    <p class="muted">No shortcut matches “{query.trim()}”.</p>
  {/if}
</Page>

<style>
  .filter {
    width: 100%;
    max-width: 320px;
    margin-top: 8px;
    box-sizing: border-box;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th {
    padding: 5px 0;
    color: var(--fg);
    font-size: calc(13px * var(--ui-scale, 1));
    font-weight: 400;
    text-align: left;
  }
  td {
    padding: 5px 0;
    text-align: right;
    white-space: nowrap;
  }
  kbd {
    padding: 2px 7px;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: calc(5px * var(--radius-scale, 1));
    background: var(--bg-surface);
    color: var(--fg);
    font-family: inherit;
    font-size: calc(12px * var(--ui-scale, 1));
  }
  .or {
    margin: 0 6px;
    color: var(--fg-faint);
    font-size: calc(11px * var(--ui-scale, 1));
  }
</style>
