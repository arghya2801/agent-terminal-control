<script lang="ts">
  import Page from '../lib/Page.svelte';
  import { shortcutGroups } from '../lib/keymap';

  let { onClose }: { onClose: () => void } = $props();

  // Read once: the bindings are a module constant, not something that changes while the
  // page is open.
  const groups = shortcutGroups();
</script>

<Page title="Keyboard shortcuts" {onClose}>
  <p class="muted">
    These are claimed by ATC, so the shell and Claude Code never see them. Everything else
    goes straight to whatever is running in the terminal.
  </p>

  {#each groups as g (g.group)}
    <h2>{g.group}</h2>
    <table>
      <tbody>
        {#each g.rows as row (row.action)}
          <tr>
            <th scope="row">{row.label}</th>
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
</Page>

<style>
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th {
    padding: 5px 0;
    color: #c9d1d9;
    font-size: 13px;
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
    border: 1px solid #30363d;
    border-bottom-width: 2px;
    border-radius: 5px;
    background: #21262d;
    color: #c9d1d9;
    font-family: inherit;
    font-size: 12px;
  }
  .or {
    margin: 0 6px;
    color: #6e7681;
    font-size: 11px;
  }
</style>
