<script lang="ts">
  import Page from '../lib/Page.svelte';
  import { openSettingsFile } from '../lib/ipc';
  import { appState, refresh, saveSettings, themeState } from '../lib/stores.svelte';
  import { cssVariables } from '../lib/theme';
  import type { Settings } from '../types';

  let { onClose }: { onClose: () => void } = $props();

  /** Edited copy; nothing is written until Save. */
  let draft = $state<Settings | null>(
    appState.settings ? structuredClone($state.snapshot(appState.settings)) : null,
  );
  let resumeArgs = $state(appState.settings?.claude.resumeArgs.join(' ') ?? '');
  let saved = $state(false);

  const dirty = $derived(
    !!draft &&
      !!appState.settings &&
      JSON.stringify({ ...draft, claude: { ...draft.claude, resumeArgs: splitArgs(resumeArgs) } }) !==
        JSON.stringify(appState.settings),
  );

  function splitArgs(s: string): string[] {
    return s.split(/\s+/).filter(Boolean);
  }

  /**
   * The theme applies as soon as it is picked, without waiting for Save: choosing colours
   * blind is no choice at all. Saving is still what makes it stick, and Cancel restores
   * what was there.
   */
  function previewTheme(name: string) {
    if (!draft || !appState.settings) return;
    draft.ui.theme = name;
    void saveSettings({ ...appState.settings, ui: { ...appState.settings.ui, theme: name } });
  }

  /** Three swatches per theme: the chrome, the accent and the foreground. */
  function swatches(name: string) {
    const t = themeState.themes.find((x) => x.name === name);
    if (!t) return [];
    const v = cssVariables(t);
    return [t.background, v['--accent'], t.foreground];
  }

  const clamp = (n: number, lo: number, hi: number, fallback: number) =>
    Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;

  async function save() {
    if (!draft) return;
    const next: Settings = {
      ...draft,
      ui: {
        ...draft.ui,
        sessionsPerProject: clamp(draft.ui.sessionsPerProject, 1, 500, 15),
        sidebarWidth: clamp(draft.ui.sidebarWidth, 160, 800, 260),
      },
      terminal: {
        ...draft.terminal,
        fontSize: clamp(draft.terminal.fontSize, 6, 48, 13),
        scrollback: clamp(draft.terminal.scrollback, 0, 1_000_000, 10_000),
      },
      claude: {
        ...draft.claude,
        command: draft.claude.command.trim() || 'claude',
        resumeArgs: splitArgs(resumeArgs),
        scratchDir: draft.claude.scratchDir?.trim() || null,
      },
      projects: {
        ...draft.projects,
        claudeProjectsDir: draft.projects.claudeProjectsDir?.trim() || null,
      },
    };
    await saveSettings(next);
    // Renames and the projects directory only show up after a rescan.
    await refresh();
    draft = structuredClone(next);
    resumeArgs = next.claude.resumeArgs.join(' ');
    saved = true;
    setTimeout(() => (saved = false), 1500);
  }

  function removeName(field: 'names' | 'sessionNames', id: string) {
    if (!draft) return;
    const map = { ...draft.projects[field] };
    delete map[id];
    draft.projects[field] = map;
  }

  function sessionLabel(id: string): string {
    for (const p of appState.index.projects) {
      if (p.sessions.some((s) => s.id === id)) return `${p.name} · ${id.slice(0, 8)}`;
    }
    return id.slice(0, 8);
  }
</script>

