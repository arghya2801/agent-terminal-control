<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { saveTheme } from '../lib/ipc';
  import { previewTheme, reloadThemes } from '../lib/stores.svelte';
  import { ANSI, applyPalette, cssVariables, parseUi, type Palette } from '../lib/theme';
  import { fromVsCode } from '../lib/vscodeTheme';
  import { applyTheme } from '../terminal/manager';

  let { base, saved, onClose, onSaved }: { base: Palette; saved: string; onClose: () => void; onSaved: (name: string) => void } = $props();

  const EXTRA = ['--claude', '--codex', '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--shadow-pop', '--ui-font'];
  const TEXT_ONLY = new Set(['--shadow-pop', '--ui-font']);
  const HEX = /^#[0-9a-f]{6}$/i;
  const COLOURS = [
    ['background', 'Background'],
    ['foreground', 'Foreground'],
    ['cursor', 'Cursor'],
    ['selection', 'Selection'],
  ] as const;

  let p = $state<Palette>(untrack(() => ({ ...structuredClone($state.snapshot(base)), name: `${base.name} (custom)` })));
  let error = $state('');
  let importing = $state(false);
  let pasted = $state('');
  let extras = $state<Record<string, string>>({});
  const defaults = $derived({ ...extras, ...cssVariables({ ...p, ui: undefined }) });

  const ctx = document.createElement('canvas').getContext('2d')!;
  /** Any CSS colour, color-mix() included, as #rrggbb; '' if it is not a colour. */
  function toHex(css: string): string {
    ctx.fillStyle = '#000001';
    ctx.fillStyle = css;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
  }

  onMount(() => {
    const computed = getComputedStyle(document.documentElement);
    extras = Object.fromEntries(EXTRA.map((v) => [v, computed.getPropertyValue(v).trim()]));
  });

  $effect(() => {
    const q = $state.snapshot(p);
    q.ui = parseUi(q.ui);
    applyPalette(q, document.documentElement);
    applyTheme(q);
  });

  function setUi(v: string, value: string) {
    p.ui = { ...p.ui, [v]: value };
  }
  function clearUi(v: string) {
    const { [v]: _, ...rest } = p.ui ?? {};
    p.ui = rest;
  }
  const uiKeys = $derived([...Object.keys(cssVariables(p)), ...EXTRA].filter((k, i, a) => a.indexOf(k) === i));

  function load() {
    try {
      p = fromVsCode(pasted);
      importing = false;
      pasted = '';
      error = '';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function save() {
    const name = p.name.trim();
    if (!name) return (error = 'Name the theme');
    const out: Record<string, unknown> = { name, background: p.background, foreground: p.foreground, cursorColor: p.cursor, selectionBackground: p.selection };
    for (const a of ANSI) out[a] = p[a];
    const ui = parseUi(p.ui);
    if (ui) out.ui = ui;
    try {
      await saveTheme(name, out);
      await reloadThemes();
      previewTheme(name);
      onSaved(name);
    } catch (e) {
      error = `Could not save: ${e}`;
    }
  }

  function cancel() {
    previewTheme(saved);
    onClose();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.stopImmediatePropagation();
    cancel();
  }
  onMount(() => {
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
</script>

{#snippet colour(label: string, value: string, set: (v: string) => void)}
  <label class="f">
    <span>{label}</span>
    <input type="color" {value} oninput={(e) => set(e.currentTarget.value)} />
    <input class="hex" {value} oninput={(e) => HEX.test(e.currentTarget.value) && set(e.currentTarget.value)} />
  </label>
{/snippet}

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && cancel()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Theme editor">
    <header>
      <h3>Theme editor</h3>
      <button class="btn" onclick={() => (importing = !importing)}>Import VS Code theme…</button>
    </header>
    <div class="body">
      {#if importing}
        <textarea rows="6" placeholder="Paste a VS Code colour theme's JSON" bind:value={pasted}></textarea>
        <div><button class="btn" disabled={!pasted.trim()} onclick={load}>Load</button></div>
      {/if}
      <label class="f"><span>Name</span><input class="name" bind:value={p.name} /></label>
      <div class="cols">
        {#each COLOURS as [k, label] (k)}
          {@render colour(label, p[k], (v) => (p[k] = v))}
        {/each}
        {#each ANSI as a (a)}
          {@render colour(a, p[a], (v) => (p[a] = v))}
        {/each}
      </div>
      <h4>Interface colours</h4>
      <div class="muted">Unset ones follow the palette.</div>
      <div class="ui">
        {#each uiKeys as v (v)}
          {@const own = p.ui?.[v]}
          {@const shown = own ?? defaults[v] ?? ''}
          <span class="mono">{v}</span>
          {#if TEXT_ONLY.has(v)}
            <span></span>
          {:else}
            <input type="color" value={HEX.test(shown) ? shown : toHex(shown)} oninput={(e) => setUi(v, e.currentTarget.value)} />
          {/if}
          <input class="hex wide" value={shown} oninput={(e) => setUi(v, e.currentTarget.value)} />
          <button class="btn" disabled={own === undefined} onclick={() => clearUi(v)}>Use theme default</button>
        {/each}
      </div>
    </div>
    <footer>
      {#if error}<span class="err">{error}</span>{/if}
      <button class="btn" onclick={cancel}>Cancel</button>
      <button class="btn primary" onclick={save}>Save</button>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--bg) 55%, transparent);
  }
  .dialog {
    display: flex;
    flex-direction: column;
    width: min(760px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    border: 1px solid var(--border);
    border-radius: calc(10px * var(--radius-scale, 1));
    background: var(--bg-chrome);
    box-shadow: var(--shadow-pop);
    color: var(--fg);
    font-size: calc(12px * var(--ui-scale, 1));
  }
  header,
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 16px;
  }
  footer {
    justify-content: flex-end;
    border-top: 1px solid var(--border);
  }
  footer .err {
    margin-right: auto;
  }
  h3,
  h4 {
    margin: 0;
    color: var(--fg-bright);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    padding: 4px 16px 12px;
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 24px;
  }
  .f {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .f > span {
    width: 96px;
    flex-shrink: 0;
  }
  .name {
    flex: 1;
  }
  .hex {
    width: 84px;
    font-family: ui-monospace, monospace;
  }
  .hex.wide {
    width: 100%;
    min-width: 0;
  }
  input[type='color'] {
    width: 32px;
    height: 24px;
    padding: 0;
    border: 1px solid var(--border);
    background: transparent;
  }
  .ui {
    display: grid;
    grid-template-columns: auto auto 1fr auto;
    align-items: center;
    gap: 4px 8px;
  }
  .mono {
    font-family: ui-monospace, monospace;
  }
  input,
  textarea,
  .btn {
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: calc(6px * var(--radius-scale, 1));
    background: var(--bg);
    color: var(--fg-bright);
    font: inherit;
  }
  .btn {
    background: var(--bg-surface);
    color: var(--fg);
    cursor: pointer;
  }
  .btn:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .btn.primary {
    border-color: var(--accent-strong);
    background: var(--accent-strong);
    color: var(--on-accent);
  }
  .muted {
    color: var(--fg-faint);
  }
  .err {
    color: var(--danger);
  }
</style>
