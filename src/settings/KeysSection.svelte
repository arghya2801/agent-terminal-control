<script lang="ts">
  import { actionList, chordFromEvent, chordsFor, type Action } from '../lib/keymap';

  /** Overrides by action, as in `ui.keys`: a chord, or '' for none. */
  let { keys = $bindable() }: { keys: Record<string, string> } = $props();

  const actions = actionList();
  let recording = $state<Action | null>(null);

  const chords = (a: Action) => (a in keys ? (keys[a] ? [keys[a]] : []) : chordsFor(a, true));
  const same = (x: string, y: string) => x.toLowerCase() === y.toLowerCase();
  /** The other action already on this chord, so a clash is said, not silently resolved. */
  const clash = (a: Action, chord: string) => actions.find((o) => o.action !== a && chords(o.action).some((c) => same(c, chord)))?.label;

  function set(a: Action, chord: string | null) {
    const { [a]: _, ...rest } = keys;
    const isDefault = chord !== null && JSON.stringify(chordsFor(a, true)) === JSON.stringify([chord]);
    keys = chord === null || isDefault ? rest : { ...rest, [a]: chord };
  }

  $effect(() => {
    const a = recording;
    if (!a) return;
    // Capture on the window, ahead of the app's own chords and the page's Esc.
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape') return void (recording = null);
      const chord = chordFromEvent(e);
      if (!chord) return;
      set(a, chord);
      recording = null;
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
</script>

<p class="muted hint">
  Shortcuts need Ctrl. A chord taken here never reaches the shell or the agent, so Ctrl+Shift is the safe family; plain Ctrl+B belongs to Claude Code.
  {#if Object.keys(keys).length}<button class="btn" onclick={() => (keys = {})}>Reset all</button>{/if}
</p>
<div class="grid">
  {#each actions as { action, label } (action)}
    {@const now = chords(action)}
    <span class="name">{label}</span>
    <div class="row">
      {#if recording === action}
        <span class="rec">Press the new shortcut, Esc to cancel</span>
      {:else}
        {#each now as c (c)}<kbd>{c}</kbd>{:else}<span class="muted">None</span>{/each}
        {#each now as c (c)}{@const other = clash(action, c)}{#if other}<span class="warn">Also {other}</span>{/if}{/each}
      {/if}
      <span class="grow"></span>
      <button class="btn" onclick={() => (recording = recording === action ? null : action)}>{recording === action ? 'Cancel' : 'Change'}</button>
      {#if now.length}<button class="btn" onclick={() => set(action, '')} title="No shortcut for this">Clear</button>{/if}
      {#if action in keys}<button class="btn" onclick={() => set(action, null)} title="Back to {chordsFor(action, true).join(' or ') || 'none'}">Reset</button>{/if}
    </div>
  {/each}
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: 190px minmax(0, 1fr);
    align-items: center;
    gap: 6px 16px;
  }
  .name {
    color: var(--fg);
    font-size: 12px;
  }
  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    max-width: 520px;
  }
  .grow {
    flex: 1;
  }
  kbd {
    padding: 1px 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-chrome);
    color: var(--fg-bright);
    font: inherit;
    font-size: 11px;
  }
  .rec {
    color: var(--accent);
    font-size: 12px;
  }
  .warn {
    color: var(--warn);
    font-size: 11px;
  }
  .hint {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 11px;
  }
</style>