<Page title="Settings" {onClose}>
  {#if !draft}
    <p class="err">Settings could not be loaded.</p>
  {:else}
    <h2>Sidebar</h2>
    <div class="grid">
      <label for="spp">Sessions shown per project</label>
      <input id="spp" type="number" min="1" max="500" bind:value={draft.ui.sessionsPerProject} />
      <label for="sw">Sidebar width (px)</label>
      <input id="sw" type="number" min="160" max="800" step="10" bind:value={draft.ui.sidebarWidth} />
      <label for="rt">Restore tabs</label>
      <label class="check">
        <input id="rt" type="checkbox" bind:checked={draft.ui.restoreTabs} />
        <span class="muted">Reopen the tabs from last time on launch; Claude sessions resume</span>
      </label>
      <label for="gs">Group subfolders</label>
      <label class="check">
        <input id="gs" type="checkbox" bind:checked={draft.ui.groupSubfolders} />
        <span class="muted">Show sessions started in a subfolder under the project containing it; they still resume in their own directory</span>
      </label>
      <label for="nt">Notifications</label>
      <label class="check">
        <input id="nt" type="checkbox" bind:checked={draft.ui.notifications} />
        <span class="muted">Notify when a background Claude session finishes or needs input while ATC is not focused</span>
      </label>
    </div>

    <h2>Terminal</h2>
    <div class="grid">
      <label for="ff">Font family</label>
      <input id="ff" class="wide" bind:value={draft.terminal.fontFamily} />
      <label for="fs">Font size</label>
      <input id="fs" type="number" min="6" max="48" bind:value={draft.terminal.fontSize} />
      <label for="sb">Scrollback lines</label>
      <input id="sb" type="number" min="0" step="1000" bind:value={draft.terminal.scrollback} />
      <label for="zm">Zoom</label>
      <input id="zm" type="number" min="0.5" max="3" step="0.1" bind:value={draft.ui.zoom} />
      <label for="th">Theme</label>
      <div>
        <select id="th" value={draft.ui.theme} onchange={(e) => previewTheme(e.currentTarget.value)}>
          {#each themeState.themes as t (t.name)}
            <option value={t.name}>{t.name}</option>
          {/each}
        </select>
        <span class="swatches" aria-hidden="true">
          {#each swatches(draft.ui.theme) as colour (colour)}
            <span class="swatch" style="background: {colour}"></span>
          {/each}
        </span>
        <div class="muted hint">
          Applied as you pick it. Drop more theme files in <code>themes/</code> beside
          <code>settings.json</code>: any Windows Terminal or VS Code terminal palette works.
        </div>
      </div>
    </div>

    <h2>Claude</h2>
    <div class="grid">
      <label for="cc">Command</label>
      <input id="cc" bind:value={draft.claude.command} />
      <label for="ra">Resume arguments</label>
      <div>
        <input id="ra" class="wide" bind:value={resumeArgs} />
        <div class="muted hint"><code>{'{session}'}</code> becomes the session id</div>
      </div>
      <label for="sd">Ask Claude directory</label>
      <div>
        <input
          id="sd"
          class="wide"
          placeholder="the scratch folder in ATC's config directory"
          value={draft.claude.scratchDir ?? ''}
          oninput={(e) => draft && (draft.claude.scratchDir = e.currentTarget.value)}
        />
        <div class="muted hint">Where the ✳ button runs Claude, for questions with no project</div>
      </div>
      <label for="pd">Projects directory</label>
      <div>
        <input
          id="pd"
          class="wide"
          placeholder="%USERPROFILE%\.claude\projects"
          value={draft.projects.claudeProjectsDir ?? ''}
          oninput={(e) => draft && (draft.projects.claudeProjectsDir = e.currentTarget.value)}
        />
        <div class="muted hint">Leave empty for the default. Watching a new directory needs a restart.</div>
      </div>
    </div>

    <h2>Renamed projects</h2>
    {#each Object.keys(draft.projects.names) as path (path)}
      <div class="rename-row">
        <input class="wide" bind:value={draft.projects.names[path]} aria-label="Name for {path}" />
        <span class="muted path" title={path}>{path}</span>
        <button class="btn" onclick={() => removeName('names', path)} title="Use the folder name again">Reset</button>
      </div>
    {:else}
      <p class="muted">None. Right-click a project in the sidebar and choose Rename.</p>
    {/each}

    <h2>Renamed sessions</h2>
    {#each Object.keys(draft.projects.sessionNames) as id (id)}
      <div class="rename-row">
        <input class="wide" bind:value={draft.projects.sessionNames[id]} aria-label="Name for session {id}" />
        <span class="muted path" title={id}>{sessionLabel(id)}</span>
        <button class="btn" onclick={() => removeName('sessionNames', id)} title="Use Claude's title again">Reset</button>
      </div>
    {:else}
      <p class="muted">None. Right-click a session in the sidebar and choose Rename.</p>
    {/each}

    <div class="actions">
      <button class="btn primary" onclick={save} disabled={!dirty}>{saved ? 'Saved' : 'Save'}</button>
      <button class="btn" onclick={() => openSettingsFile()}>Open settings.json</button>
      {#if dirty}<span class="muted">Unsaved changes</span>{/if}
    </div>
  {/if}
</Page>

<style>
  .grid {
    display: grid;
    grid-template-columns: 190px minmax(0, 1fr);
    align-items: center;
    gap: 10px 16px;
  }
  label {
    color: var(--fg);
    font-size: 12px;
  }
  input[type='number'] {
    width: 90px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .wide {
    width: 100%;
    max-width: 460px;
    box-sizing: border-box;
  }
  .hint {
    margin-top: 3px;
    font-size: 11px;
  }
  select {
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg-bright);
    font: inherit;
    font-size: 12px;
  }
  .swatches {
    display: inline-flex;
    margin-left: 8px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 4px;
    vertical-align: -3px;
  }
  .swatch {
    width: 14px;
    height: 14px;
  }
  code {
    padding: 0 3px;
    border-radius: 3px;
    background: var(--bg-chrome);
  }
  .rename-row {
    display: grid;
    grid-template-columns: minmax(0, 240px) minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
  }
  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .actions {
    position: sticky;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 24px;
    padding: 12px 0;
    border-top: 1px solid var(--border);
    background: var(--bg);
  }
</style>
