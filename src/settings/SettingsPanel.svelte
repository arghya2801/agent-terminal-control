<script lang="ts">
  import { sessionKey } from '../lib/agents';
  import Page from '../lib/Page.svelte';
  import SectionNav from '../lib/SectionNav.svelte';
  import { openSettingsFile } from '../lib/ipc';
  import { appState, refresh, saveSettings, themeState } from '../lib/stores.svelte';
  import { cssVariables } from '../lib/theme';
  import type { Settings } from '../types';

  let { onClose }: { onClose: () => void } = $props();

  const SECTIONS = [
    { id: 's-general', label: 'General' },
    { id: 's-appearance', label: 'Appearance' },
    { id: 's-terminal', label: 'Terminal' },
    { id: 's-sidebar', label: 'Sidebar' },
    { id: 's-agents', label: 'Agents' },
    { id: 's-names', label: 'Names' },
  ];

  /** Edited copy; nothing is written until Save. */
  let draft = $state<Settings | null>(
    appState.settings ? structuredClone($state.snapshot(appState.settings)) : null,
  );
  let resumeArgs = $state(appState.settings?.claude.resumeArgs.join('\n') ?? '');
  let codexResumeArgs = $state(appState.settings?.codex.resumeArgs.join('\n') ?? '');
  let saved = $state(false);

  const dirty = $derived(
    !!draft &&
      !!appState.settings &&
      JSON.stringify({
        ...draft,
        codex: { ...draft.codex, resumeArgs: splitArgs(codexResumeArgs) },
        claude: { ...draft.claude, resumeArgs: splitArgs(resumeArgs) },
      }) !==
        JSON.stringify(appState.settings),
  );

  function splitArgs(s: string): string[] {
    return s.split('\n').map((arg) => arg.trim()).filter((arg) => arg.length > 0);
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
      codex: {
        ...draft.codex,
        command: draft.codex.command.trim() || 'codex',
        resumeArgs: splitArgs(codexResumeArgs),
        homeDir: draft.codex.homeDir?.trim() || null,
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
    resumeArgs = next.claude.resumeArgs.join('\n');
    codexResumeArgs = next.codex.resumeArgs.join('\n');
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
    const shortId = id.slice(id.indexOf(':') + 1, id.indexOf(':') + 9);
    for (const p of appState.index.projects) {
      if (p.sessions.some((s) => sessionKey(s) === id)) return `${p.name} · ${shortId}`;
    }
    return shortId;
  }
</script>

<Page title="Settings" full {onClose}>
  {#snippet actions()}
    {#if dirty}<span class="muted">Unsaved changes</span>{/if}
    <button class="btn" onclick={() => openSettingsFile()}>Open settings.json</button>
    <button class="btn primary" onclick={save} disabled={!dirty}>{saved ? 'Saved' : 'Save'}</button>
  {/snippet}
  {#if !draft}
    <p class="err">Settings could not be loaded.</p>
  {:else}
    <SectionNav sections={SECTIONS}>
      <h2 id="s-general">General</h2>
      <div class="grid">
        <label for="rt">Restore tabs</label>
        <label class="check">
          <input id="rt" type="checkbox" bind:checked={draft.ui.restoreTabs} />
          <span class="muted">Reopen last time's tabs on launch; agent sessions resume</span>
        </label>
        <label for="nt">Notifications</label>
        <label class="check">
          <input id="nt" type="checkbox" bind:checked={draft.ui.notifications} />
          <span class="muted">When a background session finishes or needs you and ATC is not focused</span>
        </label>
      </div>

      <h2 id="s-appearance">Appearance</h2>
      <div class="grid">
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
          <div class="muted hint">Applies as you pick. More themes: any terminal palette in <code>themes/</code> beside <code>settings.json</code>.</div>
        </div>
        <label for="an">Animations</label>
        <div>
          <select id="an" bind:value={draft.ui.animations}>
            <option value="system">Follow Windows</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
          <span class="muted hint">Windows: Accessibility &gt; Visual effects</span>
        </div>
        <label for="as">Animation speed</label>
        <div class="check">
          <input id="as" type="range" min="0.5" max="3" step="0.25" bind:value={draft.ui.animationSpeed} />
          <span class="speed">{draft.ui.animationSpeed}×</span>
          {#if draft.ui.animationSpeed !== 1}
            <button class="btn" onclick={() => draft && (draft.ui.animationSpeed = 1)}>Reset</button>
          {/if}
        </div>
        <label for="zm">Zoom</label>
        <input id="zm" type="number" min="0.5" max="3" step="0.1" bind:value={draft.ui.zoom} />
      </div>

      <h2 id="s-terminal">Terminal</h2>
      <div class="grid">
        <label for="ff">Font family</label>
        <input id="ff" class="wide" bind:value={draft.terminal.fontFamily} />
        <label for="fs">Font size</label>
        <input id="fs" type="number" min="6" max="48" bind:value={draft.terminal.fontSize} />
        <label for="sb">Scrollback lines</label>
        <input id="sb" type="number" min="0" step="1000" bind:value={draft.terminal.scrollback} />
      </div>

      <h2 id="s-sidebar">Sidebar</h2>
      <div class="grid">
        <label for="spp">Sessions per project</label>
        <input id="spp" type="number" min="1" max="500" bind:value={draft.ui.sessionsPerProject} />
        <label for="sw">Width (px)</label>
        <input id="sw" type="number" min="160" max="800" step="10" bind:value={draft.ui.sidebarWidth} />
        <label for="gs">Group subfolders</label>
        <label class="check">
          <input id="gs" type="checkbox" bind:checked={draft.ui.groupSubfolders} />
          <span class="muted">Show subfolder sessions under their parent project</span>
        </label>
        <label for="gb">Group by branch</label>
        <label class="check">
          <input id="gb" type="checkbox" bind:checked={draft.ui.groupByBranch} />
          <span class="muted">Group each project's sessions by git branch</span>
        </label>
      </div>

      <h2 id="s-agents">Agents</h2>
      <div class="agents">
        <span></span><span class="col">Claude</span><span class="col">Codex</span>
        <label for="cc">Command</label>
        <input id="cc" bind:value={draft.claude.command} />
        <input aria-label="Codex command" bind:value={draft.codex.command} />
        <label for="ra">Resume arguments<span class="muted hint">One per line; <code>{'{session}'}</code> is the session id</span></label>
        <textarea id="ra" bind:value={resumeArgs}></textarea>
        <textarea aria-label="Codex resume arguments" bind:value={codexResumeArgs}></textarea>
      </div>
      <div class="grid folders">
        <label for="pd">Claude projects</label>
        <input
          id="pd"
          class="wide"
          placeholder="%USERPROFILE%\.claude\projects"
          value={draft.projects.claudeProjectsDir ?? ''}
          oninput={(e) => draft && (draft.projects.claudeProjectsDir = e.currentTarget.value)}
        />
        <label for="codex-home">Codex home</label>
        <input id="codex-home" class="wide" placeholder="CODEX_HOME or ~/.codex" bind:value={draft.codex.homeDir} />
        <label for="sd">Scratch directory</label>
        <input
          id="sd"
          class="wide"
          placeholder="scratch, in ATC's config directory"
          value={draft.claude.scratchDir ?? ''}
          oninput={(e) => draft && (draft.claude.scratchDir = e.currentTarget.value)}
        />
      </div>
      <p class="muted hint">Empty fields use the default. A new projects directory is watched after a restart.</p>

      <h2 id="s-names">Names</h2>
      {#each Object.keys(draft.projects.names) as path (path)}
        <div class="rename-row">
          <input class="wide" bind:value={draft.projects.names[path]} aria-label="Name for {path}" />
          <span class="muted path" title={path}>{path}</span>
          <button class="btn" onclick={() => removeName('names', path)} title="Use the folder name again">Reset</button>
        </div>
      {/each}
      {#each Object.keys(draft.projects.sessionNames) as id (id)}
        <div class="rename-row">
          <input class="wide" bind:value={draft.projects.sessionNames[id]} aria-label="Name for session {id}" />
          <span class="muted path" title={id}>{sessionLabel(id)}</span>
          <button class="btn" onclick={() => removeName('sessionNames', id)} title="Use the agent's title again">Reset</button>
        </div>
      {/each}
      {#if !Object.keys(draft.projects.names).length && !Object.keys(draft.projects.sessionNames).length}
        <p class="muted">None yet. Right-click a project or session in the sidebar and choose Rename.</p>
      {/if}

    </SectionNav>
  {/if}
</Page>

<style>
  .agents {
    display: grid;
    grid-template-columns: 190px minmax(0, 220px) minmax(0, 220px);
    align-items: start;
    gap: 10px 16px;
  }
  .agents label {
    display: flex;
    flex-direction: column;
    padding-top: 5px;
  }
  .col {
    color: var(--fg-dim);
    font-size: 12px;
    font-weight: 600;
  }
  .folders {
    margin-top: 10px;
  }
  textarea {
    min-height: 52px;
    box-sizing: border-box;
    resize: vertical;
  }
  select + .hint {
    margin-left: 8px;
  }
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
  input[type='range'] {
    width: 180px;
    padding: 0;
    border: none;
    accent-color: var(--accent);
  }
  .speed {
    min-width: 4ch;
    color: var(--fg-bright);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
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
</style>
